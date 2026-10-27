-- 0021 Opening balances (B7b-2): the gold a branch holds and the debts owed to it on the day it goes live.
--  Cash is not here: it is the first count when a branch opens its first day. Each branch's gold is one go-live ledger entry, and each debt is a
--  normal debt (so it can be repaid in the usual way) whose opening ledger entry is marked go-live. Nothing is lost if it is wrong:
--  an import can be undone, which posts reversing entries (and writes the debts off), as long as no debt from it has been repaid.

alter table gold.import_batches drop constraint import_batches_kind_check;
alter table gold.import_batches add constraint import_batches_kind_check check (kind in ('history', 'customers', 'opening'));
alter table gold.debts add column imported_batch uuid;

-- p: { batchId, label?, asOf, rows: [ {kind:'goods', branchId, top, down, value, note?} | {kind:'debt', branchId, partyName, partyType?, phone?, amount, issuedAt?, dueDate?, reason?} ] }
-- All or nothing. Sending the same batchId again changes nothing and says so.
create function gold.import_opening(p jsonb, p_scope uuid[]) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant(); v_user uuid := gold.require_actor(); v_batch uuid := (p->>'batchId')::uuid;
  v_as_of timestamptz := (p->>'asOf')::timestamptz; r jsonb; b gold.branches; v_goods int := 0; v_debts int := 0; v_customer uuid; v_id uuid;
  v_name text; v_type text; v_amount numeric; v_at timestamptz; v_top numeric; v_down numeric; v_value numeric;
begin
  if v_batch is null or v_as_of is null then perform gold.fail(422, 'VALIDATION_FAILED', 'A batch id and the go-live date are needed.'); end if;
  if v_as_of > now() then perform gold.fail(422, 'VALIDATION_FAILED', 'The go-live date must not be in the future.'); end if;
  if jsonb_typeof(p->'rows') <> 'array' or jsonb_array_length(p->'rows') not between 1 and 1000 then
    perform gold.fail(422, 'VALIDATION_FAILED', 'Send 1 to 1000 rows.');
  end if;
  if exists (select 1 from gold.import_batches where id = v_batch) then
    return jsonb_build_object('alreadyApplied', true, 'goods', 0, 'debts', 0);
  end if;
  insert into gold.import_batches (id, tenant_id, kind, label, created_by) values (v_batch, v_tenant, 'opening', nullif(trim(coalesce(p->>'label', '')), ''), v_user);

  for r in select * from jsonb_array_elements(p->'rows') loop
    perform gold.in_scope((r->>'branchId')::uuid, p_scope);
    select * into b from gold.branches where id = (r->>'branchId')::uuid and is_active;
    if not found then perform gold.fail(404, 'NOT_FOUND', 'Branch was not found.'); end if;

    if r->>'kind' = 'goods' then
      v_top := (r->>'top')::numeric; v_down := (r->>'down')::numeric; v_value := (r->>'value')::numeric;
      if v_top is null or v_top <= 0 or v_down is null or v_down < 0 or v_value is null or v_value < 0 then
        perform gold.fail(422, 'VALIDATION_FAILED', b.name || ': the gold needs a top weight above zero, a down weight and a value.');
      end if;
      if exists (select 1 from gold.ledger_entries e where e.branch_id = b.id and e.asset = 'goods' and e.source_type = 'go_live_balance'
                   and not exists (select 1 from gold.ledger_entries x where x.reverses_entry_id = e.id)) then
        perform gold.fail(409, 'ALREADY_SET', b.name || ' already has its opening gold. Undo that import first.');
      end if;
      perform gold.post_goods(b.id, null, v_as_of, v_top, v_down, v_value, 'go_live_balance', v_batch, coalesce(nullif(trim(r->>'note'), ''), 'Opening gold'));
      v_goods := v_goods + 1;

    elsif r->>'kind' = 'debt' then
      v_name := trim(coalesce(r->>'partyName', ''));
      v_type := coalesce(nullif(r->>'partyType', ''), 'customer');
      v_amount := (r->>'amount')::numeric;
      v_at := least(coalesce((r->>'issuedAt')::timestamptz, v_as_of), v_as_of);
      if not gold.has_text(v_name, 1) then perform gold.fail(422, 'VALIDATION_FAILED', 'Every debt needs the name of who owes.'); end if;
      if v_type not in ('customer', 'staff', 'other') then perform gold.fail(422, 'VALIDATION_FAILED', v_name || ': unknown party type.'); end if;
      if v_amount is null or v_amount <= 0 then perform gold.fail(422, 'VALIDATION_FAILED', v_name || ': the amount owed must be above zero.'); end if;
      v_customer := gold.ensure_customer(null, v_name, r->>'phone');
      if v_type = 'customer' and v_customer is null then
        perform gold.fail(422, 'CUSTOMER_REQUIRED', v_name || ': a phone number is needed for a customer.');
      end if;
      v_id := gen_random_uuid();
      insert into gold.debts (id, tenant_id, branch_id, customer_id, party_name, party_type, principal, reason, issued_at, issued_by, due_date, direction, imported_batch)
      values (v_id, v_tenant, b.id, v_customer, v_name, v_type, v_amount, coalesce(nullif(trim(r->>'reason'), ''), 'Opening balance'), v_at, v_user,
              nullif(r->>'dueDate', '')::date, 'receivable', v_batch);
      perform gold.post_value('debt', b.id, null, v_at, v_amount, 'go_live_balance', v_id, 'Opening balance: owed by ' || v_name);
      v_debts := v_debts + 1;
    else
      perform gold.fail(422, 'VALIDATION_FAILED', 'Each row is either gold or a debt.');
    end if;
  end loop;
  return jsonb_build_object('alreadyApplied', false, 'goods', v_goods, 'debts', v_debts);
end $$;

-- ---------------------------------------------------------------- the list and undo now cover both kinds
create or replace function gold.import_batches_json(p_scope uuid[]) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(x.j order by x.at desc), '[]'::jsonb) from (
    select b.created_at as at, jsonb_build_object(
      'id', b.id, 'kind', b.kind, 'label', b.label, 'createdAt', gold.iso(b.created_at), 'createdBy', gold.person_json(b.created_by),
      'undone', b.undone_at is not null,
      'purchases', (select count(*) from gold.transactions t where t.imported_batch = b.id and t.status <> 'void'),
      'worth', gold.ts(coalesce((select sum(t.payable) from gold.transactions t where t.imported_batch = b.id and t.status <> 'void'), 0)),
      'from', (select min(t.captured_at)::date from gold.transactions t where t.imported_batch = b.id),
      'to', (select max(t.captured_at)::date from gold.transactions t where t.imported_batch = b.id)) as j
    from gold.import_batches b
    where b.kind = 'history'
      and (not exists (select 1 from gold.transactions t where t.imported_batch = b.id)
           or exists (select 1 from gold.transactions t where t.imported_batch = b.id and t.branch_id = any(coalesce(p_scope, '{}'))))
    union all
    select b.created_at, jsonb_build_object(
      'id', b.id, 'kind', b.kind, 'label', b.label, 'createdAt', gold.iso(b.created_at), 'createdBy', gold.person_json(b.created_by),
      'undone', b.undone_at is not null,
      'purchases', (select count(*) from gold.ledger_entries e where e.source_id = b.id and e.source_type = 'go_live_balance')
                 + (select count(*) from gold.debts d where d.imported_batch = b.id),
      'worth', gold.ts(coalesce((select sum(e.delta_value) from gold.ledger_entries e where e.source_id = b.id and e.source_type = 'go_live_balance'), 0)
                     + coalesce((select sum(d.principal) from gold.debts d where d.imported_batch = b.id), 0)),
      'from', null, 'to', null)
    from gold.import_batches b
    where b.kind = 'opening'
      and (exists (select 1 from gold.ledger_entries e where e.source_id = b.id and e.source_type = 'go_live_balance' and e.branch_id = any(coalesce(p_scope, '{}')))
           or exists (select 1 from gold.debts d where d.imported_batch = b.id and d.branch_id = any(coalesce(p_scope, '{}'))))
  ) x
$$;

create or replace function gold.import_undo(p_batch uuid, p_reason text, p_scope uuid[]) returns jsonb language plpgsql as $$
declare v_user uuid := gold.require_actor(); b gold.import_batches; n int; v_ids uuid[];
begin
  select * into b from gold.import_batches where id = p_batch and kind in ('history', 'opening') for update;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That import was not found.'); end if;
  if b.undone_at is not null then perform gold.fail(409, 'ALREADY_UNDONE', 'This import was already undone.'); end if;
  if not gold.has_text(p_reason, 5) then perform gold.fail(422, 'VALIDATION_FAILED', 'Say why (at least 5 characters).'); end if;

  if b.kind = 'history' then
    if exists (select 1 from gold.transactions t where t.imported_batch = p_batch and not (t.branch_id = any(coalesce(p_scope, '{}')))) then
      perform gold.fail(403, 'FORBIDDEN', 'This import includes branches you do not work at.');
    end if;
    update gold.transactions set status = 'void', voided_at = now(), voided_by = v_user, void_reason = 'Import undone: ' || trim(p_reason)
     where imported_batch = p_batch and status <> 'void';
    get diagnostics n = row_count;
  else
    if exists (select 1 from gold.ledger_entries e where e.source_id = p_batch and e.source_type = 'go_live_balance' and not (e.branch_id = any(coalesce(p_scope, '{}'))))
       or exists (select 1 from gold.debts d where d.imported_batch = p_batch and not (d.branch_id = any(coalesce(p_scope, '{}')))) then
      perform gold.fail(403, 'FORBIDDEN', 'This import includes branches you do not work at.');
    end if;
    if exists (select 1 from gold.debt_repayments r join gold.debts d on d.id = r.debt_id where d.imported_batch = p_batch) then
      perform gold.fail(409, 'ALREADY_IN_USE', 'A debt from this import has already been repaid, so it cannot be undone.');
    end if;
    select coalesce(array_agg(id), '{}') into v_ids from gold.debts where imported_batch = p_batch;
    insert into gold.ledger_entries (tenant_id, branch_id, business_day_id, occurred_at, recorded_by, asset, delta_top, delta_down, delta_value,
                                     source_type, source_id, memo, reverses_entry_id)
    select e.tenant_id, e.branch_id, null, now(), v_user, e.asset, -e.delta_top, -e.delta_down, -e.delta_value, 'reversal', e.source_id,
           'Opening balance import undone: ' || trim(p_reason), e.id
      from gold.ledger_entries e
     where e.source_type = 'go_live_balance' and (e.source_id = p_batch or e.source_id = any(v_ids))
       and not exists (select 1 from gold.ledger_entries x where x.reverses_entry_id = e.id);
    get diagnostics n = row_count;
    update gold.debts set status = 'written_off', closed_at = now(), closed_by = v_user, close_reason = 'Opening balance import undone: ' || trim(p_reason)
     where imported_batch = p_batch and status = 'open';
  end if;
  update gold.import_batches set undone_at = now(), undone_by = v_user where id = p_batch;
  return jsonb_build_object('voided', n);
end $$;

-- The first count of a drawer is the go-live count even when opening gold and debts were loaded before it (they are not cash).
create or replace function gold.open_day(p jsonb) returns jsonb language plpgsql as $$
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
  -- A branch that only has opening gold and debts is still at its first count: what matters is whether its drawer has a past.
  v_history := exists (select 1 from gold.business_days where branch_id = v_branch) or exists (select 1 from gold.ledger_entries where branch_id = v_branch and asset = 'cash');
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

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;