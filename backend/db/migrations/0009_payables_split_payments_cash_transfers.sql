-- 0009 What the business told us after B1:
--  1. A branch can OWE a customer (gold brought, not enough cash). Tracked as a payable, next to debts owed TO the branch.
--  2. A customer's payout can be split: cash from the drawer + mobile money sent by Kumasi on the branch's behalf + an amount still owed.
--  3. Money carried from Kumasi to a branch and goods taken back are two independent movements that happen on the same trip.
--     So a transfer is either goods or cash, and trips group them with a shared visit_id. Nothing is netted automatically.
-- Ledger vocabulary from here on: asset 'debt' = owed TO the branch (receivable), asset 'payable' = owed BY the branch.

-- ---- ledger: a fourth asset kind, two new causes ----
alter table gold.ledger_entries drop constraint ledger_entries_asset_check;
alter table gold.ledger_entries drop constraint ledger_shape;
alter table gold.ledger_entries drop constraint ledger_entries_source_type_check;
alter table gold.ledger_entries add constraint ledger_entries_asset_check check (asset in ('cash', 'goods', 'debt', 'payable'));
alter table gold.ledger_entries add constraint ledger_shape check (
  (asset = 'cash'  and denomination is not null and delta_count is not null and delta_count <> 0
                   and delta_top is null and delta_down is null and delta_value = denomination * delta_count)
  or (asset = 'goods' and denomination is null and delta_count is null and delta_top is not null and delta_down is not null)
  or (asset in ('debt', 'payable') and denomination is null and delta_count is null and delta_top is null and delta_down is null)
);
alter table gold.ledger_entries add constraint ledger_entries_source_type_check check (source_type in (
  'go_live_balance', 'transaction_purchase', 'transaction_payout', 'drawer_movement',
  'transfer_release', 'transfer_receipt', 'transfer_payment', 'debt_issued', 'debt_repayment',
  'payable_issued', 'payable_settlement',
  'opening_adjustment', 'closing_adjustment', 'discrepancy_resolution', 'reversal'));

drop function gold.branch_balance(uuid, bigint);
create function gold.branch_balance(p_branch uuid, p_upto_seq bigint default null)
returns table (cash_value numeric, cash_lines jsonb, goods_top numeric, goods_down numeric, goods_value numeric, debt_value numeric, payable_value numeric)
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
    coalesce((select sum(delta_value) from e where asset = 'debt'), 0),
    coalesce((select sum(delta_value) from e where asset = 'payable'), 0)
$$;

drop view gold.v_branch_timeline;
create view gold.v_branch_timeline with (security_invoker = true) as
select
  l.id, l.seq, l.tenant_id, l.branch_id, l.business_day_id, l.occurred_at, l.recorded_at, l.recorded_by,
  l.asset, l.denomination, l.delta_count, l.delta_top, l.delta_down, l.delta_value,
  l.source_type, l.source_id, l.memo, l.reverses_entry_id,
  sum(case when l.asset = 'cash'    then l.delta_value else 0 end) over w as running_cash,
  sum(case when l.asset = 'goods'   then l.delta_top   else 0 end) over w as running_goods_top,
  sum(case when l.asset = 'goods'   then l.delta_down  else 0 end) over w as running_goods_down,
  sum(case when l.asset = 'goods'   then l.delta_value else 0 end) over w as running_goods_value,
  sum(case when l.asset = 'debt'    then l.delta_value else 0 end) over w as running_debt,
  sum(case when l.asset = 'payable' then l.delta_value else 0 end) over w as running_payable
from gold.ledger_entries l
window w as (partition by l.branch_id order by l.seq rows between unbounded preceding and current row);

-- ---- days: the payable figure is reconciled too ----
alter table gold.day_balances add column payable_value numeric(18,2) not null default 0;
alter table gold.day_reconciliations drop constraint day_reconciliations_asset_check;
alter table gold.day_reconciliations add constraint day_reconciliations_asset_check
  check (asset in ('cash', 'goods_top', 'goods_down', 'goods_value', 'debt', 'payable'));
alter table gold.discrepancies drop constraint discrepancies_asset_check;
alter table gold.discrepancies add constraint discrepancies_asset_check
  check (asset in ('cash', 'goods_top', 'goods_down', 'goods_value', 'debt', 'payable'));

-- ---- debts go both ways; settlements can be by cash or by mobile money sent by another branch ----
alter table gold.debts add column direction text not null default 'receivable' check (direction in ('receivable', 'payable'));
alter table gold.debts add column source_transaction_id uuid;
alter table gold.debts add foreign key (tenant_id, source_transaction_id) references gold.transactions (tenant_id, id);
create unique index debts_one_payable_per_transaction on gold.debts (source_transaction_id)
  where direction = 'payable' and source_transaction_id is not null;

alter table gold.debt_repayments add column method text not null default 'cash' check (method in ('cash', 'mobile_money', 'bank', 'other'));
alter table gold.debt_repayments add column paid_by_branch_id uuid;
alter table gold.debt_repayments add column external_ref text;
alter table gold.debt_repayments add foreign key (tenant_id, paid_by_branch_id) references gold.branches (tenant_id, id);
alter table gold.debt_repayments add constraint momo_names_the_payer check (method <> 'mobile_money' or paid_by_branch_id is not null);

drop view gold.v_debts_outstanding;
create view gold.v_debts_outstanding with (security_invoker = true) as
select d.*, d.principal - coalesce(r.paid, 0) as outstanding
from gold.debts d
left join lateral (select sum(amount) as paid from gold.debt_repayments x where x.debt_id = d.id) r on true;

-- ---- how a transaction was actually paid ----
-- cash: notes from the drawer (the notes themselves are ledger rows). mobile_money: sent by some branch (usually Kumasi) on
-- request; it can be pending until the sender confirms. owed: not paid yet, a payable is created for the customer.
create table gold.transaction_payments (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  transaction_id    uuid not null,
  method            text not null check (method in ('cash', 'mobile_money', 'owed')),
  amount            numeric(18,2) not null check (amount > 0),
  paid_by_branch_id uuid,
  external_ref      text,
  debt_id           uuid,
  status            text not null default 'confirmed' check (status in ('pending', 'confirmed', 'failed')),
  confirmed_by      uuid,
  confirmed_at      timestamptz,
  recorded_by       uuid not null,
  note              text,
  created_at        timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, transaction_id)    references gold.transactions (tenant_id, id),
  foreign key (tenant_id, paid_by_branch_id) references gold.branches (tenant_id, id),
  foreign key (tenant_id, debt_id)           references gold.debts (tenant_id, id),
  foreign key (tenant_id, confirmed_by)      references gold.users (tenant_id, id),
  foreign key (tenant_id, recorded_by)       references gold.users (tenant_id, id),
  check (method <> 'mobile_money' or paid_by_branch_id is not null),
  check (method <> 'owed' or debt_id is not null),
  check (method = 'mobile_money' or status = 'confirmed')
);
create index transaction_payments_tx on gold.transaction_payments (transaction_id);

-- The parts must add up to what the customer is to receive (a failed mobile-money payment does not count).
-- Checked when the transaction commits, so the rows may be inserted in any order.
create function gold.check_payment_split() returns trigger language plpgsql as $$
declare paid numeric; due numeric;
begin
  select coalesce(sum(amount) filter (where status <> 'failed'), 0) into paid from gold.transaction_payments where transaction_id = new.transaction_id;
  select payable into due from gold.transactions where id = new.transaction_id;
  if paid <> due then
    raise exception 'the payments (%) must add up to the amount payable (%) for transaction %', paid, due, new.transaction_id
      using errcode = 'check_violation';
  end if;
  return null;
end $$;
create constraint trigger transaction_payments_split after insert or update on gold.transaction_payments
  deferrable initially deferred for each row execute function gold.check_payment_split();

-- A payment line is a fact. Only its confirmation can change (pending -> confirmed or failed), and only once.
create function gold.payment_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'payments cannot be deleted' using errcode = 'integrity_constraint_violation';
  end if;
  if (new.tenant_id, new.transaction_id, new.method, new.amount, new.paid_by_branch_id, new.debt_id, new.recorded_by, new.created_at)
     is distinct from
     (old.tenant_id, old.transaction_id, old.method, old.amount, old.paid_by_branch_id, old.debt_id, old.recorded_by, old.created_at) then
    raise exception 'a recorded payment cannot be changed' using errcode = 'integrity_constraint_violation';
  end if;
  if old.status <> 'pending' and new.status is distinct from old.status then
    raise exception 'a confirmed or failed payment cannot change status again' using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end $$;
create trigger transaction_payments_guard before update or delete on gold.transaction_payments
  for each row execute function gold.payment_guard();

-- ---- transfers: goods or cash, grouped into trips ----
alter table gold.transfers add column kind text not null default 'goods' check (kind in ('goods', 'cash'));
alter table gold.transfers add column visit_id uuid;
alter table gold.transfers add column declared_cash numeric(18,2);
alter table gold.transfers add column received_cash numeric(18,2);
alter table gold.transfers drop constraint released_is_complete;
alter table gold.transfers drop constraint received_is_complete;
alter table gold.transfers add constraint released_is_complete check (
  status in ('draft', 'cancelled')
  or (released_by is not null and released_at is not null and collector_type is not null and collected_at is not null
      and ((kind = 'goods' and declared_top is not null and declared_down is not null and declared_value is not null)
        or (kind = 'cash' and declared_cash is not null)))
);
alter table gold.transfers add constraint received_is_complete check (
  status not in ('received', 'received_with_discrepancy')
  or (received_by is not null and received_at is not null
      and ((kind = 'goods' and received_top is not null and received_down is not null and received_value is not null)
        or (kind = 'cash' and received_cash is not null)))
);
create index transfers_visit on gold.transfers (tenant_id, visit_id) where visit_id is not null;

-- ---- who has sent what to whom, with nothing netted off ----
-- Cash brought from Kumasi, money sent by mobile money on a branch's behalf, and goods taken away are shown side by side.
-- Whether and how they are settled against each other is a management decision, not something the system assumes.
create view gold.v_interbranch_position with (security_invoker = true) as
select tenant_id, sender_branch_id, receiver_branch_id,
       sum(cash) as cash_sent, sum(momo) as mobile_money_paid_on_behalf, sum(goods) as goods_value_sent
from (
  select tenant_id, origin_branch_id as sender_branch_id, destination_branch_id as receiver_branch_id,
         coalesce(received_cash, 0) as cash, 0::numeric as momo, 0::numeric as goods
  from gold.transfers where kind = 'cash' and status in ('received', 'received_with_discrepancy')
  union all
  select tenant_id, origin_branch_id, destination_branch_id, 0, 0, coalesce(received_value, 0)
  from gold.transfers where kind = 'goods' and status in ('received', 'received_with_discrepancy')
  union all
  select p.tenant_id, p.paid_by_branch_id, t.branch_id, 0, p.amount, 0
  from gold.transaction_payments p join gold.transactions t on t.id = p.transaction_id
  where p.method = 'mobile_money' and p.status = 'confirmed' and p.paid_by_branch_id <> t.branch_id
  union all
  select r.tenant_id, r.paid_by_branch_id, d.branch_id, 0, r.amount, 0
  from gold.debt_repayments r join gold.debts d on d.id = r.debt_id
  where r.method = 'mobile_money' and r.paid_by_branch_id <> d.branch_id
) x
group by tenant_id, sender_branch_id, receiver_branch_id;

-- ---- isolation and privileges for the new table ----
alter table gold.transaction_payments enable row level security;
alter table gold.transaction_payments force row level security;
create policy tenant_isolation on gold.transaction_payments
  using (tenant_id = gold.current_tenant()) with check (tenant_id = gold.current_tenant());

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant select, insert, update on gold.transaction_payments to gold_app;
    grant select on gold.v_interbranch_position, gold.v_debts_outstanding, gold.v_branch_timeline to gold_app;
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;