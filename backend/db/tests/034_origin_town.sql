-- Where the gold comes from: towns are found or created by name (ignoring case/spaces), optional on a purchase, private to the company.
do $$
declare
  t uuid := gen_random_uuid(); t2 uuid := gen_random_uuid(); b uuid := gen_random_uuid(); r_role uuid := gen_random_uuid(); u1 uuid := gen_random_uuid();
  d1 uuid := gen_random_uuid(); tx1 uuid := gen_random_uuid(); tx2 uuid := gen_random_uuid(); tx3 uuid := gen_random_uuid(); town uuid := gen_random_uuid();
  r jsonb; first_id uuid;
begin
  insert into gold.tenants (id, slug, name) values (t, 'town', 'Town'), (t2, 'town2', 'Town two');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main, timezone) values (b, t, 'TKW', 'Tarkwa', true, 'Africa/Accra');
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'teller', 'Teller');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u1, t, 'ama', 'Ama', 'x', r_role);
  insert into gold.user_branches (tenant_id, user_id, branch_id, is_primary) values (t, u1, b, true);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  set local role gold_app;
  perform set_config('app.user_id', u1::text, true);
  perform gold.open_day(jsonb_build_object('id', d1, 'branchId', b, 'businessDate', current_date, 'lines', '{"100":50}'::jsonb, 'capturedAt', now() - interval '2 hours'));

  r := gold.create_town(jsonb_build_object('id', town, 'name', '  Obuasi '));
  perform gold_test.assert((r->>'id')::uuid = town and r->>'name' = 'Obuasi', 'created with the device id and a tidy name: ' || r::text);
  perform gold_test.assert((gold.create_town('{"name":"OBUASI"}'::jsonb)->>'id')::uuid = town, 'same town, different case, is not a second town');
  perform gold_test.assert((gold.create_town('{"name":"o-buasi"}'::jsonb)->>'id')::uuid = town, 'punctuation is ignored');
  perform gold_test.assert((gold.create_town(jsonb_build_object('id', gen_random_uuid(), 'name', 'obuasi'))->>'id')::uuid = town, 'a different id for an existing name gives the existing town');
  perform gold_test.assert(gold_test.code_of($q$select gold.create_town('{"name":"x"}'::jsonb)$q$) = 'VALIDATION_FAILED', 'too short refused');
  perform gold_test.assert(gold_test.code_of($q$select gold.create_town('{"name":"!!"}'::jsonb)$q$) = 'VALIDATION_FAILED', 'needs letters or numbers');
  perform gold.create_town('{"name":"Wassa Akropong"}'::jsonb);
  perform gold_test.assert(jsonb_array_length(gold.towns_json()) = 2, 'two towns');
  perform gold_test.assert(jsonb_array_length(gold.towns_json('wassa')) = 1 and jsonb_array_length(gold.towns_json('akro pong')) = 1, 'search ignores case and spaces');

  -- a purchase with a town (existing id), one with a brand new town by name, one with none
  r := gold.post_transaction(jsonb_build_object('id', tx1, 'branchId', b, 'customer', jsonb_build_object('name', 'Kwesi'), 'originTown', jsonb_build_object('id', town, 'name', 'Obuasi'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now() - interval '90 minutes', 'priceAsOf', now() - interval '2 hours', 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb))));
  perform gold_test.assert(r#>>'{data,originTown,name}' = 'Obuasi', 'the purchase shows its town');
  r := gold.post_transaction(jsonb_build_object('id', tx2, 'branchId', b, 'customer', jsonb_build_object('name', 'Yaw'), 'originTown', jsonb_build_object('name', 'Dunkwa on Offin'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now() - interval '80 minutes', 'priceAsOf', now() - interval '2 hours', 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb))));
  perform gold_test.assert(r#>>'{data,originTown,name}' = 'Dunkwa on Offin', 'a new town is made by the purchase itself');
  r := gold.post_transaction(jsonb_build_object('id', tx3, 'branchId', b, 'customer', jsonb_build_object('name', 'Efua'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now() - interval '70 minutes', 'priceAsOf', now() - interval '2 hours', 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb))));
  perform gold_test.assert(r#>'{data,originTown}' = 'null'::jsonb or r#>'{data,originTown}' is null, 'no town is fine');
  perform gold_test.assert((select uses from jsonb_to_recordset(gold.towns_json()) as x(id uuid, uses int) where id = town) = 1, 'uses are counted');
  perform gold_test.assert((gold.towns_json()->0->>'uses')::int = 1, 'most used first');
  perform gold_test.assert(gold_test.code_of(format($q$select gold.resolve_town('{"id":"%s"}'::jsonb)$q$, gen_random_uuid())) = 'VALIDATION_FAILED', 'an unknown id with no name is refused');

  -- another company sees none of it
  reset role;
  perform set_config('app.tenant_id', t2::text, true);
  set local role gold_app;
  perform gold_test.assert(jsonb_array_length(gold.towns_json()) = 0, 'towns are private to the company');
  raise notice 'origin town ok';
end $$;