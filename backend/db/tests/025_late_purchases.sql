-- Purchases that arrive after their day closed, or with a clock that is ahead.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); r_role uuid := gen_random_uuid(); r_dir uuid := gen_random_uuid(); u uuid := gen_random_uuid(); mgr uuid := gen_random_uuid();
  d1 uuid := gen_random_uuid(); d2 uuid := gen_random_uuid(); r jsonb;
  function_payload jsonb;
begin
  insert into gold.tenants (id, slug, name) values (t, 'late', 'Late Gold');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main, timezone) values (tkw, t, 'TKW', 'Tarkwa', true, 'Africa/Accra');
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'teller', 'Teller'), (r_dir, t, 'director', 'Director');
  insert into gold.role_permissions (tenant_id, role_id, permission) values (t, r_dir, 'discrepancies:review');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u, t, 'ama', 'Ama', 'x', r_role), (mgr, t, 'boss', 'Boss', 'x', r_dir);
  insert into gold.user_branches (tenant_id, user_id, branch_id, is_primary) values (t, u, tkw, true), (t, mgr, tkw, true);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  -- yesterday's day, closed 3 hours ago; today's day open
  insert into gold.business_days (id, tenant_id, branch_id, business_date, status, opened_at, opened_by, closed_at, closed_by, closing_confirmed, closing_confirmation_version, closing_confirmation_text, signoff_status)
  values (d1, t, tkw, current_date - 1, 'closed', now() - interval '12 hours', u, now() - interval '3 hours', u, true, 'v1', 'I checked', 'not_required');
  insert into gold.business_days (id, tenant_id, branch_id, business_date, status, opened_at, opened_by) values (d2, t, tkw, current_date, 'open', now() - interval '2 hours', u);

  set local role gold_app;
  perform set_config('app.user_id', u::text, true);
  function_payload := jsonb_build_object('branchId', tkw, 'customer', jsonb_build_object('name', 'Kofi', 'phone', '0241'),
    'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'priceAsOf', now(), 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'owed', 'amount', 1000)));

  -- made during the closed day, arriving now
  r := gold.post_transaction(function_payload || jsonb_build_object('id', gen_random_uuid(), 'items', jsonb_build_array(jsonb_set(gold_test.item(), '{id}', to_jsonb(gen_random_uuid()::text))), 'capturedAt', now() - interval '5 hours'));
  perform gold_test.assert(r->'data'->'flags' ? 'AFTER_CLOSE', 'flagged: ' || (r->'data'->'flags')::text);
  perform gold_test.assert((select count(*) from gold.notifications where kind = 'late_purchase' and user_id = mgr) = 1, 'reviewers are told');
  -- made today, on time
  r := gold.post_transaction(function_payload || jsonb_build_object('id', gen_random_uuid(), 'items', jsonb_build_array(jsonb_set(gold_test.item(), '{id}', to_jsonb(gen_random_uuid()::text))), 'capturedAt', now() - interval '1 hour'));
  perform gold_test.assert(not (r->'data'->'flags' ? 'AFTER_CLOSE'), 'on time is not flagged');
  -- a clock that runs ahead
  r := gold.post_transaction(function_payload || jsonb_build_object('id', gen_random_uuid(), 'items', jsonb_build_array(jsonb_set(gold_test.item(), '{id}', to_jsonb(gen_random_uuid()::text))), 'capturedAt', now() + interval '2 days'));
  perform gold_test.assert(r->'data'->'flags' ? 'CLOCK_AHEAD', 'clock ahead flagged');
  perform gold_test.assert((r->'data'->>'capturedAt')::timestamptz <= now() + interval '1 minute', 'dated by the server instead: ' || (r->'data'->>'capturedAt'));
  -- sending the same purchase again changes nothing
  perform gold_test.assert((select count(*) from gold.notifications where kind = 'late_purchase') = 1, 'no extra notice');
end $$;