-- 0011 Operations core (B3).
--  1. Two more customer flows: gold used to settle a debt (method 'gold' / payment 'debt_offset'), and unrefined gold kept as
--     loan security (a fifth ledger asset 'custody': top weight only, no value, because it has not been refined or bought).
--  2. The rules that must be all-or-nothing live here as functions: opening a day, drawer movements, saving a purchase with its
--     payment split, confirming mobile money, loans, repayments, returning security. The API validates and calls them; they are
--     tested directly in db/tests/005_operations.sql. They run with the caller's rights, so row-level security still applies.
--  Errors carry a stable code: the message is 'CODE|human text' and the SQLSTATE is GV<http status>, which the API turns into
--  the error envelope.

-- ---------------------------------------------------------------- ledger: custody
alter table gold.ledger_entries drop constraint ledger_entries_asset_check;
alter table gold.ledger_entries drop constraint ledger_shape;
alter table gold.ledger_entries drop constraint ledger_entries_source_type_check;
alter table gold.ledger_entries add constraint ledger_entries_asset_check check (asset in ('cash', 'goods', 'debt', 'payable', 'custody'));
alter table gold.ledger_entries add constraint ledger_shape check (
  (asset = 'cash'  and denomination is not null and delta_count is not null and delta_count <> 0
                   and delta_top is null and delta_down is null and delta_value = denomination * delta_count)
  or (asset = 'goods' and denomination is null and delta_count is null and delta_top is not null and delta_down is not null)
  or (asset in ('debt', 'payable') and denomination is null and delta_count is null and delta_top is null and delta_down is null)
  or (asset = 'custody' and denomination is null and delta_count is null and delta_top is not null and delta_down is null and delta_value = 0)
);
alter table gold.ledger_entries add constraint ledger_entries_source_type_check check (source_type in (
  'go_live_balance', 'transaction_purchase', 'transaction_payout', 'drawer_movement',
  'transfer_release', 'transfer_receipt', 'transfer_payment', 'debt_issued', 'debt_repayment',
  'payable_issued', 'payable_settlement', 'custody_in', 'custody_out',
  'opening_adjustment', 'closing_adjustment', 'discrepancy_resolution', 'reversal'));

drop function gold.branch_balance(uuid, bigint);
create function gold.branch_balance(p_branch uuid, p_upto_seq bigint default null)
returns table (cash_value numeric, cash_lines jsonb, goods_top numeric, goods_down numeric, goods_value numeric,
               debt_value numeric, payable_value numeric, custody_top numeric)
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
    coalesce((select sum(delta_value) from e where asset = 'payable'), 0),
    coalesce((select sum(delta_top)   from e where asset = 'custody'), 0)
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
  sum(case when l.asset = 'payable' then l.delta_value else 0 end) over w as running_payable,
  sum(case when l.asset = 'custody' then l.delta_top   else 0 end) over w as running_custody_top
from gold.ledger_entries l
window w as (partition by l.branch_id order by l.seq rows between unbounded preceding and current row);

alter table gold.day_balances add column custody_top numeric(14,4) not null default 0;
alter table gold.day_reconciliations drop constraint day_reconciliations_asset_check;
alter table gold.day_reconciliations add constraint day_reconciliations_asset_check
  check (asset in ('cash', 'goods_top', 'goods_down', 'goods_value', 'debt', 'payable', 'custody_top'));
alter table gold.discrepancies drop constraint discrepancies_asset_check;
alter table gold.discrepancies add constraint discrepancies_asset_check
  check (asset in ('cash', 'goods_top', 'goods_down', 'goods_value', 'debt', 'payable', 'custody_top'));

alter table gold.business_days add column opening_source text not null default 'counted' check (opening_source in ('counted', 'carried'));

-- ---------------------------------------------------------------- gold used to settle a debt
alter table gold.debt_repayments drop constraint debt_repayments_method_check;
alter table gold.debt_repayments add constraint debt_repayments_method_check check (method in ('cash', 'mobile_money', 'bank', 'gold', 'other'));
alter table gold.debt_repayments add column source_transaction_id uuid;
alter table gold.debt_repayments add foreign key (tenant_id, source_transaction_id) references gold.transactions (tenant_id, id);
alter table gold.debt_repayments add constraint gold_repayment_names_transaction check (method <> 'gold' or source_transaction_id is not null);

alter table gold.transaction_payments drop constraint transaction_payments_method_check;
alter table gold.transaction_payments add constraint transaction_payments_method_check check (method in ('cash', 'mobile_money', 'owed', 'debt_offset'));
alter table gold.transaction_payments add constraint debt_offset_names_debt check (method <> 'debt_offset' or debt_id is not null);

-- ---------------------------------------------------------------- loan security (unrefined gold in custody)
create table gold.collateral_holdings (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null,
  branch_id                uuid not null,
  customer_id              uuid not null,
  debt_id                  uuid not null,
  top_weight               numeric(14,4) not null check (top_weight > 0),   -- weighed on the scale only; not refined, so no down weight and no value
  description              text,
  status                   text not null default 'held' check (status in ('held', 'converted', 'returned')),
  received_by              uuid not null,
  received_at              timestamptz not null,
  converted_transaction_id uuid,
  closed_by                uuid,
  closed_at                timestamptz,
  close_note               text,
  created_at               timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id)   references gold.branches (tenant_id, id),
  foreign key (tenant_id, customer_id) references gold.customers (tenant_id, id),
  foreign key (tenant_id, debt_id)     references gold.debts (tenant_id, id),
  foreign key (tenant_id, received_by) references gold.users (tenant_id, id),
  foreign key (tenant_id, converted_transaction_id) references gold.transactions (tenant_id, id),
  foreign key (tenant_id, closed_by)   references gold.users (tenant_id, id),
  check (status = 'held' or (closed_by is not null and closed_at is not null)),
  check (status <> 'converted' or converted_transaction_id is not null)
);
create index collateral_branch_status on gold.collateral_holdings (tenant_id, branch_id, status);
create index collateral_customer on gold.collateral_holdings (tenant_id, customer_id);

alter table gold.collateral_holdings enable row level security;
alter table gold.collateral_holdings force row level security;
create policy tenant_isolation on gold.collateral_holdings
  using (tenant_id = gold.current_tenant()) with check (tenant_id = gold.current_tenant());

-- ---------------------------------------------------------------- small helpers
create function gold.fail(p_status int, p_code text, p_message text) returns void language plpgsql as $$
begin
  raise exception '%|%', p_code, p_message using errcode = 'GV' || lpad(p_status::text, 3, '0');
end $$;

create function gold.require_actor() returns uuid language plpgsql stable as $$
declare u uuid := gold.current_actor();
begin
  if u is null then perform gold.fail(401, 'UNAUTHENTICATED', 'Please sign in.'); end if;
  return u;
end $$;

create function gold.iso(p timestamptz) returns text language sql immutable as $$
  select to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- Numbers leave as plain strings without trailing zeros ("7.77", "11650"), like the contract says.
create function gold.ts(p numeric) returns text language sql immutable as $$ select trim_scale(p)::text $$;

create function gold.person_json(p_user uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('id', id, 'displayName', display_name) from gold.users where id = p_user
$$;

-- Value of a set of notes like {"100": 3, "20": 1}; refuses anything that is not a real denomination or a positive whole count.
create function gold.lines_total(p_lines jsonb) returns numeric language plpgsql as $$
declare r record; t numeric := 0;
begin
  if p_lines is null then return 0; end if;
  if jsonb_typeof(p_lines) <> 'object' then perform gold.fail(422, 'VALIDATION_FAILED', 'Notes must be given as {"100": 3}.'); end if;
  for r in select key, value from jsonb_each_text(p_lines) loop
    if r.key !~ '^(5|10|20|50|100|200)$' then perform gold.fail(422, 'BAD_DENOMINATION', 'Notes must be 5, 10, 20, 50, 100 or 200 cedis.'); end if;
    if r.value !~ '^[1-9][0-9]{0,8}$' then perform gold.fail(422, 'BAD_COUNT', 'Note counts must be positive whole numbers.'); end if;
    t := t + r.key::int * r.value::int;
  end loop;
  return t;
end $$;

-- Cash into (+1) or out of (-1) a branch's drawer: one ledger row per denomination. Returns the value moved.
create function gold.post_cash(p_branch uuid, p_day uuid, p_at timestamptz, p_lines jsonb, p_sign int,
                               p_source text, p_source_id uuid, p_memo text default null)
returns numeric language plpgsql as $$
declare r record; total numeric := gold.lines_total(p_lines);
begin
  if p_lines is null then return 0; end if;
  for r in select key::int as denom, value::int as n from jsonb_each_text(p_lines) loop
    insert into gold.ledger_entries (tenant_id, branch_id, business_day_id, occurred_at, recorded_by, asset, denomination, delta_count,
                                     delta_value, source_type, source_id, memo)
    values (gold.current_tenant(), p_branch, p_day, p_at, gold.current_actor(), 'cash', r.denom, p_sign * r.n,
            r.denom * p_sign * r.n, p_source, p_source_id, p_memo);
  end loop;
  return total;
end $$;

-- A money asset that is not cash: 'debt' (owed to the branch) or 'payable' (owed by the branch). Signed value.
create function gold.post_value(p_asset text, p_branch uuid, p_day uuid, p_at timestamptz, p_delta numeric,
                                p_source text, p_source_id uuid, p_memo text default null)
returns void language sql as $$
  insert into gold.ledger_entries (tenant_id, branch_id, business_day_id, occurred_at, recorded_by, asset, delta_value, source_type, source_id, memo)
  values (gold.current_tenant(), p_branch, p_day, p_at, gold.current_actor(), p_asset, p_delta, p_source, p_source_id, p_memo)
$$;

create function gold.post_goods(p_branch uuid, p_day uuid, p_at timestamptz, p_top numeric, p_down numeric, p_value numeric,
                                p_source text, p_source_id uuid, p_memo text default null)
returns void language sql as $$
  insert into gold.ledger_entries (tenant_id, branch_id, business_day_id, occurred_at, recorded_by, asset, delta_top, delta_down, delta_value,
                                   source_type, source_id, memo)
  values (gold.current_tenant(), p_branch, p_day, p_at, gold.current_actor(), 'goods', p_top, p_down, p_value, p_source, p_source_id, p_memo)
$$;

create function gold.post_custody(p_branch uuid, p_day uuid, p_at timestamptz, p_top numeric, p_source text, p_source_id uuid, p_memo text default null)
returns void language sql as $$
  insert into gold.ledger_entries (tenant_id, branch_id, business_day_id, occurred_at, recorded_by, asset, delta_top, delta_value, source_type, source_id, memo)
  values (gold.current_tenant(), p_branch, p_day, p_at, gold.current_actor(), 'custody', p_top, 0, p_source, p_source_id, p_memo)
$$;

-- Notes by denomination for one cause, always shown as positive counts.
create function gold.lines_json(p_source text, p_id uuid) returns jsonb language sql stable as $$
  select coalesce(jsonb_object_agg(denomination::text, n), '{}'::jsonb)
  from (select denomination, abs(sum(delta_count)) as n from gold.ledger_entries
        where asset = 'cash' and source_type = p_source and source_id = p_id
        group by denomination having sum(delta_count) <> 0) x
$$;

create function gold.open_day_id(p_branch uuid) returns uuid language sql stable as $$
  select id from gold.business_days where branch_id = p_branch and status = 'open'
$$;

-- ---------------------------------------------------------------- prices
create function gold.current_price(p_branch uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'branchId', bp.branch_id, 'basePrice', gold.ts(s.base_price), 'margin', gold.ts(bp.margin),
    'effectivePrice', gold.ts(s.base_price + bp.margin), 'source', s.source, 'status', bp.status, 'asOf', gold.iso(s.published_at))
  from gold.branch_prices bp join gold.price_snapshots s on s.id = bp.snapshot_id
  where bp.branch_id = p_branch
  order by bp.effective_from desc, bp.created_at desc
  limit 1
$$;

-- A new reference price. Every branch that already has a margin keeps it (same status) against the new price.
create function gold.set_base_price(p_base numeric, p_published timestamptz) returns jsonb language plpgsql as $$
declare v_user uuid := gold.require_actor(); v_snap uuid;
begin
  if p_base is null or p_base <= 0 then perform gold.fail(422, 'VALIDATION_FAILED', 'The price must be above zero.'); end if;
  insert into gold.price_snapshots (tenant_id, source, base_price, published_at, created_by)
  values (gold.current_tenant(), 'manual', p_base, least(coalesce(p_published, now()), now()), v_user) returning id into v_snap;

  insert into gold.branch_prices (tenant_id, branch_id, snapshot_id, margin, status, set_by, approved_by, approved_at, effective_from, created_at)
  select l.tenant_id, l.branch_id, v_snap, l.margin, l.status, v_user, l.approved_by, l.approved_at, clock_timestamp(), clock_timestamp()
  from (select distinct on (branch_id) * from gold.branch_prices order by branch_id, effective_from desc, created_at desc) l;
  return jsonb_build_object('snapshotId', v_snap);
end $$;

create function gold.set_margin(p_branch uuid, p_margin numeric, p_approve boolean) returns jsonb language plpgsql as $$
declare v_user uuid := gold.require_actor(); v_snap uuid;
begin
  perform 1 from gold.branches where id = p_branch and is_active;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'Branch was not found.'); end if;
  if p_margin is null then perform gold.fail(422, 'VALIDATION_FAILED', 'Enter the margin.'); end if;
  select id into v_snap from gold.price_snapshots order by published_at desc, fetched_at desc limit 1;
  if v_snap is null then perform gold.fail(409, 'NO_BASE_PRICE', 'Set the reference price first.'); end if;
  insert into gold.branch_prices (tenant_id, branch_id, snapshot_id, margin, status, set_by, approved_by, approved_at, effective_from, created_at)
  values (gold.current_tenant(), p_branch, v_snap, p_margin, case when p_approve then 'approved' else 'provisional' end, v_user,
          case when p_approve then v_user end, case when p_approve then now() end, clock_timestamp(), clock_timestamp());
  return gold.current_price(p_branch);
end $$;

create function gold.approve_margin(p_branch uuid) returns jsonb language plpgsql as $$
declare v_user uuid := gold.require_actor(); l gold.branch_prices;
begin
  select * into l from gold.branch_prices where branch_id = p_branch order by effective_from desc, created_at desc limit 1;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'No price has been set for this branch.'); end if;
  if l.status = 'provisional' then
    insert into gold.branch_prices (tenant_id, branch_id, snapshot_id, margin, status, set_by, approved_by, approved_at, effective_from, created_at)
    values (l.tenant_id, l.branch_id, l.snapshot_id, l.margin, 'approved', l.set_by, v_user, now(), clock_timestamp(), clock_timestamp());
  end if;
  return gold.current_price(p_branch);
end $$;

-- ---------------------------------------------------------------- days and the drawer
create function gold.day_json(p_day uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', d.id, 'branchId', d.branch_id, 'businessDate', d.business_date, 'status', d.status,
    'opening', jsonb_build_object(
        'lines', coalesce((select cash_lines from gold.day_balances where business_day_id = d.id and kind = 'opening_declared'), '{}'::jsonb),
        'source', d.opening_source),
    'openedAt', gold.iso(d.opened_at), 'openedBy', gold.person_json(d.opened_by),
    'closing', null,
    'flags', to_jsonb(array_remove(array[
        case when d.opened_offline then 'OFFLINE_ENTRY' end,
        case when exists (select 1 from gold.day_reconciliations r where r.business_day_id = d.id and r.phase = 'opening' and r.detail is not null)
             then 'OPENING_DIFFERS' end], null)))
  from gold.business_days d where d.id = p_day
$$;

create function gold.movement_json(p_id uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('id', m.id, 'dayId', m.business_day_id, 'kind', m.kind, 'lines', gold.lines_json('drawer_movement', m.id),
                            'note', m.note, 'capturedAt', gold.iso(m.occurred_at), 'createdBy', gold.person_json(m.created_by))
  from gold.drawer_movements m where m.id = p_id
$$;

create function gold.day_state(p_branch uuid) returns jsonb language plpgsql stable as $$
declare d gold.business_days; bal record; v_carry jsonb := null;
begin
  select * into d from gold.business_days where branch_id = p_branch order by (status = 'open') desc, business_date desc limit 1;
  select * into bal from gold.branch_balance(p_branch);
  if exists (select 1 from gold.ledger_entries where branch_id = p_branch) then
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_carry from jsonb_each(bal.cash_lines) where (value #>> '{}')::int > 0;
  end if;
  return jsonb_build_object(
    'day', case when d.id is null then null else gold.day_json(d.id) end,
    'balance', case when d.status = 'open' then bal.cash_lines else null end,
    'movements', case when d.id is null then '[]'::jsonb else
        coalesce((select jsonb_agg(gold.movement_json(m.id) order by m.occurred_at, m.created_at)
                  from gold.drawer_movements m where m.business_day_id = d.id), '[]'::jsonb) end,
    'appliedIds', case when d.id is null then '[]'::jsonb else
        coalesce((select jsonb_agg(x) from (
           select d.id::text as x
           union select source_id::text from gold.ledger_entries
                 where business_day_id = d.id and source_type in ('transaction_payout', 'drawer_movement', 'debt_issued', 'debt_repayment', 'payable_settlement')
        ) ids), '[]'::jsonb) end,
    'carryOver', v_carry,
    'asOf', gold.iso(now()));
end $$;

-- Open a day with a counted drawer. Yesterday's closing becomes today's expected opening; a different count needs a written reason
-- and is posted as an opening adjustment, so the ledger always agrees with what was physically there.
create function gold.open_day(p jsonb) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant();
  v_user uuid := gold.require_actor();
  v_id uuid := (p->>'id')::uuid;
  v_branch uuid := (p->>'branchId')::uuid;
  v_date date := (p->>'businessDate')::date;
  v_at timestamptz := least((p->>'capturedAt')::timestamptz, now());
  v_source text := coalesce(p->>'source', 'counted');
  v_lines jsonb := coalesce(p->'lines', '{}'::jsonb);
  v_expl text := nullif(trim(coalesce(p->>'explanation', '')), '');
  bal record; r record;
  v_seq bigint; v_history boolean; v_prev uuid;
  v_detail jsonb := '{}'::jsonb; v_pos jsonb := '{}'::jsonb; v_neg jsonb := '{}'::jsonb; v_declared numeric;
begin
  if exists (select 1 from gold.business_days where id = v_id) then
    return jsonb_build_object('replayed', true, 'data', gold.day_json(v_id));
  end if;
  perform 1 from gold.branches where id = v_branch and is_active for update;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'Branch was not found.'); end if;
  if v_source not in ('counted', 'carried') then perform gold.fail(422, 'VALIDATION_FAILED', 'source must be counted or carried.'); end if;
  if exists (select 1 from gold.business_days where branch_id = v_branch and status = 'open') then
    perform gold.fail(409, 'DAY_ALREADY_OPEN', 'A day is already open for this branch.');
  end if;
  if exists (select 1 from gold.business_days where branch_id = v_branch and business_date = v_date) then
    perform gold.fail(409, 'DAY_ALREADY_OPEN', 'This branch already has a day for that date.');
  end if;

  select * into bal from gold.branch_balance(v_branch);
  select max(seq) into v_seq from gold.ledger_entries where branch_id = v_branch;
  v_history := v_seq is not null;
  if v_source = 'carried' then
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_lines from jsonb_each(bal.cash_lines) where (value #>> '{}')::int > 0;
  end if;
  v_declared := gold.lines_total(v_lines);
  select id into v_prev from gold.business_days where branch_id = v_branch order by business_date desc limit 1;

  insert into gold.business_days (id, tenant_id, branch_id, business_date, previous_day_id, opened_at, opened_by, opened_offline, opening_source)
  values (v_id, v_tenant, v_branch, v_date, v_prev, v_at, v_user, (now() - v_at) > interval '2 minutes', v_source);

  insert into gold.day_balances (tenant_id, business_day_id, kind, cash_lines, cash_value, goods_top, goods_down, goods_value, debt_value,
                                 payable_value, custody_top, ledger_seq, captured_by)
  values (v_tenant, v_id, 'opening_expected', bal.cash_lines, bal.cash_value, bal.goods_top, bal.goods_down, bal.goods_value, bal.debt_value,
          bal.payable_value, bal.custody_top, v_seq, v_user);

  if not v_history then
    perform gold.post_cash(v_branch, v_id, v_at, v_lines, 1, 'go_live_balance', v_id, 'First count of the drawer');
  else
    for r in
      select coalesce(e.k, d.k) as denom, coalesce(d.n, 0) - coalesce(e.n, 0) as delta
      from (select key::int as k, value::int as n from jsonb_each_text(bal.cash_lines)) e
      full join (select key::int as k, value::int as n from jsonb_each_text(v_lines)) d on d.k = e.k
      where coalesce(d.n, 0) <> coalesce(e.n, 0)
    loop
      v_detail := v_detail || jsonb_build_object(r.denom::text, r.delta);
      if r.delta > 0 then v_pos := v_pos || jsonb_build_object(r.denom::text, r.delta);
      else v_neg := v_neg || jsonb_build_object(r.denom::text, -r.delta); end if;
    end loop;

    if v_detail <> '{}'::jsonb then
      if v_expl is null or not gold.has_text(v_expl, 5) then
        perform gold.fail(422, 'EXPLANATION_REQUIRED',
          'The count differs from what the books say the drawer holds. Write why (at least 5 characters).');
      end if;
      perform gold.post_cash(v_branch, v_id, v_at, v_pos, 1, 'opening_adjustment', v_id, v_expl);
      perform gold.post_cash(v_branch, v_id, v_at, v_neg, -1, 'opening_adjustment', v_id, v_expl);
      insert into gold.day_reconciliations (tenant_id, business_day_id, phase, asset, expected, actual, detail, explanation, explained_by)
      values (v_tenant, v_id, 'opening', 'cash', bal.cash_value, v_declared, v_detail, v_expl, v_user);
    end if;
  end if;

  insert into gold.day_balances (tenant_id, business_day_id, kind, cash_lines, cash_value, goods_top, goods_down, goods_value, debt_value,
                                 payable_value, custody_top, captured_by)
  values (v_tenant, v_id, 'opening_declared', v_lines, v_declared, bal.goods_top, bal.goods_down, bal.goods_value, bal.debt_value,
          bal.payable_value, bal.custody_top, v_user);

  return jsonb_build_object('replayed', false, 'data', gold.day_json(v_id));
end $$;

create function gold.record_movement(p jsonb) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant();
  v_user uuid := gold.require_actor();
  v_id uuid := (p->>'id')::uuid;
  v_day uuid := (p->>'dayId')::uuid;
  v_branch uuid := (p->>'branchId')::uuid;
  v_kind text := p->>'kind';
  v_note text := trim(coalesce(p->>'note', ''));
  v_at timestamptz := least((p->>'capturedAt')::timestamptz, now());
  d gold.business_days;
begin
  if exists (select 1 from gold.drawer_movements where id = v_id) then
    return jsonb_build_object('replayed', true, 'data', gold.movement_json(v_id));
  end if;
  select * into d from gold.business_days where id = v_day and branch_id = v_branch;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That day was not found.'); end if;
  if d.status <> 'open' then perform gold.fail(409, 'DAY_CLOSED', 'This day is closed.'); end if;
  if v_kind not in ('topup', 'withdrawal') then perform gold.fail(422, 'VALIDATION_FAILED', 'kind must be topup or withdrawal.'); end if;
  if not gold.has_text(v_note, 1) then perform gold.fail(422, 'VALIDATION_FAILED', 'Write a note saying what the money is for.'); end if;
  if gold.lines_total(p->'lines') = 0 then perform gold.fail(422, 'VALIDATION_FAILED', 'Enter at least one note.'); end if;

  insert into gold.drawer_movements (id, tenant_id, branch_id, business_day_id, kind, note, occurred_at, created_by)
  values (v_id, v_tenant, v_branch, v_day, v_kind, v_note, v_at, v_user);
  perform gold.post_cash(v_branch, v_day, v_at, p->'lines', case when v_kind = 'topup' then 1 else -1 end, 'drawer_movement', v_id, v_note);
  return jsonb_build_object('replayed', false, 'data', gold.movement_json(v_id));
end $$;

-- ---------------------------------------------------------------- customers
create function gold.ensure_customer(p_id uuid, p_name text, p_phone text) returns uuid language plpgsql as $$
declare v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '\s', '', 'g'), ''); v_id uuid;
begin
  if p_id is not null then
    perform 1 from gold.customers where id = p_id;
    if not found then perform gold.fail(404, 'NOT_FOUND', 'Customer was not found.'); end if;
    return p_id;
  end if;
  if v_phone is null then return null; end if;
  select id into v_id from gold.customers where lower(name) = lower(trim(p_name)) and phone = v_phone limit 1;
  if v_id is null then
    insert into gold.customers (tenant_id, name, phone, created_by) values (gold.current_tenant(), trim(p_name), v_phone, gold.current_actor())
    returning id into v_id;
  end if;
  return v_id;
end $$;

create function gold.customers_json(p_q text, p_limit int default 20) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'phone', phone)), '[]'::jsonb)
  from (select * from gold.customers
        where p_q is null or lower(name) like '%' || lower(p_q) || '%' or phone like '%' || p_q || '%'
        order by name limit least(coalesce(p_limit, 20), 50)) c
$$;

-- ---------------------------------------------------------------- debts (both directions) and security
create function gold.debt_json(p_id uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', d.id, 'branchId', d.branch_id, 'direction', d.direction,
    'party', jsonb_build_object('type', d.party_type, 'name', d.party_name, 'customerId', d.customer_id, 'phone', c.phone),
    'principal', gold.ts(d.principal), 'repaid', gold.ts(d.principal - d.outstanding), 'outstanding', gold.ts(d.outstanding),
    'reason', d.reason, 'issuedAt', gold.iso(d.issued_at), 'dueDate', d.due_date, 'status', d.status,
    'sourceTransactionId', d.source_transaction_id,
    'collateral', (select jsonb_build_object('id', h.id, 'topWeight', gold.ts(h.top_weight), 'status', h.status, 'description', h.description)
                   from gold.collateral_holdings h where h.debt_id = d.id limit 1),
    'repayments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'amount', gold.ts(r.amount), 'method', r.method, 'receivedAt', gold.iso(r.received_at),
        'receivedBy', gold.person_json(r.received_by), 'paidByBranchId', r.paid_by_branch_id, 'externalRef', r.external_ref,
        'transactionId', r.source_transaction_id, 'note', r.note) order by r.received_at, r.id)
        from gold.debt_repayments r where r.debt_id = d.id), '[]'::jsonb))
  from gold.v_debts_outstanding d left join gold.customers c on c.id = d.customer_id
  where d.id = p_id
$$;

create function gold.debts_json(p_branch uuid, p_direction text, p_open_only boolean, p_customer uuid, p_limit int default 100)
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(gold.debt_json(id) order by issued_at desc), '[]'::jsonb)
  from (select id, issued_at from gold.debts
        where branch_id = p_branch and (p_direction is null or direction = p_direction)
          and (not coalesce(p_open_only, false) or status = 'open')
          and (p_customer is null or customer_id = p_customer)
        order by issued_at desc limit least(coalesce(p_limit, 100), 200)) x
$$;

-- Lend cash (optionally against unrefined gold kept as security). Customer name and phone are required for customers.
create function gold.issue_loan(p jsonb) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant();
  v_user uuid := gold.require_actor();
  v_id uuid := (p->>'id')::uuid;
  v_branch uuid := (p->>'branchId')::uuid;
  v_principal numeric := (p->>'principal')::numeric;
  v_at timestamptz := least((p->>'capturedAt')::timestamptz, now());
  v_type text := coalesce(p->>'partyType', 'customer');
  v_name text := trim(coalesce(p#>>'{customer,name}', ''));
  v_customer uuid;
  v_day uuid; v_holding uuid;
  v_top numeric := nullif(p#>>'{collateral,topWeight}', '')::numeric;
begin
  if exists (select 1 from gold.debts where id = v_id) then
    return jsonb_build_object('replayed', true, 'data', gold.debt_json(v_id));
  end if;
  perform 1 from gold.branches where id = v_branch and is_active;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'Branch was not found.'); end if;
  if v_principal is null or v_principal <= 0 or v_principal <> trunc(v_principal) then
    perform gold.fail(422, 'VALIDATION_FAILED', 'The loan must be a whole number of cedis above zero.');
  end if;
  if v_type not in ('customer', 'staff', 'other') then perform gold.fail(422, 'VALIDATION_FAILED', 'Unknown party type.'); end if;
  if not gold.has_text(v_name, 1) then perform gold.fail(422, 'VALIDATION_FAILED', 'Enter the borrower''s name.'); end if;
  if gold.lines_total(p->'lines') <> v_principal then
    perform gold.fail(422, 'PAYOUT_MISMATCH', 'The notes handed over do not add up to the loan.');
  end if;
  v_customer := gold.ensure_customer((p#>>'{customer,id}')::uuid, v_name, p#>>'{customer,phone}');
  if v_type = 'customer' and v_customer is null then
    perform gold.fail(422, 'CUSTOMER_REQUIRED', 'A name and phone number are needed to lend to a customer.');
  end if;
  if v_top is not null and (v_top <= 0 or v_customer is null) then
    perform gold.fail(422, 'VALIDATION_FAILED', 'Security needs a weight above zero and a customer.');
  end if;
  v_day := gold.open_day_id(v_branch);

  insert into gold.debts (id, tenant_id, branch_id, customer_id, party_name, party_type, principal, reason, issued_at, issued_by, due_date, direction)
  values (v_id, v_tenant, v_branch, v_customer, v_name, v_type, v_principal, coalesce(nullif(trim(p->>'reason'), ''), 'Loan'), v_at, v_user,
          nullif(p->>'dueDate', '')::date, 'receivable');
  perform gold.post_value('debt', v_branch, v_day, v_at, v_principal, 'debt_issued', v_id, 'Loan');
  perform gold.post_cash(v_branch, v_day, v_at, p->'lines', -1, 'debt_issued', v_id, 'Loan paid out');

  if v_top is not null then
    insert into gold.collateral_holdings (tenant_id, branch_id, customer_id, debt_id, top_weight, description, received_by, received_at)
    values (v_tenant, v_branch, v_customer, v_id, v_top, nullif(trim(p#>>'{collateral,description}'), ''), v_user, v_at)
    returning id into v_holding;
    perform gold.post_custody(v_branch, v_day, v_at, v_top, 'custody_in', v_holding, 'Unrefined gold kept as security');
  end if;
  return jsonb_build_object('replayed', false, 'data', gold.debt_json(v_id));
end $$;

-- A payment on a debt. Owed TO the branch: cash comes into the drawer (or mobile money reaches the company). Owed BY the branch:
-- cash leaves the drawer, or another branch sends mobile money on its behalf.
create function gold.repay_debt(p jsonb) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant();
  v_user uuid := gold.require_actor();
  v_id uuid := (p->>'id')::uuid;
  v_debt uuid := (p->>'debtId')::uuid;
  v_amount numeric := (p->>'amount')::numeric;
  v_method text := coalesce(p->>'method', 'cash');
  v_at timestamptz := least((p->>'capturedAt')::timestamptz, now());
  d record; v_day uuid; v_payer uuid := nullif(p->>'paidByBranchId', '')::uuid;
begin
  if exists (select 1 from gold.debt_repayments where id = v_id) then
    return jsonb_build_object('replayed', true, 'data', gold.debt_json(v_debt));
  end if;
  perform 1 from gold.debts where id = v_debt for update;
  select * into d from gold.v_debts_outstanding where id = v_debt;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'Debt was not found.'); end if;
  if d.status <> 'open' then perform gold.fail(409, 'DEBT_CLOSED', 'This debt is already closed.'); end if;
  if v_method not in ('cash', 'mobile_money', 'bank', 'other') then
    perform gold.fail(422, 'VALIDATION_FAILED', 'Gold repayments are made by buying the gold, not here.');
  end if;
  if v_amount is null or v_amount <= 0 then perform gold.fail(422, 'VALIDATION_FAILED', 'Enter the amount.'); end if;
  if v_amount > d.outstanding then perform gold.fail(422, 'OVERPAYMENT', 'That is more than is outstanding (' || gold.ts(d.outstanding) || ').'); end if;
  if v_method = 'cash' and gold.lines_total(p->'lines') <> v_amount then
    perform gold.fail(422, 'PAYOUT_MISMATCH', 'The notes do not add up to the amount.');
  end if;
  if v_method = 'mobile_money' then
    v_payer := coalesce(v_payer, case when d.direction = 'receivable' then d.branch_id end);
    if v_payer is null then perform gold.fail(422, 'VALIDATION_FAILED', 'Say which branch sent the mobile money.'); end if;
  end if;
  v_day := gold.open_day_id(d.branch_id);

  insert into gold.debt_repayments (id, tenant_id, debt_id, amount, received_at, received_by, note, method, paid_by_branch_id, external_ref)
  values (v_id, v_tenant, v_debt, v_amount, v_at, v_user, nullif(trim(p->>'note'), ''), v_method, v_payer, nullif(trim(p->>'externalRef'), ''));

  if d.direction = 'receivable' then
    perform gold.post_value('debt', d.branch_id, v_day, v_at, -v_amount, 'debt_repayment', v_id, 'Debt repayment');
    if v_method = 'cash' then perform gold.post_cash(d.branch_id, v_day, v_at, p->'lines', 1, 'debt_repayment', v_id, 'Debt repayment'); end if;
  else
    perform gold.post_value('payable', d.branch_id, v_day, v_at, -v_amount, 'payable_settlement', v_id, 'Owed amount paid');
    if v_method = 'cash' then perform gold.post_cash(d.branch_id, v_day, v_at, p->'lines', -1, 'payable_settlement', v_id, 'Owed amount paid'); end if;
  end if;

  if v_amount = d.outstanding then
    update gold.debts set status = 'settled', closed_at = v_at, closed_by = v_user where id = v_debt;
  end if;
  return jsonb_build_object('replayed', false, 'data', gold.debt_json(v_debt));
end $$;

create function gold.collateral_json(p_id uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', h.id, 'branchId', h.branch_id, 'debtId', h.debt_id, 'status', h.status, 'topWeight', gold.ts(h.top_weight),
    'description', h.description, 'receivedAt', gold.iso(h.received_at), 'receivedBy', gold.person_json(h.received_by),
    'customer', jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone),
    'debtOutstanding', (select gold.ts(outstanding) from gold.v_debts_outstanding where id = h.debt_id),
    'convertedTransactionId', h.converted_transaction_id, 'closedAt', case when h.closed_at is null then null else gold.iso(h.closed_at) end,
    'closeNote', h.close_note)
  from gold.collateral_holdings h join gold.customers c on c.id = h.customer_id
  where h.id = p_id
$$;

create function gold.collateral_list_json(p_branch uuid, p_status text) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(gold.collateral_json(id) order by received_at desc), '[]'::jsonb)
  from (select id, received_at from gold.collateral_holdings
        where branch_id = p_branch and (p_status is null or status = p_status) order by received_at desc limit 200) x
$$;

-- Hand the unrefined gold back. Only when the loan is fully paid; otherwise it is refined and valued through a purchase.
create function gold.return_collateral(p_id uuid, p_note text) returns jsonb language plpgsql as $$
declare v_user uuid := gold.require_actor(); h gold.collateral_holdings; v_out numeric;
begin
  select * into h from gold.collateral_holdings where id = p_id for update;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That security was not found.'); end if;
  if h.status <> 'held' then perform gold.fail(409, 'COLLATERAL_NOT_HELD', 'This gold is no longer held.'); end if;
  select outstanding into v_out from gold.v_debts_outstanding where id = h.debt_id;
  if v_out > 0 then perform gold.fail(409, 'DEBT_NOT_SETTLED', 'The loan still has ' || gold.ts(v_out) || ' outstanding.'); end if;
  update gold.collateral_holdings set status = 'returned', closed_by = v_user, closed_at = now(), close_note = nullif(trim(p_note), '') where id = p_id;
  perform gold.post_custody(h.branch_id, gold.open_day_id(h.branch_id), now(), -h.top_weight, 'custody_out', p_id, 'Gold handed back unrefined');
  return gold.collateral_json(p_id);
end $$;

-- ---------------------------------------------------------------- transactions
create function gold.payment_json(p_id uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('id', id, 'method', method, 'amount', gold.ts(amount), 'status', status, 'paidByBranchId', paid_by_branch_id,
                            'externalRef', external_ref, 'debtId', debt_id, 'confirmedAt', case when confirmed_at is null then null else gold.iso(confirmed_at) end)
  from gold.transaction_payments where id = p_id
$$;

create function gold.transaction_json(p_id uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', t.id, 'branchId', t.branch_id, 'reference', t.reference, 'customerId', t.customer_id,
    'customerName', t.customer_name, 'customerPhone', t.customer_phone, 'status', t.status,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'label', i.label, 'top', gold.ts(i.top), 'down', gold.ts(i.down), 'price', gold.ts(i.price),
        'result', jsonb_build_object('density', gold.ts(i.density), 'karat', gold.ts(i.karat), 'purity', gold.ts(i.purity),
                                     'netWeight', gold.ts(i.net_weight), 'pounds', gold.ts(i.pounds), 'amount', gold.ts(i.amount))) order by i.line_no)
        from gold.transaction_items i where i.transaction_id = t.id), '[]'::jsonb),
    'formulaVersion', t.formula_version, 'calculatedAmount', gold.ts(t.calculated_amount),
    'payout', jsonb_build_object(
        'policy', t.payout_policy, 'strategy', t.payout_strategy, 'payable', gold.ts(t.payable),
        'lines', gold.lines_json('transaction_payout', t.id), 'difference', gold.ts(t.payout_difference),
        'totalNotes', (select coalesce(sum(abs(delta_count)), 0) from gold.ledger_entries
                       where asset = 'cash' and source_type = 'transaction_payout' and source_id = t.id)),
    'payments', coalesce((select jsonb_agg(gold.payment_json(p.id) order by p.created_at, p.id)
                          from gold.transaction_payments p where p.transaction_id = t.id), '[]'::jsonb),
    'capturedAt', gold.iso(t.captured_at), 'createdAt', gold.iso(t.created_at), 'createdBy', gold.person_json(t.created_by),
    'flags', to_jsonb(t.flags))
  from gold.transactions t where t.id = p_id
$$;

create function gold.transactions_json(p_branch uuid, p_limit int) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(gold.transaction_json(id) order by created_at desc), '[]'::jsonb)
  from (select id, created_at from gold.transactions where branch_id = p_branch order by created_at desc limit least(coalesce(p_limit, 50), 200)) x
$$;

-- One part of how a purchase was paid, with its effect on the books.
create function gold.apply_payment(p_tx uuid, p_branch uuid, p_day uuid, p_at timestamptz, p_customer uuid, p_ref text, p jsonb)
returns void language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant();
  v_user uuid := gold.require_actor();
  v_method text := p->>'method';
  v_amount numeric := (p->>'amount')::numeric;
  v_pay uuid := gen_random_uuid();
  v_debt uuid; v_repay uuid; d record; v_payer uuid;
begin
  if v_amount is null or v_amount <= 0 or v_amount <> trunc(v_amount) then
    perform gold.fail(422, 'VALIDATION_FAILED', 'Each part of the payment must be a whole number of cedis above zero.');
  end if;

  if v_method = 'cash' then
    if gold.lines_total(p->'lines') <> v_amount then perform gold.fail(422, 'PAYOUT_MISMATCH', 'The notes do not add up to the cash amount.'); end if;
    insert into gold.transaction_payments (id, tenant_id, transaction_id, method, amount, recorded_by) values (v_pay, v_tenant, p_tx, 'cash', v_amount, v_user);
    perform gold.post_cash(p_branch, p_day, p_at, p->'lines', -1, 'transaction_payout', p_tx, 'Paid for ' || p_ref);

  elsif v_method = 'mobile_money' then
    v_payer := nullif(p->>'paidByBranchId', '')::uuid;
    if v_payer is null then perform gold.fail(422, 'VALIDATION_FAILED', 'Say which branch sends the mobile money.'); end if;
    perform 1 from gold.branches where id = v_payer and is_active;
    if not found then perform gold.fail(404, 'NOT_FOUND', 'The sending branch was not found.'); end if;
    insert into gold.transaction_payments (id, tenant_id, transaction_id, method, amount, paid_by_branch_id, external_ref, status, recorded_by, note)
    values (v_pay, v_tenant, p_tx, 'mobile_money', v_amount, v_payer, nullif(trim(p->>'externalRef'), ''),
            coalesce(nullif(p->>'status', ''), 'pending'), v_user, nullif(trim(p->>'note'), ''));

  elsif v_method = 'owed' then
    if p_customer is null then
      perform gold.fail(422, 'CUSTOMER_REQUIRED', 'A name and phone number are needed when the branch will owe the customer.');
    end if;
    if exists (select 1 from gold.debts where source_transaction_id = p_tx and direction = 'payable') then
      perform gold.fail(409, 'ALREADY_OWED_RECORDED', 'An owed amount is already recorded for this purchase.');
    end if;
    v_debt := gen_random_uuid();
    insert into gold.debts (id, tenant_id, branch_id, customer_id, party_name, party_type, principal, reason, issued_at, issued_by, due_date,
                            direction, source_transaction_id)
    select v_debt, v_tenant, p_branch, p_customer, c.name, 'customer', v_amount, 'Still owed for gold bought (' || p_ref || ')', p_at, v_user,
           nullif(p->>'dueDate', '')::date, 'payable', p_tx
    from gold.customers c where c.id = p_customer;
    insert into gold.transaction_payments (id, tenant_id, transaction_id, method, amount, debt_id, recorded_by, note)
    values (v_pay, v_tenant, p_tx, 'owed', v_amount, v_debt, v_user, nullif(trim(p->>'note'), ''));
    perform gold.post_value('payable', p_branch, p_day, p_at, v_amount, 'payable_issued', v_debt, 'Owed to the customer for ' || p_ref);

  elsif v_method = 'debt_offset' then
    v_debt := nullif(p->>'debtId', '')::uuid;
    perform 1 from gold.debts where id = v_debt for update;
    select * into d from gold.v_debts_outstanding where id = v_debt;
    if not found then perform gold.fail(404, 'NOT_FOUND', 'Debt was not found.'); end if;
    if d.direction <> 'receivable' or d.status <> 'open' then perform gold.fail(409, 'DEBT_CLOSED', 'That debt is not open.'); end if;
    if d.branch_id <> p_branch then perform gold.fail(422, 'VALIDATION_FAILED', 'The debt belongs to another branch.'); end if;
    if p_customer is null or d.customer_id is distinct from p_customer then
      perform gold.fail(422, 'DEBT_NOT_CUSTOMERS', 'That debt is not this customer''s. Check the name and phone.');
    end if;
    if v_amount > d.outstanding then perform gold.fail(422, 'OVERPAYMENT', 'That is more than the customer owes (' || gold.ts(d.outstanding) || ').'); end if;
    v_repay := gen_random_uuid();
    insert into gold.debt_repayments (id, tenant_id, debt_id, amount, received_at, received_by, method, source_transaction_id, note)
    values (v_repay, v_tenant, v_debt, v_amount, p_at, v_user, 'gold', p_tx, 'Settled with gold ' || p_ref);
    insert into gold.transaction_payments (id, tenant_id, transaction_id, method, amount, debt_id, recorded_by)
    values (v_pay, v_tenant, p_tx, 'debt_offset', v_amount, v_debt, v_user);
    perform gold.post_value('debt', p_branch, p_day, p_at, -v_amount, 'debt_repayment', v_repay, 'Settled with gold ' || p_ref);
    if v_amount = d.outstanding then update gold.debts set status = 'settled', closed_at = p_at, closed_by = v_user where id = v_debt; end if;
  else
    perform gold.fail(422, 'VALIDATION_FAILED', 'Unknown payment method.');
  end if;
end $$;

create function gold.post_transaction(p jsonb) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant();
  v_user uuid := gold.require_actor();
  v_id uuid := (p->>'id')::uuid;
  v_branch uuid := (p->>'branchId')::uuid;
  v_at timestamptz := (p->>'capturedAt')::timestamptz;
  v_payable numeric := (p->>'payable')::numeric;
  v_name text := trim(coalesce(p#>>'{customer,name}', ''));
  v_phone text := nullif(regexp_replace(coalesce(p#>>'{customer,phone}', ''), '\s', '', 'g'), '');
  b gold.branches; v_customer uuid; v_day uuid; v_flags text[]; v_ref text; v_n int; v_local date;
  pay jsonb; v_sum numeric := 0; v_top numeric; v_down numeric; h gold.collateral_holdings;
begin
  if exists (select 1 from gold.transactions where id = v_id) then
    return jsonb_build_object('replayed', true, 'data', gold.transaction_json(v_id));
  end if;
  select * into b from gold.branches where id = v_branch and is_active;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'Branch was not found.'); end if;
  if not gold.has_text(v_name, 1) then perform gold.fail(422, 'VALIDATION_FAILED', 'Enter the customer name.'); end if;
  if not exists (select 1 from gold.formula_versions where key = p->>'formulaVersion') then
    perform gold.fail(409, 'FORMULA_NOT_CONFIGURED', 'The calculation settings are missing for this company. Run the seed command.');
  end if;
  if v_payable is null or v_payable < 0 or v_payable <> trunc(v_payable) or mod(v_payable, 5) <> 0 then
    perform gold.fail(422, 'PAYOUT_MISMATCH', 'The amount to pay must be a whole number of cedis, a multiple of 5.');
  end if;
  for pay in select * from jsonb_array_elements(coalesce(p->'payments', '[]'::jsonb)) loop
    v_sum := v_sum + (pay->>'amount')::numeric;
  end loop;
  if v_sum <> v_payable then
    perform gold.fail(422, 'PAYOUT_MISMATCH', 'The parts of the payment (' || gold.ts(v_sum) || ') must add up to the amount to pay (' || gold.ts(v_payable) || ').');
  end if;

  v_customer := gold.ensure_customer((p#>>'{customer,id}')::uuid, v_name, v_phone);
  v_day := gold.open_day_id(v_branch);
  v_flags := coalesce(array(select jsonb_array_elements_text(coalesce(p->'flags', '[]'::jsonb))), '{}');
  if v_day is null then v_flags := array_append(v_flags, 'NO_OPEN_DAY'); end if;

  v_local := (v_at at time zone b.timezone)::date;
  v_n := gold.next_document_number(v_tenant, 'transaction', v_branch, v_local);
  v_ref := b.code || '-' || to_char(v_local, 'YYYYMMDD') || '-' || lpad(v_n::text, 4, '0');

  insert into gold.transactions (id, tenant_id, branch_id, business_day_id, reference, customer_id, customer_name, customer_phone, status,
                                 formula_version, price_as_of, client_amount, calculated_amount, payout_policy, payout_strategy, payable,
                                 payout_difference, captured_at, created_by, flags)
  values (v_id, v_tenant, v_branch, v_day, v_ref, v_customer, v_name, v_phone, 'saved', p->>'formulaVersion', (p->>'priceAsOf')::timestamptz,
          (p->>'clientAmount')::numeric, (p->>'calculatedAmount')::numeric, p->>'policy', p->>'strategy', v_payable,
          (p->>'difference')::numeric, v_at, v_user, v_flags);

  insert into gold.transaction_items (id, tenant_id, transaction_id, line_no, label, top, down, price, density, karat, purity, net_weight, pounds,
                                      amount, location_branch_id)
  select (i->>'id')::uuid, v_tenant, v_id, ord::smallint, nullif(trim(coalesce(i->>'label', '')), ''), (i->>'top')::numeric, (i->>'down')::numeric,
         (i->>'price')::numeric, (i->>'density')::numeric, (i->>'karat')::numeric, (i->>'purity')::numeric, (i->>'netWeight')::numeric,
         (i->>'pounds')::numeric, (i->>'amount')::numeric, v_branch
  from jsonb_array_elements(p->'items') with ordinality as t(i, ord);

  for pay in select * from jsonb_array_elements(coalesce(p->'payments', '[]'::jsonb)) loop
    perform gold.apply_payment(v_id, v_branch, v_day, v_at, v_customer, v_ref, pay);
  end loop;

  select sum(top), sum(down) into v_top, v_down from gold.transaction_items where transaction_id = v_id;
  perform gold.post_goods(v_branch, v_day, v_at, v_top, v_down, v_payable, 'transaction_purchase', v_id, 'Gold bought ' || v_ref);

  if nullif(p->>'collateralId', '') is not null then
    select * into h from gold.collateral_holdings where id = (p->>'collateralId')::uuid for update;
    if not found then perform gold.fail(404, 'NOT_FOUND', 'That security was not found.'); end if;
    if h.status <> 'held' then perform gold.fail(409, 'COLLATERAL_NOT_HELD', 'This gold is no longer held.'); end if;
    if h.branch_id <> v_branch or h.customer_id is distinct from v_customer then
      perform gold.fail(422, 'COLLATERAL_MISMATCH', 'This security belongs to another customer or branch.');
    end if;
    update gold.collateral_holdings set status = 'converted', converted_transaction_id = v_id, closed_by = v_user, closed_at = v_at where id = h.id;
    perform gold.post_custody(v_branch, v_day, v_at, -h.top_weight, 'custody_out', h.id, 'Refined and bought ' || v_ref);
  end if;

  return jsonb_build_object('replayed', false, 'data', gold.transaction_json(v_id));
end $$;

-- Mobile money from another branch: confirmed once it has really arrived, or failed. A failed part must be covered by other ways of
-- paying, given as replacements, so the parts always add up to what the customer is owed.
create function gold.resolve_payment(p_payment uuid, p_outcome text, p_scope uuid[], p_replacements jsonb) returns jsonb language plpgsql as $$
declare
  v_user uuid := gold.require_actor(); pm gold.transaction_payments; t gold.transactions; pay jsonb; v_sum numeric := 0;
begin
  select * into pm from gold.transaction_payments where id = p_payment for update;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'Payment was not found.'); end if;
  if pm.method <> 'mobile_money' then perform gold.fail(409, 'NOT_MOBILE_MONEY', 'Only mobile money payments are confirmed.'); end if;
  if pm.status <> 'pending' then perform gold.fail(409, 'ALREADY_RESOLVED', 'This payment was already confirmed or marked failed.'); end if;
  if not (pm.paid_by_branch_id = any(p_scope)) then
    perform gold.fail(403, 'FORBIDDEN', 'Only someone at the branch that sent the money can confirm it.');
  end if;
  select * into t from gold.transactions where id = pm.transaction_id;

  if p_outcome = 'confirmed' then
    update gold.transaction_payments set status = 'confirmed', confirmed_by = v_user, confirmed_at = now() where id = p_payment;
  elsif p_outcome = 'failed' then
    for pay in select * from jsonb_array_elements(coalesce(p_replacements, '[]'::jsonb)) loop v_sum := v_sum + (pay->>'amount')::numeric; end loop;
    if v_sum <> pm.amount then
      perform gold.fail(422, 'PAYOUT_MISMATCH', 'The replacement payments (' || gold.ts(v_sum) || ') must cover the failed ' || gold.ts(pm.amount) || '.');
    end if;
    update gold.transaction_payments set status = 'failed', confirmed_by = v_user, confirmed_at = now() where id = p_payment;
    for pay in select * from jsonb_array_elements(p_replacements) loop
      perform gold.apply_payment(t.id, t.branch_id, gold.open_day_id(t.branch_id), now(), t.customer_id, t.reference, pay);
    end loop;
  else
    perform gold.fail(422, 'VALIDATION_FAILED', 'Outcome must be confirmed or failed.');
  end if;
  return gold.transaction_json(t.id);
end $$;

-- ---------------------------------------------------------------- privileges
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant select, insert, update on gold.collateral_holdings to gold_app;
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;