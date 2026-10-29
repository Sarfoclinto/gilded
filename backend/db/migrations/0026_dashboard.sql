-- One call that feeds the dashboards of all three roles.
-- p: { scope: [branch ids the caller may see], branchId?, days? (7..60, default 14), asOf? (timestamptz, for tests), mine?: user id }
-- "Today" is each branch's own calendar day. Voided purchases never count as money out.
-- Every purchase of the last p_days days (branch-local calendar days) at the given branches, with its local date.
create function gold.dash_base(p_ids uuid[], p_days int, p_now timestamptz)
returns table (id uuid, branch_id uuid, local_date date, payable numeric, status text, flags text[], created_by uuid, customer_id uuid, customer_name text, reference text, captured_at timestamptz)
language sql stable as $$
  select t.id, t.branch_id, (t.captured_at at time zone b.timezone)::date, t.payable, t.status, t.flags, t.created_by, t.customer_id, t.customer_name, t.reference, t.captured_at
  from gold.transactions t join gold.branches b on b.id = t.branch_id
  where t.branch_id = any (p_ids)
    and (t.captured_at at time zone b.timezone)::date >= (p_now at time zone b.timezone)::date - (p_days - 1)
$$;

create function gold.dashboard_json(p jsonb) returns jsonb language plpgsql stable as $$
declare
  v_scope uuid[] := array(select jsonb_array_elements_text(coalesce(p->'scope', '[]'::jsonb))::uuid);
  v_branch uuid := nullif(p->>'branchId', '')::uuid;
  v_days int := least(greatest(coalesce((p->>'days')::int, 14), 7), 60);
  v_now timestamptz := coalesce(nullif(p->>'asOf', '')::timestamptz, now());
  v_mine uuid := nullif(p->>'mine', '')::uuid;
  v_ids uuid[];
  v_today jsonb; v_yday jsonb; v_series jsonb; v_branches jsonb; v_tellers jsonb; v_pay jsonb; v_stock jsonb; v_transfers jsonb;
  v_debts jsonb; v_customers jsonb; v_flags jsonb; v_cash jsonb; v_mine_j jsonb; v_pending int; v_signoff int;
begin
  if v_branch is not null and not (v_branch = any (v_scope)) then perform gold.fail(403, 'FORBIDDEN', 'You do not have access to that branch.'); end if;
  v_ids := case when v_branch is null then v_scope else array[v_branch] end;

  select jsonb_build_object(
    'count', count(*) filter (where x.status <> 'void'),
    'paid', coalesce(sum(x.payable) filter (where x.status <> 'void'), 0),
    'voided', count(*) filter (where x.status = 'void'),
    'flagged', count(*) filter (where x.status <> 'void' and cardinality(x.flags) > 0),
    'pounds', coalesce((select sum(i.pounds) from gold.transaction_items i where i.transaction_id in
        (select y.id from gold.dash_base(v_ids, v_days, v_now) y join gold.branches yb on yb.id = y.branch_id where y.status <> 'void' and y.local_date = (v_now at time zone yb.timezone)::date)), 0))
  into v_today
  from gold.dash_base(v_ids, v_days, v_now) x join gold.branches b on b.id = x.branch_id where x.local_date = (v_now at time zone b.timezone)::date;

  select jsonb_build_object('count', count(*) filter (where x.status <> 'void'), 'paid', coalesce(sum(x.payable) filter (where x.status <> 'void'), 0))
  into v_yday
  from gold.dash_base(v_ids, v_days, v_now) x join gold.branches b on b.id = x.branch_id where x.local_date = (v_now at time zone b.timezone)::date - 1;

  -- one row per calendar day of the window, empty days included
  select coalesce(jsonb_agg(jsonb_build_object('date', d.day, 'count', coalesce(s.n, 0), 'paid', gold.ts(coalesce(s.paid, 0)), 'pounds', gold.ts(coalesce(s.lb, 0))) order by d.day), '[]'::jsonb)
  into v_series
  from (select generate_series((v_now at time zone 'Africa/Accra')::date - (v_days - 1), (v_now at time zone 'Africa/Accra')::date, interval '1 day')::date as day) d
  left join (
    select x.local_date, count(*) as n, sum(x.payable) as paid,
           (select sum(i.pounds) from gold.transaction_items i where i.transaction_id = any (array_agg(x.id))) as lb
    from gold.dash_base(v_ids, v_days, v_now) x where x.status <> 'void' group by x.local_date
  ) s on s.local_date = d.day;

  select coalesce(jsonb_agg(row order by (row->>'periodPaid')::numeric desc), '[]'::jsonb) into v_branches from (
    select jsonb_build_object(
      'branchId', b.id, 'name', b.name,
      'todayCount', count(x.id) filter (where x.status <> 'void' and x.local_date = (v_now at time zone b.timezone)::date),
      'todayPaid', gold.ts(coalesce(sum(x.payable) filter (where x.status <> 'void' and x.local_date = (v_now at time zone b.timezone)::date), 0)),
      'periodCount', count(x.id) filter (where x.status <> 'void'),
      'periodPaid', gold.ts(coalesce(sum(x.payable) filter (where x.status <> 'void'), 0)),
      'flagged', count(x.id) filter (where x.status <> 'void' and cardinality(x.flags) > 0),
      'voided', count(x.id) filter (where x.status = 'void'),
      'day', coalesce((select bd.status from gold.business_days bd where bd.branch_id = b.id and bd.business_date = (v_now at time zone b.timezone)::date), 'none'),
      'signoffPending', (select count(*) from gold.business_days bd where bd.branch_id = b.id and bd.signoff_status = 'pending'),
      'goldOnHand', gold.ts(coalesce((select sum(i.pounds) from gold.transaction_items i join gold.transactions tt on tt.id = i.transaction_id
                          where i.location_branch_id = b.id and i.location_state = 'on_hand' and tt.status <> 'void'), 0))
    ) as row
    from gold.branches b left join gold.dash_base(v_ids, v_days, v_now) x on x.branch_id = b.id
    where b.id = any (v_ids) and b.is_active
    group by b.id, b.name, b.timezone
  ) q;

  select coalesce(jsonb_agg(row order by (row->>'paid')::numeric desc), '[]'::jsonb) into v_tellers from (
    select jsonb_build_object('userId', u.id, 'name', u.display_name, 'count', count(*), 'paid', gold.ts(sum(x.payable)),
                              'flagged', count(*) filter (where cardinality(x.flags) > 0)) as row
    from gold.dash_base(v_ids, v_days, v_now) x join gold.users u on u.id = x.created_by
    where x.status <> 'void' group by u.id, u.display_name order by sum(x.payable) desc limit 8
  ) q;

  select jsonb_build_object(
    'cash', gold.ts(coalesce(sum(pm.amount) filter (where pm.method = 'cash'), 0)),
    'mobileMoney', gold.ts(coalesce(sum(pm.amount) filter (where pm.method = 'mobile_money'), 0)),
    'owed', gold.ts(coalesce(sum(pm.amount) filter (where pm.method = 'owed'), 0)))
  into v_pay
  from gold.transaction_payments pm where pm.status <> 'failed' and pm.transaction_id in (select id from gold.dash_base(v_ids, v_days, v_now) where status <> 'void');

  select count(*) into v_pending from gold.transaction_payments pm
   where pm.status = 'pending' and pm.transaction_id in (select id from gold.dash_base(v_ids, v_days, v_now) where status <> 'void');

  select count(*) into v_signoff from gold.business_days bd where bd.branch_id = any (v_ids) and bd.signoff_status = 'pending';

  select jsonb_build_object(
    'onHand', gold.ts(coalesce(sum(i.pounds) filter (where i.location_state = 'on_hand'), 0)),
    'inTransit', gold.ts(coalesce(sum(i.pounds) filter (where i.location_state = 'in_transit'), 0)))
  into v_stock
  from gold.transaction_items i join gold.transactions tt on tt.id = i.transaction_id
  where i.location_branch_id = any (v_ids) and tt.status <> 'void';

  select jsonb_build_object('onTheRoad', count(*), 'value', gold.ts(coalesce(sum(declared_value), 0)))
  into v_transfers
  from gold.transfers where status = 'released' and (origin_branch_id = any (v_ids) or destination_branch_id = any (v_ids));

  select jsonb_build_object('owedToUs', gold.ts(coalesce(sum(outstanding), 0)), 'count', count(*), 'overdue', count(*) filter (where due_date < (v_now at time zone 'Africa/Accra')::date))
  into v_debts from gold.v_debts_outstanding where status = 'open' and outstanding > 0 and branch_id = any (v_ids);

  select coalesce(jsonb_agg(row), '[]'::jsonb) into v_customers from (
    select jsonb_build_object('customerId', x.customer_id, 'name', max(x.customer_name), 'count', count(*), 'paid', gold.ts(sum(x.payable))) as row
    from gold.dash_base(v_ids, v_days, v_now) x where x.status <> 'void' and x.customer_id is not null
    group by x.customer_id order by sum(x.payable) desc limit 5
  ) q;

  select coalesce(jsonb_object_agg(f, n), '{}'::jsonb) into v_flags from (
    select f, count(*) as n from gold.dash_base(v_ids, v_days, v_now) x, unnest(x.flags) f where x.status <> 'void' group by f
  ) q;

  -- cash counted at closing that did not match, within the window
  select jsonb_build_object('days', count(*), 'net', gold.ts(coalesce(sum(r.difference), 0)),
    'recent', coalesce(jsonb_agg(jsonb_build_object('branch', b.name, 'date', bd.business_date, 'difference', gold.ts(r.difference)) order by bd.business_date desc) filter (where true), '[]'::jsonb))
  into v_cash
  from gold.day_reconciliations r join gold.business_days bd on bd.id = r.business_day_id join gold.branches b on b.id = bd.branch_id
  where r.phase = 'closing' and r.asset = 'cash' and r.difference <> 0 and bd.branch_id = any (v_ids)
    and bd.business_date >= (v_now at time zone 'Africa/Accra')::date - (v_days - 1);

  if v_mine is not null then
    select jsonb_build_object(
      'todayCount', count(*) filter (where x.status <> 'void' and x.local_date = (v_now at time zone b.timezone)::date),
      'todayPaid', gold.ts(coalesce(sum(x.payable) filter (where x.status <> 'void' and x.local_date = (v_now at time zone b.timezone)::date), 0)),
      'periodCount', count(*) filter (where x.status <> 'void'),
      'recent', coalesce((select jsonb_agg(jsonb_build_object('reference', y.reference, 'customerName', y.customer_name, 'payable', gold.ts(y.payable), 'capturedAt', y.captured_at, 'status', y.status) order by y.captured_at desc)
                          from (select * from gold.dash_base(v_ids, v_days, v_now) where created_by = v_mine order by captured_at desc limit 5) y), '[]'::jsonb))
    into v_mine_j
    from gold.dash_base(v_ids, v_days, v_now) x join gold.branches b on b.id = x.branch_id where x.created_by = v_mine;
  end if;

  return jsonb_build_object(
    'asOf', v_now, 'days', v_days,
    'today', jsonb_set(v_today, '{paid}', to_jsonb(gold.ts((v_today->>'paid')::numeric))),
    'yesterday', jsonb_set(v_yday, '{paid}', to_jsonb(gold.ts((v_yday->>'paid')::numeric))),
    'series', v_series, 'branches', v_branches, 'tellers', v_tellers, 'payments', v_pay, 'pendingMoney', v_pending, 'signoffPending', v_signoff,
    'stock', v_stock, 'transfers', v_transfers, 'debts', v_debts, 'topCustomers', v_customers, 'flags', v_flags, 'cashDifferences', v_cash,
    'mine', coalesce(v_mine_j, jsonb_build_object('todayCount', 0, 'todayPaid', '0', 'periodCount', 0, 'recent', '[]'::jsonb)));
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;