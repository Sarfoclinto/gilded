-- Branch overview (workers, snapshot, attention) and the cash lookup (scope, denominations, freshness).
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); ksi uuid := gen_random_uuid(); r_dir uuid := gen_random_uuid(); r_tel uuid := gen_random_uuid();
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u3 uuid := gen_random_uuid(); day1 uuid := gen_random_uuid(); day0 uuid := gen_random_uuid(); r jsonb;
begin
  insert into gold.tenants (id, slug, name) values (t, 'ovw', 'Overview Gold');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main, timezone) values (tkw, t, 'TKW', 'Tarkwa', true, 'Africa/Accra'), (ksi, t, 'KSI', 'Kumasi', false, 'Africa/Accra');
  insert into gold.roles (id, tenant_id, key, name) values (r_dir, t, 'director', 'Director'), (r_tel, t, 'teller', 'Teller');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id, is_active) values
    (u1, t, 'ama', 'Ama', 'x', r_dir, true), (u2, t, 'kojo', 'Kojo', 'x', r_tel, true), (u3, t, 'gone', 'Gone', 'x', r_tel, false);
  insert into gold.user_branches (tenant_id, user_id, branch_id, is_primary) values (t, u1, tkw, true), (t, u2, tkw, true), (t, u3, tkw, true), (t, u2, ksi, false);
  insert into gold.business_days (id, tenant_id, branch_id, business_date, status, opened_at, opened_by, closed_at, closed_by, closing_confirmed, closing_confirmation_version, closing_confirmation_text, signoff_status)
  values (day0, t, tkw, current_date - 1, 'closed', now() - interval '30 hours', u1, now() - interval '20 hours', u1, true, 'v1', 'I checked', 'pending');
  insert into gold.day_reconciliations (tenant_id, business_day_id, phase, asset, expected, actual, explanation, explained_by)
  values (t, day0, 'closing', 'cash', 5000, 4900, 'Short by 100, counted twice', u1);
  insert into gold.business_days (id, tenant_id, branch_id, business_date, status, opened_at, opened_by) values (day1, t, tkw, current_date, 'open', now() - interval '2 hours', u1);

  set local role gold_app;
  perform set_config('app.user_id', u1::text, true);
  perform gold.post_cash(tkw, day1, now(), '{"100":5,"50":2}'::jsonb, 1, 'go_live_balance', day1, 'First count');

  -- the cash lookup
  r := gold.branches_cash_json(array[tkw, ksi], null);
  perform gold_test.assert(jsonb_array_length(r->'branches') = 2 and r->'branches'->0->>'name' = 'Tarkwa', 'both branches, main first: ' || r::text);
  perform gold_test.assert((r->'branches'->0->>'cashValue')::numeric = 600 and (r->'branches'->0->'lines'->>'100')::int = 5 and (r->'branches'->0->'lines'->>'50')::int = 2, 'notes and total');
  perform gold_test.assert(r->'branches'->0->>'day' = 'open' and r->'branches'->0->>'lastEntryAt' is not null, 'day state and freshness');
  perform gold_test.assert((r->'branches'->1->>'cashValue')::numeric = 0 and r->'branches'->1->>'day' = 'none' and r->'branches'->1->>'lastEntryAt' is null, 'empty branch');
  perform gold_test.assert(r->>'asOf' is not null, 'asOf is given');
  r := gold.branches_cash_json(array[tkw], null);
  perform gold_test.assert(jsonb_array_length(r->'branches') = 1, 'scope respected');
  r := gold.branches_cash_json(array[tkw, ksi], ksi);
  perform gold_test.assert(jsonb_array_length(r->'branches') = 1 and r->'branches'->0->>'name' = 'Kumasi', 'narrowed to one branch');
  begin
    perform gold.branches_cash_json(array[tkw], ksi);
    perform gold_test.assert(false, 'should have been refused');
  exception when others then
    perform gold_test.assert(sqlerrm like '%FORBIDDEN%', 'outside scope refused: ' || sqlerrm);
  end;

  -- the overview
  r := gold.branch_overview_json(tkw);
  perform gold_test.assert(jsonb_array_length(r->'workers') = 2, 'only active workers: ' || (r->'workers')::text);
  perform gold_test.assert(r->'workers'->0->'role'->>'key' = 'director' and r->'workers'->1->>'name' = 'Kojo', 'workers by role then name');
  perform gold_test.assert((r->'snapshot'->>'cash')::numeric = 600 and (r->'snapshot'->>'goodsTop')::numeric = 0, 'snapshot');
  perform gold_test.assert(r->'openDay'->>'id' = day1::text, 'open day');
  perform gold_test.assert((r->'attention'->>'signoffPending')::int = 1 and (r->'attention'->>'openDifferences')::int = 0, 'attention counts');
  perform gold_test.assert(jsonb_array_length(r->'recentDays') = 2 and (r->'recentDays'->1->>'cashDifference')::numeric = -100 and (r->'recentDays'->1->>'differences')::int = 1, 'recent days: ' || (r->'recentDays')::text);
  perform gold_test.assert((r->'today'->>'count')::int = 0 and r->'recent' = '[]'::jsonb and (r->'debts'->>'owedToUs')::numeric = 0, 'empty activity');
  r := gold.branch_overview_json(ksi);
  perform gold_test.assert(jsonb_array_length(r->'workers') = 1 and r->'openDay' = 'null'::jsonb, 'other branch');
  begin
    perform gold.branch_overview_json(gen_random_uuid());
    perform gold_test.assert(false, 'should be not found');
  exception when others then
    perform gold_test.assert(sqlerrm like '%NOT_FOUND%', 'unknown branch: ' || sqlerrm);
  end;
end $$;