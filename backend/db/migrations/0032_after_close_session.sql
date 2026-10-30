-- 0032 A customer arrives after the day was closed.
-- The closed day is never reopened or edited: its count stays as signed. Instead a second session is opened on the same date
-- (carried from the closing books) with a written reason, and reviewers are told. Closing it later is an ordinary close.
alter table gold.business_days add column if not exists continuation_reason text;
alter table gold.business_days add column if not exists session_no smallint not null default 1;
alter table gold.business_days drop constraint business_days_tenant_id_branch_id_business_date_key;
alter table gold.business_days add constraint business_days_one_per_session unique (tenant_id, branch_id, business_date, session_no);

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
  v_seq bigint; v_history boolean; v_prev uuid; v_cont boolean := false;
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
    -- A customer arrives after the day was closed: a second session on the same date is allowed, never a changed past.
    -- The first session's count stays exactly as it was signed; this one starts from the closing books, and says why.
    if exists (select 1 from gold.business_days where branch_id = v_branch and business_date = v_date and status <> 'closed') then
      perform gold.fail(409, 'DAY_ALREADY_OPEN', 'This branch already has a day for that date.');
    end if;
    if coalesce(p->>'afterClose', 'false') <> 'true' then
      perform gold.fail(409, 'DAY_ALREADY_CLOSED', 'Today was already closed. If a customer came in after closing, open it again and say why.');
    end if;
    if not gold.has_text(v_expl, 5) then
      perform gold.fail(422, 'VALIDATION_FAILED', 'Say why the day is opened again (at least 5 characters).');
    end if;
    v_source := 'carried';
    v_cont := true;
  end if;

  select * into bal from gold.branch_balance(v_branch);
  select max(seq) into v_seq from gold.ledger_entries where branch_id = v_branch;
  -- A branch that only has opening gold and debts is still at its first count: what matters is whether its drawer has a past.
  v_history := exists (select 1 from gold.business_days where branch_id = v_branch) or exists (select 1 from gold.ledger_entries where branch_id = v_branch and asset = 'cash');
  if v_source = 'carried' then
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_lines from jsonb_each(bal.cash_lines) where (value #>> '{}')::int > 0;
  end if;
  v_declared := gold.lines_total(v_lines);
  select id into v_prev from gold.business_days where branch_id = v_branch order by business_date desc, opened_at desc limit 1;

  insert into gold.business_days (id, tenant_id, branch_id, business_date, session_no, previous_day_id, opened_at, opened_by, opened_offline, opening_source)
  values (v_id, v_tenant, v_branch, v_date, (select coalesce(max(session_no), 0) + 1 from gold.business_days where branch_id = v_branch and business_date = v_date),
          v_prev, v_at, v_user, (now() - v_at) > interval '2 minutes', v_source);
  if v_cont then
    update gold.business_days set continuation_reason = trim(v_expl) where id = v_id;
    perform gold.notify(v_tenant, 'after_close_session', 'The day was opened again after closing', trim(v_expl), '/drawer/history', array[v_branch], 'discrepancies:review');
  end if;

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

-- Two sessions on one date: the later one is the current one.
create or replace function gold.day_state(p_branch uuid) returns jsonb language plpgsql stable as $$
declare d gold.business_days; bal record; v_carry jsonb := null;
begin
  select * into d from gold.business_days where branch_id = p_branch order by (status = 'open') desc, business_date desc, opened_at desc limit 1;
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