-- Filtering, sorting and paging purchases. Uses the same fixtures style as the export test: a few purchases at two branches.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); ksi uuid := gen_random_uuid(); u uuid := gen_random_uuid(); r_role uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); r jsonb; scope jsonb;
begin
  insert into gold.tenants (id, slug, name) values (t, 'search', 'Search Gold');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main, timezone) values (tkw, t, 'TKW', 'Tarkwa', true, 'Africa/Accra'), (ksi, t, 'KSI', 'Kumasi', false, 'Africa/Accra');
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'director', 'Director');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u, t, 'dir', 'Dir', 'x', r_role);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{"poundGrams":"7.75","priceReferenceKarat":"23"}');
  insert into gold.customers (id, tenant_id, name, phone) values (c1, t, 'Kofi Boateng', '0241000001');
  scope := jsonb_build_array(tkw, ksi);

  insert into gold.transactions (tenant_id, branch_id, reference, customer_id, customer_name, customer_phone, status, formula_version, price_as_of, client_amount, calculated_amount,
                                 payout_policy, payout_strategy, payable, payout_difference, captured_at, created_by, flags)
  values
   (t, tkw, 'TKW-1', c1,   'Kofi Boateng', '0241000001', 'paid',  'ExcelV1', now(), 1000, 1000, 'down', 'prefer-100s', 1000, 0, '2026-10-01 10:00+00', u, '{}'),
   (t, tkw, 'TKW-2', null, 'Ama Serwaa',   '0242000002', 'paid',  'ExcelV1', now(), 3000, 3000, 'down', 'prefer-100s', 3000, 0, '2026-10-02 10:00+00', u, '{OFFLINE_ENTRY}'),
   (t, ksi, 'KSI-1', c1,   'Kofi Boateng', '0241000001', 'paid',  'ExcelV1', now(), 2000, 2000, 'down', 'prefer-100s', 2000, 0, '2026-10-03 10:00+00', u, '{}');
  insert into gold.transactions (tenant_id, branch_id, reference, customer_name, status, formula_version, price_as_of, client_amount, calculated_amount,
                                 payout_policy, payout_strategy, payable, payout_difference, captured_at, created_by, flags, voided_at, voided_by, void_reason)
  values (t, tkw, 'TKW-3', 'Yaw Mensah', 'void', 'ExcelV1', now(), 500, 500, 'down', 'prefer-100s', 500, 0, '2026-10-04 10:00+00', u, '{}', now(), u, 'Wrong customer');

  set local role gold_app;
  perform set_config('app.user_id', u::text, true);

  r := gold.transactions_search(jsonb_build_object('scope', scope));
  perform gold_test.assert((r->>'total')::int = 4 and (r->>'sumPayable')::numeric = 6500, 'all: ' || r::text);
  perform gold_test.assert(r->'items'->0->>'reference' = 'TKW-3', 'newest first');

  r := gold.transactions_search(jsonb_build_object('scope', scope, 'branchId', tkw));
  perform gold_test.assert((r->>'total')::int = 3, 'one branch');

  r := gold.transactions_search(jsonb_build_object('scope', jsonb_build_array(tkw), 'branchId', tkw, 'q', 'kofi'));
  perform gold_test.assert((r->>'total')::int = 1, 'search by name, only inside scope');
  r := gold.transactions_search(jsonb_build_object('scope', scope, 'q', '0242'));
  perform gold_test.assert((r->>'total')::int = 1 and r->'items'->0->>'reference' = 'TKW-2', 'search by phone');
  r := gold.transactions_search(jsonb_build_object('scope', scope, 'q', 'KSI-'));
  perform gold_test.assert((r->>'total')::int = 1, 'search by reference');
  r := gold.transactions_search(jsonb_build_object('scope', scope, 'q', '%'));
  perform gold_test.assert((r->>'total')::int = 0, 'a percent sign is not a wildcard');

  r := gold.transactions_search(jsonb_build_object('scope', scope, 'from', '2026-10-02', 'to', '2026-10-03'));
  perform gold_test.assert((r->>'total')::int = 2, 'date range inclusive');
  r := gold.transactions_search(jsonb_build_object('scope', scope, 'customerId', c1));
  perform gold_test.assert((r->>'total')::int = 2, 'one customer across branches');
  r := gold.transactions_search(jsonb_build_object('scope', scope, 'status', 'void'));
  perform gold_test.assert((r->>'total')::int = 1, 'status');
  r := gold.transactions_search(jsonb_build_object('scope', scope, 'flag', true));
  perform gold_test.assert((r->>'total')::int = 1 and r->'items'->0->>'reference' = 'TKW-2', 'flagged only');
  r := gold.transactions_search(jsonb_build_object('scope', scope, 'minAmount', 1500, 'maxAmount', 2500));
  perform gold_test.assert((r->>'total')::int = 1 and r->'items'->0->>'reference' = 'KSI-1', 'amount range');

  r := gold.transactions_search(jsonb_build_object('scope', scope, 'sort', 'amount_desc'));
  perform gold_test.assert(r->'items'->0->>'reference' = 'TKW-2' and r->'items'->3->>'reference' = 'TKW-3', 'sort by amount');
  r := gold.transactions_search(jsonb_build_object('scope', scope, 'sort', 'oldest', 'limit', 2, 'offset', 1));
  perform gold_test.assert(jsonb_array_length(r->'items') = 2 and r->'items'->0->>'reference' = 'TKW-2' and (r->>'total')::int = 4, 'paging: ' || r::text);
  r := gold.transactions_search(jsonb_build_object('scope', scope, 'limit', 2, 'offset', 3));
  perform gold_test.assert(jsonb_array_length(r->'items') = 1, 'last page is short');

  perform gold_test.assert(gold_test.refuses(format('select gold.transactions_search(%L::jsonb)', jsonb_build_object('scope', jsonb_build_array(tkw), 'branchId', ksi)::text), 'FORBIDDEN'), 'a branch outside the scope is refused');
  perform gold_test.assert(gold_test.refuses(format('select gold.transactions_search(%L::jsonb)', jsonb_build_object('scope', scope, 'sort', 'sideways')::text), 'VALIDATION_FAILED'), 'unknown sort');
end $$;