-- What carat to expect: labels, medians and ranges per town and per customer, with a minimum count before a number is trusted.
do $$
declare
  t uuid := gen_random_uuid(); b uuid := gen_random_uuid(); r_role uuid := gen_random_uuid(); u1 uuid := gen_random_uuid();
  tx uuid; first_tx uuid; town uuid := gen_random_uuid(); town2 uuid := gen_random_uuid(); cust uuid; i int; r jsonb; ks numeric[] := array[22.8, 22.7, 22.9, 22.6, 23.1, 22.8];
begin
  insert into gold.tenants (id, slug, name) values (t, 'expect', 'Expect');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main, timezone) values (b, t, 'TKW', 'Tarkwa', true, 'Africa/Accra');
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'teller', 'Teller');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u1, t, 'ama', 'Ama', 'x', r_role);
  insert into gold.user_branches (tenant_id, user_id, branch_id, is_primary) values (t, u1, b, true);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  set local role gold_app;
  perform set_config('app.user_id', u1::text, true);
  perform gold_test.assert(gold.karat_label(22.1) = '22 low' and gold.karat_label(22.5) = '22 mid' and gold.karat_label(22.8) = '22 high' and gold.karat_label(24) = '24' and gold.karat_label(21.0) = '21 low', 'labels');
  perform gold.open_day(jsonb_build_object('id', gen_random_uuid(), 'branchId', b, 'businessDate', current_date, 'lines', '{"100":300}'::jsonb, 'capturedAt', now() - interval '3 hours'));
  perform gold.create_town(jsonb_build_object('id', town, 'name', 'Obuasi'));
  perform gold.create_town(jsonb_build_object('id', town2, 'name', 'Prestea'));

  -- six purchases from Obuasi by Kwesi, one from Prestea; the item karat is set afterwards to the values we want to look at
  for i in 1..7 loop
    tx := gen_random_uuid(); if i = 1 then first_tx := tx; end if;
    r := gold.post_transaction(jsonb_build_object('id', tx, 'branchId', b, 'customer', jsonb_build_object('name', 'Kwesi', 'phone', '0244000111'),
      'originTown', jsonb_build_object('id', case when i <= 6 then town else town2 end, 'name', case when i <= 6 then 'Obuasi' else 'Prestea' end),
      'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
      'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now() - interval '2 hours' + i * interval '1 minute', 'priceAsOf', now() - interval '3 hours', 'flags', '[]'::jsonb,
      'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb))));
    update gold.transaction_items set karat = case when i <= 6 then ks[i] else 19.4 end where transaction_id = tx;
    cust := (r#>>'{data,customerId}')::uuid;
  end loop;

  r := gold.expect_json(town, cust);
  perform gold_test.assert((r#>>'{town,n}')::int = 6 and (r#>>'{town,enough}')::boolean and r#>>'{town,name}' = 'Obuasi', 'town counted: ' || r::text);
  perform gold_test.assert(r#>>'{town,usual}' = '22 high' and (r#>>'{town,median}')::numeric = 22.8, 'usual carat: ' || (r->'town')::text);
  perform gold_test.assert(r#>>'{town,from}' = '22 mid' and r#>>'{town,to}' = '23 low', 'range');
  perform gold_test.assert((r#>>'{customer,n}')::int = 7, 'customer has all seven');
  r := gold.expect_json(town2, null);
  perform gold_test.assert((r#>>'{town,n}')::int = 1 and not (r#>>'{town,enough}')::boolean and r#>>'{town,usual}' = '19 mid', 'one piece is not enough to trust');
  perform gold_test.assert((gold.expect_json(null, null)->'town') = 'null'::jsonb, 'nothing asked, nothing said');
  perform gold_test.assert((gold.expect_json(gen_random_uuid(), null)->'town') = 'null'::jsonb, 'unknown town is just empty');

  -- cancelled purchases do not count
  reset role;
  update gold.transactions set status = 'void', voided_at = now(), voided_by = u1, void_reason = 'test void entry' where id = first_tx;
  set local role gold_app;
  perform set_config('app.user_id', u1::text, true);
  perform gold_test.assert((gold.expect_json(town, null)#>>'{town,n}')::int = 5, 'a cancelled purchase is left out');
  raise notice 'carat expectations ok';
end $$;