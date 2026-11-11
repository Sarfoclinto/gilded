-- 0050 Per-branch switch for the note-by-note drawer rule ("drawer.looseBranches": the branches where it is OFF; none by default).
-- When a branch is in that list:
--   * tellers may hand out notes the books think the drawer lacks (screens and the branch hub stop checking each note, but still
--     refuse more money than the drawer holds in total);
--   * opening and closing still take the count by note, and the notes are still corrected in the books, but only the TOTAL has to match:
--     a difference in notes alone needs no written reason and no sign-off, and is kept on the day's record for the manager;
--     a difference in the total needs a reason, exactly as before.
-- Anything else is unchanged for every other branch.

create function gold.denominations_loose(p_branch uuid) returns boolean language sql stable as $$
  select coalesce(gold.setting('drawer.looseBranches') ? p_branch::text, false)
$$;

create or replace function gold.setting_defaults() returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'payout.twoStep', false,
    'payout.sameUserMayPay', true,
    'payout.blindCheck', false,
    'count.blind', false,
    'customers.autoCreate', true,
    'offline.maxDays', 7,
    'drawer.looseBranches', '[]'::jsonb,
    'allowance.perPerson', 100,
    'receipt.printer', false,
    'receipt.paper', '80',
    'receipt.businessName', '',
    'receipt.tagline', '',
    'receipt.address', '',
    'receipt.phone', '',
    'receipt.footer', '')
$$;

create or replace function gold.set_settings(p jsonb) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant(); v_user uuid := gold.require_actor();
  v_defaults jsonb := gold.setting_defaults(); v_before jsonb := gold.settings_json(); r record; v_t text;
begin
  if p is null or jsonb_typeof(p) <> 'object' or p = '{}'::jsonb then perform gold.fail(422, 'VALIDATION_FAILED', 'Nothing to change.'); end if;
  for r in select key, value from jsonb_each(p) loop
    if not v_defaults ? r.key then perform gold.fail(422, 'VALIDATION_FAILED', format('"%s" is not a setting.', r.key)); end if;
    v_t := jsonb_typeof(v_defaults -> r.key);
    if jsonb_typeof(r.value) <> v_t then perform gold.fail(422, 'VALIDATION_FAILED', format('The setting "%s" must be a %s.', r.key, v_t)); end if;
    if r.key = 'allowance.perPerson' and ((r.value #>> '{}')::numeric < 0 or (r.value #>> '{}')::numeric > 10000 or (r.value #>> '{}')::numeric <> trunc((r.value #>> '{}')::numeric)) then
      perform gold.fail(422, 'VALIDATION_FAILED', 'The allowance must be a whole number of cedis from 0 to 10,000.');
    end if;
    if r.key = 'receipt.paper' and (r.value #>> '{}') not in ('80', '58', 'a4') then perform gold.fail(422, 'VALIDATION_FAILED', 'Paper must be 80, 58 or a4.'); end if;
    if r.key = 'drawer.looseBranches' and exists (
         select 1 from jsonb_array_elements(r.value) e
         where jsonb_typeof(e) <> 'string' or not exists (select 1 from gold.branches b where b.id::text = (e #>> '{}'))) then
      perform gold.fail(422, 'VALIDATION_FAILED', 'Choose branches of this company.');
    end if;
    if v_t = 'string' and char_length(r.value #>> '{}') > 200 then perform gold.fail(422, 'VALIDATION_FAILED', format('"%s" is too long (200 characters at most).', r.key)); end if;
    insert into gold.tenant_settings (tenant_id, key, value, updated_by) values (v_tenant, r.key, r.value, v_user)
    on conflict (tenant_id, key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  end loop;
  perform gold.audit('settings.changed', 'settings', v_tenant::text, v_before, gold.settings_json());
  return gold.settings_json();
end $$;

create or replace function gold.close_day(p jsonb) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant();
  v_user uuid := gold.require_actor();
  v_id uuid := (p->>'id')::uuid;
  v_day uuid := (p->>'dayId')::uuid;
  v_branch uuid := (p->>'branchId')::uuid;
  v_at timestamptz := least((p->>'capturedAt')::timestamptz, now());
  v_lines jsonb := coalesce(p#>'{declared,cash}', '{}'::jsonb);
  v_ver text := nullif(trim(coalesce(p#>>'{confirmation,version}', '')), '');
  v_txt text := nullif(trim(coalesce(p#>>'{confirmation,text}', '')), '');
  d gold.business_days; bal record; r record;
  v_seq bigint; v_declared numeric; v_detail jsonb := '{}'::jsonb; v_pos jsonb := '{}'::jsonb; v_neg jsonb := '{}'::jsonb;
  v_assets text[] := array['cash','goods_top','goods_down','goods_value','debt','payable','custody_top'];
  v_a text; v_exp numeric; v_act numeric; v_expl text; v_missing text[] := '{}'; v_needs boolean; v_any boolean := false;
  v_goods_memo text[] := '{}'; v_rec uuid;
  v_loose boolean := gold.denominations_loose(v_branch);
  d_top numeric; d_down numeric; d_gval numeric; d_debt numeric; d_pay numeric; d_cus numeric;
begin
  if exists (select 1 from gold.business_days where closing_command_id = v_id) then
    return jsonb_build_object('replayed', true, 'data', gold.day_json(v_day));
  end if;
  select * into d from gold.business_days where id = v_day and branch_id = v_branch for update;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That day was not found.'); end if;
  if d.status <> 'open' then perform gold.fail(409, 'DAY_ALREADY_CLOSED', 'This day is already closed.'); end if;
  if coalesce(p#>>'{confirmation,accepted}', 'false') <> 'true' or v_ver is null or v_txt is null then
    perform gold.fail(422, 'CONFIRMATION_REQUIRED', 'Tick the confirmation that you physically verified everything reported.');
  end if;
  perform 1 from gold.branches where id = v_branch for update;   -- one closing at a time per branch

  select * into bal from gold.branch_balance(v_branch);
  select max(seq) into v_seq from gold.ledger_entries where branch_id = v_branch;

  v_declared := gold.lines_total(v_lines);
  d_top := gold.declared(p, 'goodsTop'); d_down := gold.declared(p, 'goodsDown'); d_gval := gold.declared(p, 'goodsValue');
  d_debt := gold.declared(p, 'debt'); d_pay := gold.declared(p, 'payable'); d_cus := gold.declared(p, 'custodyTop');

  -- cash by note: what to add and what to take away so the ledger matches the count
  for r in
    select coalesce(e.k, c.k) as denom, coalesce(c.n, 0) - coalesce(e.n, 0) as delta
    from (select key::int as k, value::int as n from jsonb_each_text(bal.cash_lines)) e
    full join (select key::int as k, value::int as n from jsonb_each_text(v_lines)) c on c.k = e.k
    where coalesce(c.n, 0) <> coalesce(e.n, 0)
  loop
    v_detail := v_detail || jsonb_build_object(r.denom::text, r.delta);
    if r.delta > 0 then v_pos := v_pos || jsonb_build_object(r.denom::text, r.delta);
    else v_neg := v_neg || jsonb_build_object(r.denom::text, -r.delta); end if;
  end loop;

  -- every figure that differs needs its own written reason
  foreach v_a in array v_assets loop
    v_exp := case v_a when 'cash' then bal.cash_value when 'goods_top' then bal.goods_top when 'goods_down' then bal.goods_down
             when 'goods_value' then bal.goods_value when 'debt' then bal.debt_value when 'payable' then bal.payable_value else bal.custody_top end;
    v_act := case v_a when 'cash' then v_declared when 'goods_top' then d_top when 'goods_down' then d_down
             when 'goods_value' then d_gval when 'debt' then d_debt when 'payable' then d_pay else d_cus end;
    v_needs := case when v_a = 'cash' then (case when v_loose then v_declared <> bal.cash_value else v_detail <> '{}'::jsonb end) else v_act <> v_exp end;
    v_expl := nullif(trim(coalesce(p->'explanations'->>v_a, '')), '');
    if v_needs and (v_expl is null or not gold.has_text(v_expl, 5)) then v_missing := v_missing || v_a; end if;
  end loop;
  if cardinality(v_missing) > 0 then
    perform gold.fail(422, 'EXPLANATION_REQUIRED', 'Write why (at least 5 characters) for: ' || array_to_string(v_missing, ', ') || '.');
  end if;

  -- snapshots: what the books said, and what was reported
  insert into gold.day_balances (tenant_id, business_day_id, kind, cash_lines, cash_value, goods_top, goods_down, goods_value, debt_value,
                                 payable_value, custody_top, ledger_seq, captured_by)
  values (v_tenant, v_day, 'closing_expected', bal.cash_lines, bal.cash_value, bal.goods_top, bal.goods_down, bal.goods_value, bal.debt_value,
          bal.payable_value, bal.custody_top, v_seq, v_user);
  insert into gold.day_balances (tenant_id, business_day_id, kind, cash_lines, cash_value, goods_top, goods_down, goods_value, debt_value,
                                 payable_value, custody_top, captured_by)
  values (v_tenant, v_day, 'closing_declared', v_lines, v_declared, d_top, d_down, d_gval, d_debt, d_pay, d_cus, v_user);

  -- adjustments, so the ledger now agrees with what was reported
  if v_detail <> '{}'::jsonb then
    perform gold.post_cash(v_branch, v_day, v_at, v_pos, 1, 'closing_adjustment', v_day, coalesce(p->'explanations'->>'cash', 'Notes recounted at closing; the total matched.'));
    perform gold.post_cash(v_branch, v_day, v_at, v_neg, -1, 'closing_adjustment', v_day, coalesce(p->'explanations'->>'cash', 'Notes recounted at closing; the total matched.'));
  end if;
  if (d_top, d_down, d_gval) is distinct from (bal.goods_top, bal.goods_down, bal.goods_value) then
    foreach v_a in array array['goods_top','goods_down','goods_value'] loop
      if p->'explanations'->>v_a is not null then v_goods_memo := v_goods_memo || (v_a || ': ' || trim(p->'explanations'->>v_a)); end if;
    end loop;
    perform gold.post_goods(v_branch, v_day, v_at, d_top - bal.goods_top, d_down - bal.goods_down, d_gval - bal.goods_value,
                            'closing_adjustment', v_day, array_to_string(v_goods_memo, '; '));
  end if;
  if d_debt <> bal.debt_value then
    perform gold.post_value('debt', v_branch, v_day, v_at, d_debt - bal.debt_value, 'closing_adjustment', v_day, p->'explanations'->>'debt');
  end if;
  if d_pay <> bal.payable_value then
    perform gold.post_value('payable', v_branch, v_day, v_at, d_pay - bal.payable_value, 'closing_adjustment', v_day, p->'explanations'->>'payable');
  end if;
  if d_cus <> bal.custody_top then
    perform gold.post_custody(v_branch, v_day, v_at, d_cus - bal.custody_top, 'closing_adjustment', v_day, p->'explanations'->>'custody_top');
  end if;

  -- one reconciliation row per figure; a case for review for each real difference
  foreach v_a in array v_assets loop
    v_exp := case v_a when 'cash' then bal.cash_value when 'goods_top' then bal.goods_top when 'goods_down' then bal.goods_down
             when 'goods_value' then bal.goods_value when 'debt' then bal.debt_value when 'payable' then bal.payable_value else bal.custody_top end;
    v_act := case v_a when 'cash' then v_declared when 'goods_top' then d_top when 'goods_down' then d_down
             when 'goods_value' then d_gval when 'debt' then d_debt when 'payable' then d_pay else d_cus end;
    v_needs := case when v_a = 'cash' then (case when v_loose then v_declared <> bal.cash_value else v_detail <> '{}'::jsonb end) else v_act <> v_exp end;
    v_expl := case when v_needs then trim(p->'explanations'->>v_a) else null end;
    v_any := v_any or v_needs;
    insert into gold.day_reconciliations (tenant_id, business_day_id, phase, asset, expected, actual, detail, explanation, explained_by)
    values (v_tenant, v_day, 'closing', v_a, v_exp, v_act, case when v_a = 'cash' and (v_needs or v_detail <> '{}'::jsonb) then v_detail else null end, v_expl,
            case when v_needs then v_user end)
    returning id into v_rec;
    if v_act <> v_exp then
      insert into gold.discrepancies (tenant_id, branch_id, business_day_id, kind, asset, reconciliation_id, expected, actual, difference,
                                      reported_explanation, opened_by)
      values (v_tenant, v_branch, v_day, 'closing_variance', v_a, v_rec, v_exp, v_act, v_act - v_exp, v_expl, v_user);
    end if;
  end loop;

  update gold.business_days
     set status = 'closed', closed_at = greatest(v_at, opened_at), closed_by = v_user, closing_confirmed = true,
         closing_confirmation_version = v_ver, closing_confirmation_text = v_txt, closing_command_id = v_id,
         signoff_status = case when v_any then 'pending' else 'not_required' end
   where id = v_day;

  return jsonb_build_object('replayed', false, 'data', gold.day_json(v_day));
end $$;

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
  v_loose boolean := gold.denominations_loose(v_branch);
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
      if (not v_loose or v_declared <> bal.cash_value) and (v_expl is null or not gold.has_text(v_expl, 5)) then
        perform gold.fail(422, 'EXPLANATION_REQUIRED',
          'The count differs from what the books say the drawer holds. Write why (at least 5 characters).');
      end if;
      perform gold.post_cash(v_branch, v_id, v_at, v_pos, 1, 'opening_adjustment', v_id, coalesce(v_expl, 'Notes recounted at opening; the total matched.'));
      perform gold.post_cash(v_branch, v_id, v_at, v_neg, -1, 'opening_adjustment', v_id, coalesce(v_expl, 'Notes recounted at opening; the total matched.'));
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

-- The drawer state tells every screen and the branch hub which rule applies.
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
    'looseDenominations', gold.denominations_loose(p_branch),
    'asOf', gold.iso(now()));
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then grant execute on all functions in schema gold to gold_app; end if;
end $$;