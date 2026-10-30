-- 0028 Branch overview (B11a) and the cash lookup (B11b). Read-only: nothing here changes any record.

-- Cash by branch for the cash lookup panel: the total and the notes by denomination, as the books hold them right now.
-- p_scope: the branches the caller may see. p_branch: narrow to one. "lastEntryAt" is when the books last moved for that branch's cash,
-- so the screen can say how fresh the figures are. Anything still waiting on a device that has not synced is NOT in here.
create function gold.branches_cash_json(p_scope uuid[], p_branch uuid) returns jsonb language plpgsql stable as $$
declare v_out jsonb;
begin
  if p_branch is not null and not (p_branch = any (coalesce(p_scope, '{}'))) then
    perform gold.fail(403, 'FORBIDDEN', 'You do not have access to that branch.');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'branchId', b.id, 'name', b.name, 'isMain', b.is_main,
      'cashValue', gold.ts(bal.cash_value), 'lines', bal.cash_lines,
      'day', coalesce(d.status, 'none'), 'dayDate', d.business_date,
      'lastEntryAt', case when l.last_at is null then null else gold.iso(l.last_at) end)
    order by b.is_main desc, b.name), '[]'::jsonb)
  into v_out
  from gold.branches b
  cross join lateral gold.branch_balance(b.id) bal
  left join lateral (select x.status, x.business_date from gold.business_days x where x.branch_id = b.id order by x.business_date desc limit 1) d on true
  left join lateral (select max(e.recorded_at) as last_at from gold.ledger_entries e where e.branch_id = b.id and e.asset = 'cash') l on true
  where b.is_active and b.id = any (coalesce(p_scope, '{}')) and (p_branch is null or b.id = p_branch);
  return jsonb_build_object('asOf', gold.iso(now()), 'branches', v_out);
end $$;

-- One branch for the administrator: who works there, what it holds, and what needs attention.
create function gold.branch_overview_json(p_branch uuid) returns jsonb language plpgsql stable as $$
declare
  b gold.branches; bal record; v_now timestamptz := now(); v_today date;
  v_workers jsonb; v_today_j jsonb; v_open jsonb; v_attention jsonb; v_days jsonb; v_recent jsonb; v_debts jsonb;
begin
  select * into b from gold.branches where id = p_branch;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'Branch was not found.'); end if;
  select * into bal from gold.branch_balance(p_branch);
  v_today := (v_now at time zone b.timezone)::date;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', u.id, 'name', u.display_name, 'username', u.username::text, 'phone', u.phone,
      'role', jsonb_build_object('key', r.key, 'name', r.name), 'isPrimary', ub.is_primary,
      'lastLoginAt', case when u.last_login_at is null then null else gold.iso(u.last_login_at) end)
    order by r.name, lower(u.display_name)), '[]'::jsonb)
  into v_workers
  from gold.user_branches ub join gold.users u on u.id = ub.user_id and u.is_active
  join gold.roles r on r.id = u.role_id and r.tenant_id = u.tenant_id
  where ub.branch_id = p_branch;

  select jsonb_build_object('count', count(*) filter (where t.status <> 'void'), 'paid', gold.ts(coalesce(sum(t.payable) filter (where t.status <> 'void'), 0)),
                            'voided', count(*) filter (where t.status = 'void'))
  into v_today_j
  from gold.transactions t where t.branch_id = p_branch and (t.captured_at at time zone b.timezone)::date = v_today;

  select jsonb_build_object('id', d.id, 'businessDate', d.business_date, 'openedAt', gold.iso(d.opened_at), 'openedBy', gold.person_json(d.opened_by))
  into v_open from gold.business_days d where d.branch_id = p_branch and d.status = 'open';

  select jsonb_build_object(
    'signoffPending', (select count(*) from gold.business_days d where d.branch_id = p_branch and d.signoff_status = 'pending'),
    'openDifferences', (select count(*) from gold.discrepancies x where x.branch_id = p_branch and x.status in ('open', 'under_review')),
    'transfersComing', (select count(*) from gold.transfers x where x.destination_branch_id = p_branch and x.status = 'released'),
    'transfersGoing', (select count(*) from gold.transfers x where x.origin_branch_id = p_branch and x.status = 'released'),
    'moneyWaiting', (select count(*) from gold.transaction_payments p join gold.transactions t on t.id = p.transaction_id
                     where p.status = 'pending' and t.branch_id = p_branch),
    'moneyToSend', (select count(*) from gold.transaction_payments p where p.status = 'pending' and p.paid_by_branch_id = p_branch))
  into v_attention;

  select jsonb_build_object('owedToUs', gold.ts(coalesce(sum(outstanding) filter (where direction = 'receivable'), 0)),
                            'weOwe', gold.ts(coalesce(sum(outstanding) filter (where direction = 'payable'), 0)),
                            'overdue', count(*) filter (where direction = 'receivable' and due_date < v_today))
  into v_debts from gold.v_debts_outstanding where branch_id = p_branch and status = 'open' and outstanding > 0;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'date', d.business_date, 'status', d.status, 'signoff', d.signoff_status,
      'differences', (select count(*) from gold.day_reconciliations r where r.business_day_id = d.id and r.phase = 'closing' and r.difference <> 0),
      'cashDifference', gold.ts(coalesce((select sum(r.difference) from gold.day_reconciliations r where r.business_day_id = d.id and r.phase = 'closing' and r.asset = 'cash'), 0)))
    order by d.business_date desc), '[]'::jsonb)
  into v_days from (select * from gold.business_days x where x.branch_id = p_branch order by x.business_date desc limit 6) d;

  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'reference', t.reference, 'customerName', t.customer_name, 'payable', gold.ts(t.payable),
                                               'status', t.status, 'capturedAt', gold.iso(t.captured_at)) order by t.captured_at desc), '[]'::jsonb)
  into v_recent from (select * from gold.transactions x where x.branch_id = p_branch order by x.captured_at desc limit 5) t;

  return jsonb_build_object(
    'asOf', gold.iso(v_now),
    'branch', gold.branch_admin_json(p_branch),
    'workers', v_workers,
    'snapshot', jsonb_build_object('cash', gold.ts(bal.cash_value), 'goodsTop', gold.ts(bal.goods_top), 'goodsDown', gold.ts(bal.goods_down),
                                    'goodsValue', gold.ts(bal.goods_value), 'debt', gold.ts(bal.debt_value), 'payable', gold.ts(bal.payable_value),
                                    'custodyTop', gold.ts(bal.custody_top)),
    'today', v_today_j, 'openDay', v_open, 'attention', v_attention, 'debts', v_debts, 'recentDays', v_days, 'recent', v_recent);
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;