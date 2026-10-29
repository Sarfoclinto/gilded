-- The dashboard feed: today vs yesterday, series, per-branch and per-teller figures, payment mix, stock, cash differences, scope.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); ksi uuid := gen_random_uuid(); r_role uuid := gen_random_uuid();
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); tx1 uuid := gen_random_uuid(); tx2 uuid := gen_random_uuid(); tx3 uuid := gen_random_uuid();
  tx4 uuid := gen_random_uuid(); day1 uuid := gen_random_uuid(); r jsonb; scope jsonb; now_ timestamptz := '2026-10-20 12:00+00';
begin
  insert into gold.tenants (id, slug, name) values (t, 'dash', 'Dash Gold');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main, timezone) values (tkw, t, 'TKW', 'Tarkwa', true, 'Africa/Accra'), (ksi, t, 'KSI', 'Kumasi', false, 'Africa/Accra');
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'director', 'Director');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u1, t, 'ama', 'Ama', 'x', r_role), (u2, t, 'kojo', 'Kojo', 'x', r_role);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{"poundGrams":"7.75","priceReferenceKarat":"23"}');
  scope := jsonb_build_array(tkw, ksi);

  insert into gold.transactions (id, tenant_id, branch_id, reference, customer_name, status, formula_version, price_as_of, client_amount, calculated_amount,
                                 payout_policy, payout_strategy, payable, payout_difference, captured_at, created_by, flags)
  values
   (tx1, t, tkw, 'TKW-1', 'Kofi', 'paid', 'ExcelV1', now_, 1000, 1000, 'down', 'prefer-100s', 1000, 0, '2026-10-20 09:00+00', u1, '{}'),
   (tx2, t, tkw, 'TKW-2', 'Ama',  'paid', 'ExcelV1', now_, 3000, 3000, 'down', 'prefer-100s', 3000, 0, '2026-10-20 10:00+00', u2, '{OFFLINE_ENTRY}'),
   (tx3, t, ksi, 'KSI-1', 'Yaw',  'paid', 'ExcelV1', now_, 2000, 2000, 'down', 'prefer-100s', 2000, 0, '2026-10-19 10:00+00', u1, '{}'),
   (tx4, t, ksi, 'KSI-2', 'Esi',  'paid', 'ExcelV1', now_, 500,  500,  'down', 'prefer-100s', 500,  0, '2026-10-01 10:00+00', u1, '{}');
  insert into gold.transactions (tenant_id, branch_id, reference, customer_name, status, formula_version, price_as_of, client_amount, calculated_amount,
                                 payout_policy, payout_strategy, payable, payout_difference, captured_at, created_by, voided_at, voided_by, void_reason)
  values (t, tkw, 'TKW-3', 'Void', 'void', 'ExcelV1', now_, 9999, 9999, 'down', 'prefer-100s', 9999, 0, '2026-10-20 11:00+00', u1, now_, u1, 'Wrong customer');
  insert into gold.transaction_items (tenant_id, transaction_id, line_no, top, down, price, density, karat, purity, net_weight, pounds, amount, location_branch_id)
  values (t, tx1, 1, 10, 9, 100, 15, 20, 0.8, 8, 2.5, 1000, tkw), (t, tx2, 1, 10, 9, 100, 15, 20, 0.8, 8, 4, 3000, tkw);
  insert into gold.transaction_payments (tenant_id, transaction_id, method, amount, recorded_by, paid_by_branch_id) values
   (t, tx1, 'cash', 1000, u1, null), (t, tx2, 'cash', 2000, u2, null), (t, tx2, 'mobile_money', 1000, u2, tkw);

  insert into gold.business_days (id, tenant_id, branch_id, business_date, status, opened_at, opened_by, closed_at, closed_by, closing_confirmed, closing_confirmation_version, closing_confirmation_text, signoff_status)
  values (day1, t, tkw, '2026-10-19', 'closed', '2026-10-19 07:00+00', u1, '2026-10-19 17:00+00', u1, true, 'v1', 'I checked', 'pending');
  insert into gold.day_reconciliations (tenant_id, business_day_id, phase, asset, expected, actual, explanation, explained_by)
  values (t, day1, 'closing', 'cash', 5000, 4900, 'Counted twice, short by 100', u1);

  set local role gold_app;
  perform set_config('app.user_id', u1::text, true);

  r := gold.dashboard_json(jsonb_build_object('scope', scope, 'asOf', now_, 'mine', u1));
  perform gold_test.assert((r->'today'->>'count')::int = 2 and (r->'today'->>'paid')::numeric = 4000, 'today excludes void: ' || (r->'today')::text);
  perform gold_test.assert((r->'today'->>'voided')::int = 1 and (r->'today'->>'flagged')::int = 1, 'voided and flagged today');
  perform gold_test.assert((r->'today'->>'pounds')::numeric = 6.5, 'pounds today');
  perform gold_test.assert((r->'yesterday'->>'count')::int = 1 and (r->'yesterday'->>'paid')::numeric = 2000, 'yesterday');
  perform gold_test.assert(jsonb_array_length(r->'series') = 14, 'series has every day');
  perform gold_test.assert(r->'series'->13->>'date' = '2026-10-20' and (r->'series'->13->>'paid')::numeric = 4000, 'last point is today');
  perform gold_test.assert(r->'series'->12->>'date' = '2026-10-19' and (r->'series'->12->>'count')::int = 1, 'yesterday point');
  perform gold_test.assert((r->'series'->0->>'count')::int = 0, 'empty day is zero');
  perform gold_test.assert(jsonb_array_length(r->'branches') = 2 and r->'branches'->0->>'name' = 'Tarkwa', 'branches ranked by period paid');
  perform gold_test.assert((r->'branches'->0->>'signoffPending')::int = 1 and r->'branches'->0->>'day' = 'none', 'sign-off and day state');
  perform gold_test.assert((r->'branches'->0->>'goldOnHand')::numeric = 6.5, 'gold on hand');
  perform gold_test.assert(r->'tellers'->0->>'name' = 'Ama' or r->'tellers'->0->>'name' = 'Kojo', 'tellers listed');
  perform gold_test.assert(jsonb_array_length(r->'tellers') = 2 and (r->'tellers'->0->>'paid')::numeric = 3000 and (select sum((x->>'flagged')::int) from jsonb_array_elements(r->'tellers') x) = 1, 'tellers: ' || (r->'tellers')::text);
  perform gold_test.assert((r->'payments'->>'cash')::numeric = 3000 and (r->'payments'->>'mobileMoney')::numeric = 1000, 'payment mix');
  perform gold_test.assert((r->'flags'->>'OFFLINE_ENTRY')::int = 1, 'flag counts');
  perform gold_test.assert((r->'cashDifferences'->>'days')::int = 1 and (r->'cashDifferences'->>'net')::numeric = -100, 'cash difference');
  perform gold_test.assert((r->>'signoffPending')::int = 1, 'sign-off count');
  perform gold_test.assert((r->'mine'->>'todayCount')::int = 1 and (r->'mine'->>'todayPaid')::numeric = 1000 and jsonb_array_length(r->'mine'->'recent') >= 1, 'my own figures: ' || (r->'mine')::text);
  -- the 1 Oct purchase is outside the 14-day window, inside a 30-day one
  perform gold_test.assert((r->'branches'->1->>'periodCount')::int = 1, 'old purchase outside window');
  r := gold.dashboard_json(jsonb_build_object('scope', scope, 'asOf', now_, 'days', 30));
  perform gold_test.assert((r->'branches'->1->>'periodCount')::int = 2 and jsonb_array_length(r->'series') = 30, '30-day window');

  -- scope: only the branches given, and a branch outside scope is refused
  r := gold.dashboard_json(jsonb_build_object('scope', jsonb_build_array(ksi), 'asOf', now_));
  perform gold_test.assert(jsonb_array_length(r->'branches') = 1 and (r->'today'->>'count')::int = 0, 'scope respected');
  begin
    perform gold.dashboard_json(jsonb_build_object('scope', jsonb_build_array(ksi), 'branchId', tkw));
    perform gold_test.assert(false, 'should have been refused');
  exception when others then
    perform gold_test.assert(sqlerrm like 'FORBIDDEN%' or sqlerrm like '%FORBIDDEN%', 'outside scope refused: ' || sqlerrm);
  end;
  -- empty data still has the right shape
  r := gold.dashboard_json(jsonb_build_object('scope', jsonb_build_array(), 'asOf', now_));
  perform gold_test.assert((r->'today'->>'count')::int = 0 and r->'branches' = '[]'::jsonb and (r->'mine'->>'todayCount')::int = 0, 'empty shape: ' || r::text);
end $$;