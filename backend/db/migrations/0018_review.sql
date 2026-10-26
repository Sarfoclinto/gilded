-- 0018 Review (B6): the discrepancy inbox, the branch timeline and the between-branches position.
--  All reads except discrepancy_act, which only moves a case through its workflow (take, note, resolve, reopen):
--  the facts of a case and the ledger are never edited (the 0006 guard enforces it). Closing already posted adjustments, so
--  resolving a case records the decision and the reason; it does not move money.
--  Same error convention as before ('CODE|text', SQLSTATE GV<status>). Scope = the branches the caller may see.

-- ---------------------------------------------------------------- discrepancy cases
create function gold.discrepancy_summary(d gold.discrepancies) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', d.id, 'branchId', d.branch_id, 'branchName', (select name from gold.branches b where b.id = d.branch_id),
    'kind', d.kind, 'asset', d.asset, 'status', d.status,
    'expected', gold.ts(d.expected), 'actual', gold.ts(d.actual), 'difference', gold.ts(d.difference),
    'reportedExplanation', d.reported_explanation,
    'businessDate', (select business_date from gold.business_days x where x.id = d.business_day_id),
    'dayId', d.business_day_id,
    'transferId', d.transfer_id, 'transferReference', (select reference from gold.transfers t where t.id = d.transfer_id),
    'openedAt', gold.iso(d.opened_at), 'openedBy', case when d.opened_by is null then null else gold.person_json(d.opened_by) end,
    'assignedTo', case when d.assigned_to is null then null else gold.person_json(d.assigned_to) end,
    'resolvedAt', case when d.resolved_at is null then null else gold.iso(d.resolved_at) end,
    'resolvedBy', case when d.resolved_by is null then null else gold.person_json(d.resolved_by) end,
    'resolutionType', d.resolution_type, 'resolutionSummary', d.resolution_summary)
$$;

-- p_status: 'active' (open + under review, the default), 'all', or one status.
create function gold.discrepancies_json(p_scope uuid[], p_status text, p_branch uuid, p_limit int default 100) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(gold.discrepancy_summary(d) order by d.opened_at desc), '[]'::jsonb)
  from (select * from gold.discrepancies x
        where x.branch_id = any(coalesce(p_scope, '{}'))
          and (p_branch is null or x.branch_id = p_branch)
          and case coalesce(p_status, 'active') when 'active' then x.status in ('open', 'under_review')
                                                when 'all' then true else x.status = p_status end
        order by x.opened_at desc limit least(coalesce(p_limit, 100), 300)) d
$$;

create function gold.discrepancy_json(p_id uuid, p_scope uuid[]) returns jsonb language plpgsql stable as $$
declare d gold.discrepancies;
begin
  select * into d from gold.discrepancies where id = p_id and branch_id = any(coalesce(p_scope, '{}'));
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That case was not found.'); end if;
  return gold.discrepancy_summary(d) || jsonb_build_object('actions', coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'type', a.action_type, 'fromStatus', a.from_status, 'toStatus', a.to_status,
             'note', a.note, 'by', case when a.actor_user_id is null then null else gold.person_json(a.actor_user_id) end,
             'at', gold.iso(a.occurred_at)) order by a.id)
    from gold.discrepancy_actions a where a.discrepancy_id = d.id), '[]'::jsonb));
end $$;

-- p: { action: 'take' | 'note' | 'resolve' | 'reopen', note?, resolutionType?, summary? }
create function gold.discrepancy_act(p_id uuid, p jsonb, p_scope uuid[]) returns jsonb language plpgsql as $$
declare
  v_user uuid := gold.require_actor(); d gold.discrepancies;
  v_action text := p->>'action'; v_note text := nullif(trim(coalesce(p->>'note', '')), '');
  v_type text := p->>'resolutionType'; v_sum text := nullif(trim(coalesce(p->>'summary', '')), '');
begin
  select * into d from gold.discrepancies where id = p_id and branch_id = any(coalesce(p_scope, '{}')) for update;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That case was not found.'); end if;

  if v_action = 'note' then
    if not gold.has_text(v_note, 3) then perform gold.fail(422, 'VALIDATION_FAILED', 'Write the note (at least 3 characters).'); end if;
    insert into gold.discrepancy_actions (tenant_id, discrepancy_id, action_type, note, actor_user_id)
    values (d.tenant_id, d.id, 'note', v_note, v_user);
  elsif v_action = 'take' then
    if d.status not in ('open', 'under_review') then perform gold.fail(409, 'CASE_CLOSED', 'This case is already closed.'); end if;
    update gold.discrepancies set status = 'under_review', assigned_to = v_user where id = d.id;
    if d.assigned_to is distinct from v_user and d.status = 'under_review' then
      insert into gold.discrepancy_actions (tenant_id, discrepancy_id, action_type, note, actor_user_id)
      values (d.tenant_id, d.id, 'assigned', 'Taken over', v_user);
    end if;
  elsif v_action = 'resolve' then
    if d.status not in ('open', 'under_review') then perform gold.fail(409, 'CASE_CLOSED', 'This case is already closed.'); end if;
    if v_type is null or v_type not in ('explained', 'found', 'recovered', 'corrected_entry', 'written_off') then
      perform gold.fail(422, 'VALIDATION_FAILED', 'Choose how the case was resolved.');
    end if;
    if not gold.has_text(v_sum, 10) then perform gold.fail(422, 'VALIDATION_FAILED', 'Write what was found and decided (at least 10 characters).'); end if;
    update gold.discrepancies set status = case when v_type = 'written_off' then 'written_off' else 'resolved' end,
      resolved_at = now(), resolved_by = v_user, resolution_type = v_type, resolution_summary = v_sum where id = d.id;
  elsif v_action = 'reopen' then
    if d.status not in ('resolved', 'written_off') then perform gold.fail(409, 'CASE_NOT_CLOSED', 'Only a closed case can be reopened.'); end if;
    if not gold.has_text(v_note, 5) then perform gold.fail(422, 'VALIDATION_FAILED', 'Say why it is reopened (at least 5 characters).'); end if;
    update gold.discrepancies set status = 'under_review', assigned_to = v_user, resolved_at = null, resolved_by = null,
      resolution_type = null, resolution_summary = null where id = d.id;
    insert into gold.discrepancy_actions (tenant_id, discrepancy_id, action_type, note, actor_user_id)
    values (d.tenant_id, d.id, 'note', 'Reopened: ' || v_note, v_user);
  else
    perform gold.fail(422, 'VALIDATION_FAILED', 'action must be take, note, resolve or reopen.');
  end if;
  return gold.discrepancy_json(p_id, p_scope);
end $$;

-- ---------------------------------------------------------------- the branch timeline
-- Every movement of one branch, newest first, with the running balance after it. Page with p_before (the last seq of the previous page).
create function gold.branch_timeline_json(p_branch uuid, p_from timestamptz, p_to timestamptz, p_asset text, p_before bigint, p_limit int default 100)
returns jsonb language plpgsql stable as $$
declare v_limit int := least(greatest(coalesce(p_limit, 100), 1), 300); v_rows jsonb; v_n int;
begin
  if p_asset is not null and p_asset not in ('cash', 'goods', 'debt', 'payable') then
    perform gold.fail(422, 'VALIDATION_FAILED', 'asset must be cash, goods, debt or payable.');
  end if;
  select coalesce(jsonb_agg(j order by (j->>'seq')::bigint desc), '[]'::jsonb), count(*) into v_rows, v_n
  from (select jsonb_build_object(
          'seq', t.seq, 'occurredAt', gold.iso(t.occurred_at), 'recordedAt', gold.iso(t.recorded_at),
          'recordedBy', case when t.recorded_by is null then null else gold.person_json(t.recorded_by) end,
          'dayId', t.business_day_id, 'asset', t.asset, 'denomination', t.denomination, 'deltaCount', t.delta_count,
          'deltaTop', gold.ts(t.delta_top), 'deltaDown', gold.ts(t.delta_down), 'deltaValue', gold.ts(t.delta_value),
          'sourceType', t.source_type, 'sourceId', t.source_id, 'memo', t.memo,
          'running', jsonb_build_object('cash', gold.ts(t.running_cash), 'goodsTop', gold.ts(t.running_goods_top), 'goodsDown', gold.ts(t.running_goods_down),
                                        'goodsValue', gold.ts(t.running_goods_value), 'debt', gold.ts(t.running_debt), 'payable', gold.ts(t.running_payable))) j
        from gold.v_branch_timeline t
        where t.branch_id = p_branch
          and (p_from is null or t.occurred_at >= p_from) and (p_to is null or t.occurred_at < p_to)
          and (p_asset is null or t.asset = p_asset)
          and (p_before is null or t.seq < p_before)
        order by t.seq desc limit v_limit) x;
  return jsonb_build_object('entries', v_rows, 'nextBefore', case when v_n = v_limit then (v_rows->(v_n - 1)->>'seq')::bigint else null end);
end $$;

-- ---------------------------------------------------------------- between branches
create function gold.interbranch_position_json(p_scope uuid[]) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'senderBranchId', v.sender_branch_id, 'senderName', (select name from gold.branches b where b.id = v.sender_branch_id),
    'receiverBranchId', v.receiver_branch_id, 'receiverName', (select name from gold.branches b where b.id = v.receiver_branch_id),
    'cashSent', gold.ts(v.cash_sent), 'mobileMoneyPaidOnBehalf', gold.ts(v.mobile_money_paid_on_behalf),
    'goodsValueSent', gold.ts(v.goods_value_sent), 'mobileMoneyFailedCoveredByCash', gold.ts(v.mobile_money_failed_covered_by_cash))
    order by v.sender_branch_id, v.receiver_branch_id), '[]'::jsonb)
  from gold.v_interbranch_position v
  where v.sender_branch_id = any(coalesce(p_scope, '{}')) or v.receiver_branch_id = any(coalesce(p_scope, '{}'))
$$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;