-- B5: transfers of goods and cash between branches, receipt with per-line confirmation, discrepancies, and the failed mobile money position.
create function gold_test.refuses(p_sql text, p_code text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlerrm like p_code || '|%';
end $$;
grant execute on function gold_test.refuses(text, text) to gold_app;

do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); ksi uuid := gen_random_uuid();
  r_role uuid := gen_random_uuid(); u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid();
  tx uuid := gen_random_uuid(); tx2 uuid := gen_random_uuid(); items uuid[]; trf uuid := gen_random_uuid(); trf2 uuid := gen_random_uuid(); cash_trf uuid := gen_random_uuid();
  r jsonb; bal record; line1 uuid; line2 uuid; pay uuid;
begin
  insert into gold.tenants (id, slug, name) values (t, 'transfers', 'Transfer Gold');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', false), (ksi, t, 'KSI', 'Kumasi', true);
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'teller', 'Teller');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values
    (u1, t, 'ama', 'Ama', 'x', r_role), (u2, t, 'kojo', 'Kojo', 'x', r_role);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  set local role gold_app;
  perform set_config('app.user_id', u1::text, true);

  perform gold.open_day(jsonb_build_object('id', gen_random_uuid(), 'branchId', tkw, 'businessDate', current_date, 'lines', '{"100":50}'::jsonb, 'capturedAt', now()));
  perform set_config('app.user_id', u2::text, true);
  perform gold.open_day(jsonb_build_object('id', gen_random_uuid(), 'branchId', ksi, 'businessDate', current_date, 'lines', '{"100":5}'::jsonb, 'capturedAt', now()));
  perform set_config('app.user_id', u1::text, true);

  -- a purchase of two pieces at Tarkwa (1000 each)
  r := gold.post_transaction(jsonb_build_object('id', tx, 'branchId', tkw, 'customer', jsonb_build_object('name', 'Kwesi'),
    'items', jsonb_build_array(gold_test.item(), gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '2000', 'calculatedAmount', '2000',
    'policy', 'down', 'strategy', 'fewest-notes', 'payable', 2000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(), 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 2000, 'lines', '{"100":20}'::jsonb))));
  select array_agg(id order by line_no) into items from gold.transaction_items where transaction_id = tx;
  perform gold_test.assert(jsonb_array_length(gold.transferable_items_json(tkw)) = 2, 'both pieces can be sent');
  perform gold_test.assert(gold.transferable_items_json(tkw)->0->>'value' = '1000', 'a piece is worth its booked value');

  -- draft: items, collector
  r := gold.create_transfer(jsonb_build_object('id', trf, 'kind', 'goods', 'originBranchId', tkw, 'destinationBranchId', ksi, 'purpose', 'stock_collection',
    'method', 'staff_travelling', 'itemIds', jsonb_build_array(items[1], items[2])), array[tkw]);
  perform gold_test.assert(r->'data'->>'status' = 'draft' and jsonb_array_length(r->'data'->'lines') = 2 and (r->'data'->>'reference') like 'TRF-TKW-%', 'a draft with two lines');
  perform gold_test.assert((gold.create_transfer(jsonb_build_object('id', trf, 'originBranchId', tkw, 'destinationBranchId', ksi), array[tkw])->>'replayed')::boolean,
    'creating twice with the same id is a replay');
  perform gold_test.assert(jsonb_array_length(gold.transferable_items_json(tkw)) = 0, 'items on a draft are not offered again');
  perform gold_test.assert(gold_test.refuses(format('select gold.create_transfer(%L::jsonb, array[%L::uuid])',
    jsonb_build_object('id', gen_random_uuid(), 'originBranchId', ksi, 'destinationBranchId', tkw), tkw), 'FORBIDDEN'), 'cannot start a transfer from a branch you do not work at');
  perform gold_test.assert(gold_test.refuses(format('select gold.release_transfer(%L, ''{}''::jsonb, array[%L::uuid])', trf, tkw), 'COLLECTOR_REQUIRED'), 'no release without a collector');

  r := gold.transfer_edit(trf, jsonb_build_object('collector', jsonb_build_object('type', 'external', 'name', 'Mr Mensah', 'phone', '024', 'idType', 'Ghana card', 'idNumber', 'GHA-1')), array[tkw]);
  perform gold_test.assert(r->'collector'->>'name' = 'Mr Mensah', 'collector set');

  -- release: goods leave Tarkwa
  r := gold.release_transfer(trf, jsonb_build_object('note', 'sealed bag'), array[tkw]);
  perform gold_test.assert(r->>'status' = 'released' and r->'declared'->>'value' = '2000', 'released with frozen totals: ' || r::text);
  select * into bal from gold.branch_balance(tkw);
  perform gold_test.assert(bal.goods_value = 0 and bal.goods_top = 0, 'Tarkwa no longer holds the gold');
  perform gold_test.assert((select count(*) from gold.transaction_items where id = any(items) and location_state = 'in_transit') = 2, 'items are in transit');
  perform gold_test.assert(gold_test.refuses(format('select gold.release_transfer(%L, ''{}''::jsonb, array[%L::uuid])', trf, tkw), 'ALREADY_RELEASED'), 'cannot release twice');
  perform gold_test.assert(gold_test.refuses(format('select gold.cancel_transfer(%L, ''changed my mind'', array[%L::uuid])', trf, tkw), 'TRANSFER_LOCKED'), 'a released transfer cannot be cancelled');

  -- paying the collector 50 cash
  r := gold.record_transfer_payment(trf, jsonb_build_object('branchId', tkw, 'direction', 'paid_to_collector', 'amount', 50, 'method', 'cash',
        'purpose', 'Transport', 'lines', '{"50":1}'::jsonb), array[tkw]);
  perform gold_test.assert(jsonb_array_length(r->'payments') = 1 and r->'payments'->0->'lines' = '{"50":1}'::jsonb, 'payment recorded with its notes');
  perform gold_test.assert(gold_test.refuses(format('select gold.record_transfer_payment(%L, %L::jsonb, array[%L::uuid])', trf,
    jsonb_build_object('branchId', tkw, 'direction', 'paid_to_collector', 'amount', 50, 'method', 'cash', 'purpose', 'x', 'lines', '{"100":1}'::jsonb), tkw), 'PAYOUT_MISMATCH'),
    'payment notes must add up');

  -- receive at Kumasi: wrong branch refused, then line 1 matches, line 2 comes lighter
  select id into line1 from gold.transfer_goods_lines where transfer_id = trf and line_no = 1;
  select id into line2 from gold.transfer_goods_lines where transfer_id = trf and line_no = 2;
  perform gold_test.assert(gold_test.refuses(format('select gold.receive_transfer(%L, ''{}''::jsonb, array[%L::uuid])', trf, tkw), 'FORBIDDEN'), 'the sender cannot receive');
  perform set_config('app.user_id', u2::text, true);
  perform gold_test.assert(gold_test.refuses(format('select gold.receive_transfer(%L, %L::jsonb, array[%L::uuid])', trf,
    jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('lineId', line1, 'outcome', 'matched'))), ksi), 'LINES_MISSING'), 'every line must be confirmed');
  perform gold_test.assert(gold_test.refuses(format('select gold.receive_transfer(%L, %L::jsonb, array[%L::uuid])', trf,
    jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('lineId', line1, 'outcome', 'matched'),
                                                  jsonb_build_object('lineId', line2, 'outcome', 'differs', 'top', '7.00', 'down', '0.41'))), ksi), 'EXPLANATION_REQUIRED'),
    'a difference needs an explanation');
  r := gold.receive_transfer(trf, jsonb_build_object('note', 'bag opened with Ama on video', 'lines', jsonb_build_array(
        jsonb_build_object('lineId', line1, 'outcome', 'matched'),
        jsonb_build_object('lineId', line2, 'outcome', 'differs', 'top', '7.00', 'down', '0.41', 'note', 'Weighed 7.00 on our scale'))), array[ksi]);
  perform gold_test.assert(r->>'status' = 'received_with_discrepancy', 'received with a discrepancy: ' || r::text);
  perform gold_test.assert(r->'receipt'->>'top' = '14.77' and jsonb_array_length(r->'discrepancies') = 1, 'receipt totals and one case');
  select * into bal from gold.branch_balance(ksi);
  perform gold_test.assert(bal.goods_top = 14.77 and bal.goods_value > 1900 and bal.goods_value < 2000, 'Kumasi books the goods it received: ' || bal.goods_value);
  perform gold_test.assert((select count(*) from gold.transaction_items where id = any(items) and location_branch_id = ksi and location_state = 'on_hand') = 2, 'both items now sit at Kumasi');
  perform gold_test.assert((select count(*) from gold.discrepancies where transfer_id = trf and kind = 'transfer_receipt' and asset = 'goods_top' and difference = -0.77) = 1,
    'the lighter piece opened a case for the 0.77 difference');
  perform gold_test.assert(gold_test.refuses(format('select gold.receive_transfer(%L, ''{}''::jsonb, array[%L::uuid])', trf, ksi), 'NOT_IN_TRANSIT'), 'cannot receive twice');
  perform gold_test.assert(jsonb_array_length(gold.transfers_json(ksi, null, 'incoming')) = 1 and jsonb_array_length(gold.transfers_json(ksi, null, 'outgoing')) = 0, 'lists by direction');
  perform gold_test.assert((select count(*) from gold.transfer_events where transfer_id = trf and event_type in ('created', 'goods_added', 'collector_set', 'released', 'payment_recorded', 'discrepancy_flagged', 'received')) >= 8,
    'the timeline records every step');

  -- a missing piece: send one more from Kumasi stock back? use a second purchase at Tarkwa and mark it missing
  perform set_config('app.user_id', u1::text, true);
  r := gold.post_transaction(jsonb_build_object('id', tx2, 'branchId', tkw, 'customer', jsonb_build_object('name', 'Esi'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000',
    'policy', 'down', 'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(), 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb))));
  r := gold.create_transfer(jsonb_build_object('id', trf2, 'kind', 'goods', 'originBranchId', tkw, 'destinationBranchId', ksi, 'purpose', 'stock_collection', 'method', 'staff_travelling',
    'itemIds', jsonb_build_array((select id from gold.transaction_items where transaction_id = tx2)),
    'collector', jsonb_build_object('type', 'staff', 'userId', u1)), array[tkw]);
  perform gold.release_transfer(trf2, '{}'::jsonb, array[tkw]);
  select id into line1 from gold.transfer_goods_lines where transfer_id = trf2;
  perform set_config('app.user_id', u2::text, true);
  perform gold_test.assert(gold_test.refuses(format('select gold.receive_transfer(%L, %L::jsonb, array[%L::uuid])', trf2,
    jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('lineId', line1, 'outcome', 'missing'))), ksi), 'EXPLANATION_REQUIRED'), 'missing needs an explanation');
  r := gold.receive_transfer(trf2, jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('lineId', line1, 'outcome', 'missing', 'note', 'Not in the bag'))), array[ksi]);
  perform gold_test.assert(r->>'status' = 'received_with_discrepancy' and r->'receipt'->>'value' = '0', 'nothing was booked at Kumasi for the missing piece');
  perform gold_test.assert((select location_state from gold.transaction_items where transaction_id = tx2) = 'in_transit', 'the missing piece stays in transit until a manager settles it');

  -- cash: Tarkwa sends 1000, Kumasi counts 900
  perform set_config('app.user_id', u1::text, true);
  r := gold.create_transfer(jsonb_build_object('id', cash_trf, 'kind', 'cash', 'originBranchId', tkw, 'destinationBranchId', ksi, 'purpose', 'restock_funding', 'method', 'staff_travelling',
    'collector', jsonb_build_object('type', 'staff', 'userId', u1)), array[tkw]);
  perform gold_test.assert(gold_test.refuses(format('select gold.release_transfer(%L, ''{}''::jsonb, array[%L::uuid])', cash_trf, tkw), 'VALIDATION_FAILED'), 'cash release needs notes');
  r := gold.release_transfer(cash_trf, jsonb_build_object('lines', '{"100":10}'::jsonb), array[tkw]);
  perform gold_test.assert(r->'declared'->>'cash' = '1000', 'cash declared');
  perform set_config('app.user_id', u2::text, true);
  perform gold_test.assert(gold_test.refuses(format('select gold.receive_transfer(%L, %L::jsonb, array[%L::uuid])', cash_trf, '{"lines":{"100":9}}', ksi), 'EXPLANATION_REQUIRED'), 'a short count needs an explanation');
  r := gold.receive_transfer(cash_trf, '{"lines":{"100":9},"note":"One envelope short"}'::jsonb, array[ksi]);
  perform gold_test.assert(r->>'status' = 'received_with_discrepancy' and r->'receipt'->>'cash' = '900', 'cash counted 900');
  perform gold_test.assert((select count(*) from gold.discrepancies where transfer_id = cash_trf and asset = 'cash' and difference = -100) = 1, 'a cash case for the 100');

  -- a draft can be cancelled
  r := gold.create_transfer(jsonb_build_object('id', gen_random_uuid(), 'kind', 'cash', 'originBranchId', ksi, 'destinationBranchId', tkw), array[ksi]);
  r := gold.cancel_transfer((r->'data'->>'id')::uuid, 'Plans changed', array[ksi]);
  perform gold_test.assert(r->>'status' = 'cancelled', 'a draft can be cancelled');

  -- failed mobile money shows up beside the other between-branch figures
  perform set_config('app.user_id', u1::text, true);
  declare tx3 uuid := gen_random_uuid(); mm uuid;
  begin
    r := gold.post_transaction(jsonb_build_object('id', tx3, 'branchId', tkw, 'customer', jsonb_build_object('name', 'Yaw'),
      'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
      'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(), 'flags', '[]'::jsonb,
      'payments', jsonb_build_array(jsonb_build_object('method', 'mobile_money', 'amount', 1000, 'paidByBranchId', ksi, 'externalRef', 'MM1'))));
    mm := (r->'data'->'payments'->0->>'id')::uuid;
    perform gold.resolve_payment(mm, 'failed', array[ksi], jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb)));
    perform gold_test.assert((select mobile_money_failed_covered_by_cash from gold.v_interbranch_position where sender_branch_id = ksi and receiver_branch_id = tkw) = 1000,
      'Kumasi has 1000 of failed mobile money the purchase branch covered');
  end;
  reset role;
  raise notice 'transfers: all assertions passed';
end $$;