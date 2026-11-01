-- Setting customers.autoCreate: on by default (a new name and phone becomes a customer); off means the purchase is saved without making one.
do $$
declare
  t uuid := gen_random_uuid(); b uuid := gen_random_uuid(); r_role uuid := gen_random_uuid(); u1 uuid := gen_random_uuid(); d1 uuid := gen_random_uuid();
  r jsonb; n0 int;
begin
  insert into gold.tenants (id, slug, name) values (t, 'autocust', 'Auto customer');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main, timezone) values (b, t, 'TKW', 'Tarkwa', true, 'Africa/Accra');
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'director', 'Director');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u1, t, 'dir', 'Dir', 'x', r_role);
  insert into gold.user_branches (tenant_id, user_id, branch_id, is_primary) values (t, u1, b, true);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  set local role gold_app;
  perform set_config('app.user_id', u1::text, true);
  perform gold.open_day(jsonb_build_object('id', d1, 'branchId', b, 'businessDate', current_date, 'lines', '{"100":50}'::jsonb, 'capturedAt', now() - interval '2 hours'));
  perform gold_test.assert((gold.settings_json()->>'customers.autoCreate')::boolean, 'on by default');

  -- on: a new name and phone becomes a customer
  r := gold.post_transaction(jsonb_build_object('id', gen_random_uuid(), 'branchId', b, 'customer', jsonb_build_object('name', 'Kofi', 'phone', '0244000111'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now() - interval '90 minutes', 'priceAsOf', now() - interval '2 hours', 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb))));
  perform gold_test.assert((r#>>'{data,customerId}') is not null, 'customer made when on');
  perform gold_test.assert((select count(*) from gold.customers where phone = '0244000111') = 1, 'one customer row');

  -- off: a new person is not made, the purchase is still saved with the name and phone on it
  perform gold.set_settings('{"customers.autoCreate":false}'::jsonb);
  select count(*) into n0 from gold.customers;
  r := gold.post_transaction(jsonb_build_object('id', gen_random_uuid(), 'branchId', b, 'customer', jsonb_build_object('name', 'Ama', 'phone', '0244000222'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now() - interval '80 minutes', 'priceAsOf', now() - interval '2 hours', 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb))));
  perform gold_test.assert((r#>>'{data,customerId}') is null and r#>>'{data,customerName}' = 'Ama', 'saved without a customer record');
  perform gold_test.assert((select count(*) from gold.customers) = n0, 'no customer was added');

  -- off: a customer that already exists is still linked (same name and phone, no id)
  r := gold.post_transaction(jsonb_build_object('id', gen_random_uuid(), 'branchId', b, 'customer', jsonb_build_object('name', 'kofi', 'phone', '0244 000 111'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now() - interval '70 minutes', 'priceAsOf', now() - interval '2 hours', 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb))));
  perform gold_test.assert((r#>>'{data,customerId}') is not null, 'existing customer still linked when off');
  raise notice 'customer auto-create setting ok';
end $$;