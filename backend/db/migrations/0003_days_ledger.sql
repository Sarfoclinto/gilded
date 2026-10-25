-- 0003 The accounting core: business days, the asset ledger, balances, reconciliation, debts.
--
-- Idea in one paragraph: a branch holds three kinds of assets (cash by note, goods by top/down weight and value,
-- and debts owed to it). EVERY change to any of them is one or more immutable rows in gold.ledger_entries that
-- point at what caused it (a transaction, a transfer, a drawer movement...). The balance at any moment is just
-- the sum of the ledger. A day's closing numbers are compared with that sum; any difference is recorded as an
-- explicit adjustment with a reason, so tomorrow starts exactly where today actually ended.

create table gold.business_days (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null,
  branch_id                uuid not null,
  business_date            date not null,
  status                   text not null default 'open' check (status in ('open', 'closed')),
  previous_day_id          uuid,
  opened_at                timestamptz not null,
  opened_by                uuid not null,
  opened_offline           boolean not null default false,
  closed_at                timestamptz,
  closed_by                uuid,
  -- The teller's mandatory statement that they physically verified the reported assets.
  -- The exact wording they saw is stored with its version, so it can never be disputed later.
  closing_confirmed        boolean not null default false,
  closing_confirmation_version text,
  closing_confirmation_text    text,
  -- Manager review. Pending never blocks the next day.
  signoff_status           text not null default 'not_required' check (signoff_status in ('not_required', 'pending', 'approved', 'rejected')),
  signoff_by               uuid,
  signoff_at               timestamptz,
  signoff_note             text,
  created_at               timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, branch_id, business_date),
  foreign key (tenant_id, branch_id)       references gold.branches (tenant_id, id),
  foreign key (tenant_id, previous_day_id) references gold.business_days (tenant_id, id),
  foreign key (tenant_id, opened_by)       references gold.users (tenant_id, id),
  foreign key (tenant_id, closed_by)       references gold.users (tenant_id, id),
  foreign key (tenant_id, signoff_by)      references gold.users (tenant_id, id),
  -- A day cannot be closed without the physical-verification confirmation. Enforced here, not only in the UI.
  constraint closed_requires_confirmation check (
    status = 'open'
    or (closed_at is not null and closed_by is not null and closing_confirmed
        and closing_confirmation_version is not null and gold.has_text(closing_confirmation_text, 1))
  ),
  constraint signoff_decision_complete check (
    signoff_status in ('not_required', 'pending') or (signoff_by is not null and signoff_at is not null)
  )
);
create unique index business_days_one_open_per_branch on gold.business_days (branch_id) where status = 'open';
create index business_days_branch_date on gold.business_days (tenant_id, branch_id, business_date desc);

-- The immutable asset ledger. See the header comment.
create table gold.ledger_entries (
  id               uuid primary key default gen_random_uuid(),
  seq              bigint generated always as identity unique,        -- total order across the whole system
  tenant_id        uuid not null,
  branch_id        uuid not null,
  business_day_id  uuid,                                              -- null = between days (late sync, after close)
  occurred_at      timestamptz not null,                              -- when it really happened (device clock for offline entries)
  recorded_at      timestamptz not null default now(),                -- when the server learned about it
  recorded_by      uuid,
  asset            text not null check (asset in ('cash', 'goods', 'debt')),
  -- cash: notes of one denomination, signed (+ in, - out)
  denomination     integer check (denomination > 0),
  delta_count      integer,
  -- goods: signed change in weights on the scale (top) and in water (down)
  delta_top        numeric(14,4),
  delta_down       numeric(14,4),
  -- value of the change in company currency: cash = denomination x count, goods = purchase value, debt = amount owed
  delta_value      numeric(18,2) not null,
  source_type      text not null check (source_type in (
                     'go_live_balance',
                     'transaction_purchase', 'transaction_payout',
                     'drawer_movement',
                     'transfer_release', 'transfer_receipt', 'transfer_payment',
                     'debt_issued', 'debt_repayment',
                     'opening_adjustment', 'closing_adjustment',
                     'discrepancy_resolution', 'reversal')),
  source_id        uuid not null,                                     -- the transaction, transfer, day... that caused it
  memo             text,
  reverses_entry_id uuid references gold.ledger_entries (id),
  foreign key (tenant_id, branch_id)       references gold.branches (tenant_id, id),
  foreign key (tenant_id, business_day_id) references gold.business_days (tenant_id, id),
  foreign key (tenant_id, recorded_by)     references gold.users (tenant_id, id),
  constraint ledger_shape check (
    (asset = 'cash'  and denomination is not null and delta_count is not null and delta_count <> 0
                     and delta_top is null and delta_down is null and delta_value = denomination * delta_count)
 or (asset = 'goods' and denomination is null and delta_count is null
                     and delta_top is not null and delta_down is not null)
 or (asset = 'debt'  and denomination is null and delta_count is null
                     and delta_top is null and delta_down is null)
  ),
  constraint reversal_points_at_entry check ((source_type = 'reversal') = (reverses_entry_id is not null))
);
create index ledger_branch_seq   on gold.ledger_entries (branch_id, seq);
create index ledger_source       on gold.ledger_entries (source_type, source_id);
create index ledger_day          on gold.ledger_entries (business_day_id) where business_day_id is not null;
create index ledger_branch_time  on gold.ledger_entries (branch_id, occurred_at);
create trigger ledger_immutable before update or delete on gold.ledger_entries
  for each row execute function gold.forbid_mutation();

-- Balance of one branch: everything up to a point in the ledger (default: now).
create function gold.branch_balance(p_branch uuid, p_upto_seq bigint default null)
returns table (cash_value numeric, cash_lines jsonb, goods_top numeric, goods_down numeric, goods_value numeric, debt_value numeric)
language sql stable as $$
  with e as (
    select * from gold.ledger_entries
    where branch_id = p_branch and (p_upto_seq is null or seq <= p_upto_seq)
  ), notes as (
    select denomination, sum(delta_count) as n from e where asset = 'cash' group by denomination having sum(delta_count) <> 0
  )
  select
    coalesce((select sum(delta_value) from e where asset = 'cash'), 0),
    coalesce((select jsonb_object_agg(denomination::text, n) from notes), '{}'::jsonb),
    coalesce((select sum(delta_top)   from e where asset = 'goods'), 0),
    coalesce((select sum(delta_down)  from e where asset = 'goods'), 0),
    coalesce((select sum(delta_value) from e where asset = 'goods'), 0),
    coalesce((select sum(delta_value) from e where asset = 'debt'), 0)
$$;

-- The branch timeline: every movement in order, with the running balance after it. Filter by branch and date range.
create view gold.v_branch_timeline as
select
  l.id, l.seq, l.tenant_id, l.branch_id, l.business_day_id, l.occurred_at, l.recorded_at, l.recorded_by,
  l.asset, l.denomination, l.delta_count, l.delta_top, l.delta_down, l.delta_value,
  l.source_type, l.source_id, l.memo, l.reverses_entry_id,
  sum(case when l.asset = 'cash'  then l.delta_value else 0 end) over w as running_cash,
  sum(case when l.asset = 'goods' then l.delta_top   else 0 end) over w as running_goods_top,
  sum(case when l.asset = 'goods' then l.delta_down  else 0 end) over w as running_goods_down,
  sum(case when l.asset = 'goods' then l.delta_value else 0 end) over w as running_goods_value,
  sum(case when l.asset = 'debt'  then l.delta_value else 0 end) over w as running_debt
from gold.ledger_entries l
window w as (partition by l.branch_id order by l.seq rows between unbounded preceding and current row);

-- Snapshots taken at the two moments that matter. "expected" is computed by the server from the ledger;
-- "declared" is what the teller counted/reported. Neither is ever edited.
create table gold.day_balances (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  business_day_id  uuid not null,
  kind             text not null check (kind in ('opening_expected', 'opening_declared', 'closing_expected', 'closing_declared')),
  cash_lines       jsonb not null default '{}'::jsonb,         -- {"100": 1688, "20": 1}
  cash_value       numeric(18,2) not null,
  goods_top        numeric(14,4) not null,
  goods_down       numeric(14,4) not null,
  goods_value      numeric(18,2) not null,
  debt_value       numeric(18,2) not null,
  ledger_seq       bigint,                                      -- for *_expected: the ledger position it was computed at
  captured_at      timestamptz not null default now(),
  captured_by      uuid,
  unique (business_day_id, kind),
  foreign key (tenant_id, business_day_id) references gold.business_days (tenant_id, id)
);
create trigger day_balances_immutable before update or delete on gold.day_balances
  for each row execute function gold.forbid_mutation();

-- One row per asset per phase: expected vs actual, and whether it balanced.
-- Balanced / surplus / shortage is computed by the database so no client can mislabel it.
create table gold.day_reconciliations (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  business_day_id  uuid not null,
  phase            text not null check (phase in ('opening', 'closing')),   -- opening = continuity from yesterday
  asset            text not null check (asset in ('cash', 'goods_top', 'goods_down', 'goods_value', 'debt')),
  expected         numeric(18,4) not null,
  actual           numeric(18,4) not null,
  difference       numeric(18,4) generated always as (actual - expected) stored,
  outcome          text generated always as (
                     case when actual = expected then 'balanced' when actual > expected then 'surplus' else 'shortage' end
                   ) stored,
  detail           jsonb,                                       -- per-denomination difference for cash
  explanation      text,
  explained_by     uuid,
  created_at       timestamptz not null default now(),
  unique (business_day_id, phase, asset),
  foreign key (tenant_id, business_day_id) references gold.business_days (tenant_id, id),
  foreign key (tenant_id, explained_by)    references gold.users (tenant_id, id),
  -- Any surplus or shortage must come with a written explanation from whoever reported it.
  constraint difference_needs_explanation check (
    actual = expected or (explanation is not null and gold.has_text(explanation, 5) and explained_by is not null)
  )
);
create trigger day_reconciliations_immutable before update or delete on gold.day_reconciliations
  for each row execute function gold.forbid_mutation();

-- Debts owed TO a branch (customers, staff advances...). Outstanding = principal - repayments.
create table gold.debts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  branch_id     uuid not null,
  customer_id   uuid,
  party_name    text not null,
  party_type    text not null check (party_type in ('customer', 'staff', 'other')),
  principal     numeric(18,2) not null check (principal > 0),
  reason        text not null,
  issued_at     timestamptz not null,
  issued_by     uuid not null,
  due_date      date,
  status        text not null default 'open' check (status in ('open', 'settled', 'written_off')),
  closed_at     timestamptz,
  closed_by     uuid,
  close_reason  text,
  created_at    timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id)   references gold.branches (tenant_id, id),
  foreign key (tenant_id, customer_id) references gold.customers (tenant_id, id),
  foreign key (tenant_id, issued_by)   references gold.users (tenant_id, id),
  check (status = 'open' or (closed_at is not null and closed_by is not null)),
  check (status <> 'written_off' or gold.has_text(close_reason, 5))
);

create table gold.debt_repayments (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  debt_id       uuid not null,
  amount        numeric(18,2) not null check (amount > 0),
  received_at   timestamptz not null,
  received_by   uuid not null,
  note          text,
  foreign key (tenant_id, debt_id)     references gold.debts (tenant_id, id),
  foreign key (tenant_id, received_by) references gold.users (tenant_id, id)
);
create trigger debt_repayments_immutable before update or delete on gold.debt_repayments
  for each row execute function gold.forbid_mutation();

create view gold.v_debts_outstanding as
select d.*, d.principal - coalesce(r.paid, 0) as outstanding
from gold.debts d
left join lateral (select sum(amount) as paid from gold.debt_repayments x where x.debt_id = d.id) r on true;
