-- Representatives, customers created on a device with their own id, and the branch-first customer lookup.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); ksi uuid := gen_random_uuid();
  r_role uuid := gen_random_uuid(); u uuid := gen_random_uuid(); new_id uuid := gen_random_uuid(); other_id uuid := gen_random_uuid();
  tx1 uuid := gen_random_uuid(); tx2 uuid := gen_random_uuid(); tx3 uuid := gen_random_uuid(); tx4 uuid := gen_random_uuid();
  kofi uuid; r jsonb; n int;
begin
  insert into gold.tenants (id, slug, name) values (t, 'lookup', 'Lookup Gold');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', false), (ksi, t, 'KSI', 'Kumasi', true);
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'teller', 'Teller');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u, t, 'ama', 'Ama', 'x', r_role);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  set local role gold_app;
  perform set_config('app.user_id', u::text, true);
  perform gold.open_day(jsonb_build_object('id', gen_random_uuid(), 'branchId', tkw, 'businessDate', current_date, 'lines', '{"100":50}'::jsonb, 'capturedAt', now()));
  perform gold.open_day(jsonb_build_object('id', gen_random_uuid(), 'branchId', ksi, 'businessDate', current_date, 'lines', '{"100":50}'::jsonb, 'capturedAt', now()));


  -- a customer at Kumasi, then another one at Tarkwa
  r := gold.post_transaction(jsonb_build_object('id', tx1, 'branchId', ksi, 'customer', jsonb_build_object('name', 'Kofi Boateng', 'phone', '0241'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(), 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb))));
  kofi := (r->'data'->>'customerId')::uuid;
  r := gold.post_transaction(jsonb_build_object('id', tx2, 'branchId', tkw, 'customer', jsonb_build_object('name', 'Kojo Mensah', 'phone', '0242'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(), 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb))));

  -- lookup: this branch's customers lead, others follow, exact phone leads everything
  r := gold.customers_lookup_json(null, tkw, 50);
  perform gold_test.assert(r->0->>'name' = 'Kojo Mensah' and (r->0->>'atBranch')::boolean and r->1->>'name' = 'Kofi Boateng' and not (r->1->>'atBranch')::boolean,
    'Tarkwa sees its own customer first: ' || r::text);
  r := gold.customers_lookup_json(null, ksi, 50);
  perform gold_test.assert(r->0->>'name' = 'Kofi Boateng', 'Kumasi sees its own first');
  r := gold.customers_lookup_json('0241', tkw, 50);
  perform gold_test.assert(jsonb_array_length(r) = 1 and r->0->>'name' = 'Kofi Boateng', 'search by phone finds a customer of another branch');
  perform gold_test.assert(jsonb_array_length(gold.customers_lookup_json('kofi', tkw, 50)) = 1, 'search by name');

  -- a representative brings gold for Kofi: the purchase belongs to Kofi, the representative is only written on it
  select count(*) into n from gold.customers;
  r := gold.post_transaction(jsonb_build_object('id', tx3, 'branchId', tkw, 'customer', jsonb_build_object('id', kofi, 'name', 'Kofi Boateng', 'phone', '0241'),
    'representative', jsonb_build_object('name', 'Yaw (his nephew)', 'phone', '0555 123 456'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(), 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb))));
  perform gold_test.assert((r->'data'->>'customerId')::uuid = kofi and r->'data'->'representative'->>'name' = 'Yaw (his nephew)'
    and r->'data'->'representative'->>'phone' = '0555123456', 'linked to Kofi with the representative written on it');
  perform gold_test.assert((select count(*) from gold.customers) = n, 'the representative did not become a customer');

  -- a representative with no customer to link is refused
  perform gold_test.assert(gold_test.refuses(format('select gold.post_transaction(%L::jsonb)', jsonb_build_object('id', gen_random_uuid(), 'branchId', tkw,
    'customer', jsonb_build_object('name', 'Someone'), 'representative', jsonb_build_object('name', 'Yaw'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(), 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb)))), 'REPRESENTATIVE_NEEDS_CUSTOMER'),
    'a representative needs a customer');

  -- a new customer made on a device keeps the device's id; a second queued purchase with the same id agrees
  r := gold.post_transaction(jsonb_build_object('id', tx4, 'branchId', tkw, 'customer', jsonb_build_object('id', new_id, 'name', 'Efua Asante', 'phone', '0243'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(), 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb))));
  perform gold_test.assert((r->'data'->>'customerId')::uuid = new_id, 'the new customer kept the id the device gave');
  r := gold.post_transaction(jsonb_build_object('id', gen_random_uuid(), 'branchId', ksi, 'customer', jsonb_build_object('id', new_id, 'name', 'Efua Asante', 'phone', '0243'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(), 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb))));
  perform gold_test.assert((r->'data'->>'customerId')::uuid = new_id and (select count(*) from gold.customers where phone = '0243') = 1, 'the same id twice is one customer');
  -- another device invented a different id for the same person: they are matched, not duplicated
  r := gold.post_transaction(jsonb_build_object('id', gen_random_uuid(), 'branchId', ksi, 'customer', jsonb_build_object('id', other_id, 'name', 'efua asante', 'phone', '0243'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(), 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb))));
  perform gold_test.assert((r->'data'->>'customerId')::uuid = new_id and (select count(*) from gold.customers where phone = '0243') = 1, 'same person, different device id: no duplicate');
  -- an unknown id with no phone is still refused
  perform gold_test.assert(gold_test.refuses(format('select gold.ensure_customer(%L, ''Ghost'', null)', gen_random_uuid()), 'NOT_FOUND'), 'an unknown id without a phone is refused');
  reset role;
  raise notice 'customer lookup: all assertions passed';
end $$;