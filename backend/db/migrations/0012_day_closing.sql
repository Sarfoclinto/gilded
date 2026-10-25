-- 0012 Day closing (B4): closing with the full reconciliation, the physical-verification confirmation, history, manager sign-off.
--  Closing compares what the teller reports (seven figures) with what the ledger says. Every difference needs a written reason,
--  is posted as a closing adjustment so tomorrow starts exactly where today really ended, and opens a case for review. The
--  original ledger rows and the teller's own words are never edited. Same error convention as 0011 ('CODE|text', SQLSTATE GV<status>).

alter table gold.business_days add column closing_command_id uuid unique;

-- ---------------------------------------------------------------- a day as the API shows it, now including its closing
create or replace function gold.day_json(p_day uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', d.id, 'branchId', d.branch_id, 'businessDate', d.business_date, 'status', d.status,
    'opening', jsonb_build_object(
        'lines', coalesce((select cash_lines from gold.day_balances where business_day_id = d.id and kind = 'opening_declared'), '{}'::jsonb),
        'source', d.opening_source),
    'openedAt', gold.iso(d.opened_at), 'openedBy', gold.person_json(d.opened_by),
    'closing', case when d.status <> 'closed' then null else jsonb_build_object(
        'closedAt', gold.iso(d.closed_at), 'closedBy', gold.person_json(d.closed_by),
        'confirmation', jsonb_build_object('version', d.closing_confirmation_version, 'text', d.closing_confirmation_text),
        'figures', coalesce((select jsonb_agg(jsonb_build_object(
              'asset', r.asset, 'expected', gold.ts(r.expected), 'actual', gold.ts(r.actual), 'difference', gold.ts(r.difference),
              'outcome', r.outcome, 'explanation', r.explanation, 'detail', r.detail)
              order by array_position(array['cash','goods_top','goods_down','goods_value','debt','payable','custody_top'], r.asset))
            from gold.day_reconciliations r where r.business_day_id = d.id and r.phase = 'closing'), '[]'::jsonb),
        'cash', jsonb_build_object(
            'expected', coalesce((select cash_lines from gold.day_balances where business_day_id = d.id and kind = 'closing_expected'), '{}'::jsonb),
            'counted',  coalesce((select cash_lines from gold.day_balances where business_day_id = d.id and kind = 'closing_declared'), '{}'::jsonb)),
        'signoff', jsonb_build_object('status', d.signoff_status, 'by', case when d.signoff_by is null then null else gold.person_json(d.signoff_by) end,
                                      'at', case when d.signoff_at is null then null else gold.iso(d.signoff_at) end, 'note', d.signoff_note)) end,
    'flags', to_jsonb(array_remove(array[
        case when d.opened_offline then 'OFFLINE_ENTRY' end,
        case when exists (select 1 from gold.day_reconciliations r where r.business_day_id = d.id and r.phase = 'opening' and r.detail is not null)
             then 'OPENING_DIFFERS' end,
        case when d.signoff_status <> 'not_required' then 'CLOSING_DIFFERS' end], null)))
  from gold.business_days d where d.id = p_day
$$;

-- ---------------------------------------------------------------- what the books say right now (to prefill the closing screen)
create function gold.closing_preview(p_day uuid) returns jsonb language plpgsql stable as $$
declare d gold.business_days; bal record;
begin
  select * into d from gold.business_days where id = p_day;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That day was not found.'); end if;
  if d.status <> 'open' then perform gold.fail(409, 'DAY_ALREADY_CLOSED', 'This day is already closed.'); end if;
  select * into bal from gold.branch_balance(d.branch_id);
  return jsonb_build_object(
    'dayId', d.id, 'branchId', d.branch_id,
    'expected', jsonb_build_object(
        'cash', jsonb_build_object('lines', bal.cash_lines, 'value', gold.ts(bal.cash_value)),
        'goodsTop', gold.ts(bal.goods_top), 'goodsDown', gold.ts(bal.goods_down), 'goodsValue', gold.ts(bal.goods_value),
        'debt', gold.ts(bal.debt_value), 'payable', gold.ts(bal.payable_value), 'custodyTop', gold.ts(bal.custody_top)),
    'pendingPayments', (select count(*) from gold.transaction_payments p join gold.transactions t on t.id = p.transaction_id
                        where t.branch_id = d.branch_id and p.status = 'pending'),
    'asOf', gold.iso(now()));
end $$;

-- ---------------------------------------------------------------- close
-- A reported non-negative figure.
create function gold.declared(p jsonb, p_key text) returns numeric language plpgsql immutable as $$
declare v numeric := nullif(p #>> array['declared', p_key], '')::numeric;
begin
  if v is null or v < 0 then perform gold.fail(422, 'VALIDATION_FAILED', format('Report %s as a number, zero or more.', p_key)); end if;
  return v;
end $$;

create function gold.close_day(p jsonb) returns jsonb language plpgsql as $$
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
    v_needs := case when v_a = 'cash' then v_detail <> '{}'::jsonb else v_act <> v_exp end;
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
    perform gold.post_cash(v_branch, v_day, v_at, v_pos, 1, 'closing_adjustment', v_day, p->'explanations'->>'cash');
    perform gold.post_cash(v_branch, v_day, v_at, v_neg, -1, 'closing_adjustment', v_day, p->'explanations'->>'cash');
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
    v_needs := case when v_a = 'cash' then v_detail <> '{}'::jsonb else v_act <> v_exp end;
    v_expl := case when v_needs then trim(p->'explanations'->>v_a) else null end;
    v_any := v_any or v_needs;
    insert into gold.day_reconciliations (tenant_id, business_day_id, phase, asset, expected, actual, detail, explanation, explained_by)
    values (v_tenant, v_day, 'closing', v_a, v_exp, v_act, case when v_a = 'cash' and v_needs then v_detail else null end, v_expl,
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

-- ---------------------------------------------------------------- manager sign-off
create function gold.signoff_day(p_day uuid, p_decision text, p_note text) returns jsonb language plpgsql as $$
declare v_user uuid := gold.require_actor(); d gold.business_days; v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into d from gold.business_days where id = p_day for update;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That day was not found.'); end if;
  if d.status <> 'closed' or d.signoff_status <> 'pending' then
    perform gold.fail(409, 'NOTHING_TO_SIGN', 'This day has no closing difference waiting for sign-off.');
  end if;
  if p_decision not in ('approved', 'rejected') then perform gold.fail(422, 'VALIDATION_FAILED', 'Decision must be approved or rejected.'); end if;
  if p_decision = 'rejected' and not gold.has_text(v_note, 5) then
    perform gold.fail(422, 'VALIDATION_FAILED', 'Say why you reject it (at least 5 characters).');
  end if;
  if d.closed_by = v_user then
    perform gold.fail(403, 'SELF_SIGNOFF', 'The person who closed the day cannot sign it off.');
  end if;
  update gold.business_days set signoff_status = p_decision, signoff_by = v_user, signoff_at = now(), signoff_note = v_note where id = p_day;
  return gold.day_json(p_day);
end $$;

-- ---------------------------------------------------------------- history
create function gold.days_json(p_branch uuid, p_from date, p_to date, p_signoff text, p_limit int) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(gold.day_json(id) order by business_date desc), '[]'::jsonb)
  from (select id, business_date from gold.business_days
        where branch_id = p_branch
          and (p_from is null or business_date >= p_from) and (p_to is null or business_date <= p_to)
          and (p_signoff is null or signoff_status = p_signoff)
        order by business_date desc limit least(coalesce(p_limit, 60), 200)) x
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant select, insert on gold.discrepancies, gold.discrepancy_actions to gold_app;
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;