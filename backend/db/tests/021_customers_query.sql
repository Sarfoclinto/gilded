-- Customers: search, filters, sorting, paging, summary; lifetime figures; the receipt's cancellation details.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); r_role uuid := gen_random_uuid(); u uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); c3 uuid := gen_random_uuid(); c4 uuid := gen_random_uuid();
  tx1 uuid := gen_random_uuid(); tx2 uuid := gen_random_uuid(); tx3 uuid := gen_random_uuid(); tx4 uuid := gen_random_uuid();
  debt uuid := gen_random_uuid(); r jsonb;
begin
  insert into gold.tenants (id, slug, name) values (t, 'cq', 'CQ Gold');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', true);
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'director', 'Director');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u, t, 'dir', 'Dir', 'x', r_role);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{"poundGrams":"7.75","priceReferenceKarat":"23"}');
  insert into gold.customers (id, tenant_id, name, phone) values
    (c1, t, 'Kofi Boateng', '0241000001'), (c2, t, 'Ama Serwaa', '0242000002'), (c3, t, 'Yaw Mensah', '0243000003'), (c4, t, 'Esi 100%', '0244000004');

  insert into gold.transactions (id, tenant_id, branch_id, reference, customer_id, customer_name, status, formula_version, price_as_of, client_amount, calculated_amount,
                                 payout_policy, payout_strategy, payable, payout_difference, captured_at, created_by)
  values
   (tx1, t, tkw, 'A-1', c1, 'Kofi Boateng', 'paid', 'ExcelV1', now(), 1000, 1000, 'down', 'prefer-100s', 1000, 0, now() - interval '2 days', u),
   (tx2, t, tkw, 'A-2', c1, 'Kofi Boateng', 'paid', 'ExcelV1', now(), 3000, 3000, 'down', 'prefer-100s', 3000, 0, now() - interval '5 days', u),
   (tx3, t, tkw, 'A-3', c2, 'Ama Serwaa',   'paid', 'ExcelV1', now(), 500,  500,  'down', 'prefer-100s', 500,  0, now() - interval '200 days', u);
  insert into gold.transactions (id, tenant_id, branch_id, reference, customer_id, customer_name, status, formula_version, price_as_of, client_amount, calculated_amount,
                                 payout_policy, payout_strategy, payable, payout_difference, captured_at, created_by, voided_at, voided_by, void_reason)
  values (tx4, t, tkw, 'A-4', c3, 'Yaw Mensah', 'void', 'ExcelV1', now(), 9000, 9000, 'down', 'prefer-100s', 9000, 0, now() - interval '1 day', u, now(), u, 'Wrong customer entered');
  insert into gold.debts (id, tenant_id, branch_id, customer_id, party_name, party_type, principal, reason, issued_at, issued_by)
  values (debt, t, tkw, c3, 'Yaw Mensah', 'customer', 700, 'Advance', now(), u);

  set local role gold_app;
  perform set_config('app.user_id', u::text, true);

  r := gold.customers_query_json('{}'::jsonb);
  perform gold_test.assert((r->>'total')::int = 4 and r->'items'->0->>'name' = 'Ama Serwaa', 'all, by name: ' || r::text);
  perform gold_test.assert((r->'summary'->>'customers')::int = 4 and (r->'summary'->>'active')::int = 1 and (r->'summary'->>'owesUs')::numeric = 700, 'summary');

  r := gold.customers_query_json('{"q":"kofi"}');
  perform gold_test.assert((r->>'total')::int = 1 and (r->'items'->0->>'purchases')::int = 2 and (r->'items'->0->>'lifetimePaid')::numeric = 4000, 'search and lifetime: ' || r::text);
  r := gold.customers_query_json('{"q":"0242"}');
  perform gold_test.assert((r->>'total')::int = 1 and r->'items'->0->>'name' = 'Ama Serwaa', 'search by phone');
  r := gold.customers_query_json('{"q":"%"}');
  perform gold_test.assert((r->>'total')::int = 1 and r->'items'->0->>'name' = 'Esi 100%', 'a percent sign is plain text');

  r := gold.customers_query_json('{"filter":"owes_us"}');
  perform gold_test.assert((r->>'total')::int = 1 and r->'items'->0->>'name' = 'Yaw Mensah', 'owes us');
  r := gold.customers_query_json('{"filter":"we_owe"}');
  perform gold_test.assert((r->>'total')::int = 0, 'we owe nobody');
  r := gold.customers_query_json('{"filter":"active"}');
  perform gold_test.assert((r->>'total')::int = 1 and r->'items'->0->>'name' = 'Kofi Boateng', 'active in 30 days (a cancelled purchase does not count)');
  r := gold.customers_query_json('{"filter":"inactive"}');
  perform gold_test.assert((r->>'total')::int = 3, 'inactive: quiet for 90 days or never bought: ' || r::text);

  r := gold.customers_query_json('{"sort":"paid"}');
  perform gold_test.assert(r->'items'->0->>'name' = 'Kofi Boateng' and r->'items'->1->>'name' = 'Ama Serwaa', 'sort by paid');
  r := gold.customers_query_json('{"sort":"recent"}');
  perform gold_test.assert(r->'items'->0->>'name' = 'Kofi Boateng' and r->'items'->1->>'name' = 'Ama Serwaa', 'sort by recent, never-bought last');
  r := gold.customers_query_json('{"sort":"owes"}');
  perform gold_test.assert(r->'items'->0->>'name' = 'Yaw Mensah', 'sort by money owed');

  r := gold.customers_query_json('{"limit":2,"offset":1}');
  perform gold_test.assert(jsonb_array_length(r->'items') = 2 and (r->>'total')::int = 4 and r->'items'->0->>'name' = 'Esi 100%', 'paging');
  perform gold_test.assert(gold_test.code_of($f$select gold.customers_query_json('{"sort":"sideways"}')$f$) = 'VALIDATION_FAILED', 'unknown sort refused');
  perform gold_test.assert(gold_test.code_of($f$select gold.customers_query_json('{"filter":"nope"}')$f$) = 'VALIDATION_FAILED', 'unknown filter refused');

  -- a cancelled purchase does not count as a purchase
  r := gold.customer_row_json((select c from gold.customers c where c.id = c3));
  perform gold_test.assert((r->>'purchases')::int = 0 and (r->>'lifetimePaid')::numeric = 0 and r->>'firstPurchaseAt' is null, 'cancelled purchases are not counted: ' || r::text);

  -- the receipt carries the cancellation
  r := gold.transaction_json(tx4);
  perform gold_test.assert(r->>'status' = 'void' and r->>'voidReason' = 'Wrong customer entered' and r#>>'{voidedBy,displayName}' = 'Dir' and r->>'voidedAt' is not null and r->>'priceAsOf' is not null, 'void details: ' || r::text);
  r := gold.transaction_json(tx1);
  perform gold_test.assert(r->>'voidedAt' is null and r->>'voidReason' is null and r->'voidedBy' = 'null'::jsonb, 'a normal purchase has none');
end $$;