-- Recalling a released transfer that never arrived: books come back, items go back on the shelf, a receipt after a recall is refused.
do $$
declare
  t uuid := gen_random_uuid(); a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); r_role uuid := gen_random_uuid();
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); tx uuid := gen_random_uuid(); items uuid[];
  g uuid := gen_random_uuid(); c uuid := gen_random_uuid(); g2 uuid := gen_random_uuid();
  r jsonb; bal record; before_goods numeric; before_cash numeric;
begin
  insert into gold.tenants (id, slug, name) values (t, 'recall', 'Recall');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (a, t, 'TKW', 'Tarkwa', false), (b, t, 'KSI', 'Kumasi', true);
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'teller', 'Teller');
  insert into gold.role_permissions (tenant_id, role_id, permission) values (t, r_role, 'transfers:receive');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u1, t, 'ama', 'Ama', 'x', r_role), (u2, t, 'kojo', 'Kojo', 'x', r_role);
  insert into gold.user_branches (tenant_id, user_id, branch_id, is_primary) values (t, u1, a, true), (t, u2, b, true);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  set local role gold_app;
  perform set_config('app.user_id', u1::text, true);
  perform gold.open_day(jsonb_build_object('id', gen_random_uuid(), 'branchId', a, 'businessDate', current_date, 'lines', '{"100":50}'::jsonb, 'capturedAt', now()));
  perform set_config('app.user_id', u2::text, true);
  perform gold.open_day(jsonb_build_object('id', gen_random_uuid(), 'branchId', b, 'businessDate', current_date, 'lines', '{"100":5}'::jsonb, 'capturedAt', now()));
  perform set_config('app.user_id', u1::text, true);

  perform gold.post_transaction(jsonb_build_object('id', tx, 'branchId', a, 'customer', jsonb_build_object('name', 'Kwesi'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000',
    'policy', 'down', 'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(), 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb))));
  select array_agg(id) into items from gold.transaction_items where transaction_id = tx;

  -- goods transfer, released, then recalled
  perform gold.create_transfer(jsonb_build_object('id', g, 'kind', 'goods', 'originBranchId', a, 'destinationBranchId', b, 'purpose', 'stock_collection',
    'method', 'staff_travelling', 'itemIds', to_jsonb(items)), array[a]);
  perform gold_test.assert(gold_test.code_of(format('select gold.recall_transfer(%L, ''never left'', array[%L::uuid])', g, a)) = 'TRANSFER_NOT_RELEASED', 'a draft is cancelled, not recalled');
  perform gold.transfer_edit(g, jsonb_build_object('collector', jsonb_build_object('type', 'external', 'name', 'Mr Mensah')), array[a]);
  select goods_value into before_goods from gold.branch_balance(a);
  perform gold.release_transfer(g, '{}'::jsonb, array[a]);
  perform gold_test.assert((select goods_value from gold.branch_balance(a)) = 0, 'gold has left Tarkwa');

  perform gold_test.assert(gold_test.code_of(format('select gold.recall_transfer(%L, ''no'', array[%L::uuid])', g, a)) = 'VALIDATION_FAILED', 'a reason is needed');
  perform gold_test.assert(gold_test.code_of(format('select gold.recall_transfer(%L, ''carrier never arrived'', array[%L::uuid])', g, b)) = 'FORBIDDEN', 'only the sending branch can recall');
  r := gold.recall_transfer(g, 'carrier never arrived', array[a]);
  perform gold_test.assert(r->>'status' = 'cancelled' and (r#>>'{cancellation,reason}') like 'Recalled:%', 'closed as recalled: ' || r::text);
  perform gold_test.assert((select goods_value from gold.branch_balance(a)) = before_goods, 'the gold is back in Tarkwa''s books');
  perform gold_test.assert((select count(*) from gold.transaction_items where id = any(items) and location_state = 'on_hand') = array_length(items, 1), 'items back on the shelf');
  perform gold_test.assert(exists (select 1 from gold.transfer_events where transfer_id = g and event_type = 'recalled'), 'event recorded');
  perform gold_test.assert(jsonb_array_length(gold.transferable_items_json(a)) = array_length(items, 1), 'can be sent again');

  -- a second recall, and a receipt after the recall, are refused
  perform gold_test.assert(gold_test.code_of(format('select gold.recall_transfer(%L, ''again please'', array[%L::uuid])', g, a)) = 'TRANSFER_NOT_IN_TRANSIT', 'cannot recall twice');
  perform set_config('app.user_id', u2::text, true);
  perform gold_test.assert(gold_test.code_of(format('select gold.receive_transfer(%L, ''{}''::jsonb, array[%L::uuid])', g, b)) is not null, 'a recalled transfer cannot be received');
  perform set_config('app.user_id', u1::text, true);

  -- cash transfer recalled
  select cash_value into before_cash from gold.branch_balance(a);
  perform gold.create_transfer(jsonb_build_object('id', c, 'kind', 'cash', 'originBranchId', a, 'destinationBranchId', b, 'purpose', 'restock_funding', 'method', 'staff_travelling',
    'collector', jsonb_build_object('type', 'external', 'name', 'Mr Mensah')), array[a]);
  perform gold.release_transfer(c, jsonb_build_object('lines', '{"100":10}'::jsonb), array[a]);
  perform gold_test.assert((select cash_value from gold.branch_balance(a)) = before_cash - 1000, 'cash left');
  perform gold.recall_transfer(c, 'destination refused it', array[a]);
  perform gold_test.assert((select cash_value from gold.branch_balance(a)) = before_cash, 'cash back, same notes');

  -- received transfers cannot be recalled
  perform gold.create_transfer(jsonb_build_object('id', g2, 'kind', 'goods', 'originBranchId', a, 'destinationBranchId', b, 'purpose', 'stock_collection',
    'method', 'staff_travelling', 'itemIds', to_jsonb(items), 'collector', jsonb_build_object('type', 'external', 'name', 'Mr Mensah')), array[a]);
  perform gold.release_transfer(g2, '{}'::jsonb, array[a]);
  perform set_config('app.user_id', u2::text, true);
  perform gold.receive_transfer(g2, jsonb_build_object('lines', (select jsonb_agg(jsonb_build_object('lineId', id, 'outcome', 'matched')) from gold.transfer_goods_lines where transfer_id = g2)), array[b]);
  perform set_config('app.user_id', u1::text, true);
  perform gold_test.assert(gold_test.code_of(format('select gold.recall_transfer(%L, ''too late now'', array[%L::uuid])', g2, a)) = 'TRANSFER_NOT_IN_TRANSIT', 'received cannot be recalled');

  -- the destination was told
  perform gold_test.assert((select count(*) from gold.notifications where kind = 'transfer_recalled' and user_id = u2) >= 2, 'destination notified');
  raise notice 'transfer recall ok';
end $$;