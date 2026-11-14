-- B57: the sender's scale reading is recorded beside the books, graded, and a big gap tells the reviewers.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); ksi uuid := gen_random_uuid();
  r_m uuid := gen_random_uuid(); r_t uuid := gen_random_uuid(); mgr uuid := gen_random_uuid(); teller uuid := gen_random_uuid();
  tx uuid := gen_random_uuid(); items uuid[]; trf1 uuid := gen_random_uuid(); trf2 uuid := gen_random_uuid(); trf3 uuid := gen_random_uuid(); trf4 uuid := gen_random_uuid();
  r jsonb; x text; n int;
begin
  insert into gold.tenants (id, slug, name) values (t, 'scaled57', 'Scaled Gold');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', false), (ksi, t, 'KSI', 'Kumasi', true);
  insert into gold.roles (id, tenant_id, key, name, is_system) values (r_m, t, 'manager', 'Manager', true), (r_t, t, 'teller', 'Teller', true);
  insert into gold.role_permissions (tenant_id, role_id, permission) values (t, r_m, 'discrepancies:review');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (mgr, t, 'mgr', 'Manager', 'x', r_m), (teller, t, 'ama', 'Ama', 'x', r_t);
  insert into gold.user_branches (tenant_id, user_id, branch_id) values (t, mgr, tkw), (t, teller, tkw);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  set local role gold_app;
  perform set_config('app.user_id', teller::text, true);
  perform gold.open_day(jsonb_build_object('id', gen_random_uuid(), 'branchId', tkw, 'businessDate', current_date, 'lines', '{"100":100}'::jsonb, 'capturedAt', now()));

  -- grading rules (2 pieces, books top 15.54 -> down allowance 0.02 + 0.02 + 0.01554 = 0.05554)
  x := gold.scale_check(0, 0, 15.54, 2)->>'level';                perform gold_test.assert(x = 'ok', 'exact is ok: ' || x);
  x := gold.scale_check(0.03, 0, 15.54, 2)->>'topLevel';          perform gold_test.assert(x = 'notice', '0.03 top is yellow: ' || x);
  x := gold.scale_check(-0.1, 0, 15.54, 2)->>'topLevel';          perform gold_test.assert(x = 'notice', '0.10 top (either way) is still yellow: ' || x);
  x := gold.scale_check(0.11, 0, 15.54, 2)->>'topLevel';          perform gold_test.assert(x = 'alert', 'over 0.1 top alerts: ' || x);
  x := gold.scale_check(0.5, 0, 15.54, 2)->>'topLevel';           perform gold_test.assert(x = 'alert', '0.5 top is the last alert: ' || x);
  x := gold.scale_check(0.51, 0, 15.54, 2)->>'level';             perform gold_test.assert(x = 'critical', 'over 0.5 top is critical: ' || x);
  x := gold.scale_check(0, 0.02, 15.54, 2)->>'downLevel';         perform gold_test.assert(x = 'ok', 'small down gap on few pieces is ok: ' || x);
  x := gold.scale_check(0, 0.05, 15.54, 2)->>'downLevel';         perform gold_test.assert(x = 'notice', 'near the allowance is yellow: ' || x);
  x := gold.scale_check(0, 0.2, 15.54, 2)->>'downLevel';          perform gold_test.assert(x = 'alert', 'few pieces, 0.2 down is an alert: ' || x);
  x := gold.scale_check(0, 0.2, 400, 60)->>'downLevel';           perform gold_test.assert(x = 'ok' or x = 'notice', 'many pieces tolerate more: ' || x);
  perform gold_test.assert((gold.scale_check(0, 0, 400, 60)->>'downAllowance')::numeric = 0.5, 'allowance never goes above 0.5');
  x := gold.scale_check(0, 0.6, 400, 60)->>'level';               perform gold_test.assert(x = 'critical', 'over 0.5 down is critical even with many pieces: ' || x);

  -- a purchase of two pieces: top 15.54, down 0.82 in the books
  perform gold.post_transaction(jsonb_build_object('id', tx, 'branchId', tkw, 'customer', jsonb_build_object('name', 'Kwesi'),
    'items', jsonb_build_array(gold_test.item(), gold_test.item(), gold_test.item(), gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '4000', 'calculatedAmount', '4000',
    'policy', 'down', 'strategy', 'fewest-notes', 'payable', 4000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(), 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 4000, 'lines', '{"100":40}'::jsonb))));
  select array_agg(id order by line_no) into items from gold.transaction_items where transaction_id = tx;
  perform gold.create_transfer(jsonb_build_object('id', trf1, 'kind', 'goods', 'originBranchId', tkw, 'destinationBranchId', ksi, 'purpose', 'stock_collection', 'method', 'staff_travelling', 'itemIds', jsonb_build_array(items[1])), array[tkw]);
  perform gold.create_transfer(jsonb_build_object('id', trf2, 'kind', 'goods', 'originBranchId', tkw, 'destinationBranchId', ksi, 'purpose', 'stock_collection', 'method', 'staff_travelling', 'itemIds', jsonb_build_array(items[2])), array[tkw]);
  perform gold.create_transfer(jsonb_build_object('id', trf3, 'kind', 'goods', 'originBranchId', tkw, 'destinationBranchId', ksi, 'purpose', 'stock_collection', 'method', 'staff_travelling', 'itemIds', jsonb_build_array(items[3])), array[tkw]);
  perform gold.create_transfer(jsonb_build_object('id', trf4, 'kind', 'goods', 'originBranchId', tkw, 'destinationBranchId', ksi, 'purpose', 'stock_collection', 'method', 'staff_travelling', 'itemIds', jsonb_build_array(items[4])), array[tkw]);
  perform gold.transfer_edit(trf1, jsonb_build_object('collector', jsonb_build_object('type', 'external', 'name', 'Mr Mensah', 'phone', '024', 'idType', 'Ghana card', 'idNumber', 'GHA-1')), array[tkw]);
  perform gold.transfer_edit(trf2, jsonb_build_object('collector', jsonb_build_object('type', 'external', 'name', 'Mr Mensah', 'phone', '024', 'idType', 'Ghana card', 'idNumber', 'GHA-1')), array[tkw]);
  perform gold.transfer_edit(trf3, jsonb_build_object('collector', jsonb_build_object('type', 'external', 'name', 'Mr Mensah', 'phone', '024', 'idType', 'Ghana card', 'idNumber', 'GHA-1')), array[tkw]);
  perform gold.transfer_edit(trf4, jsonb_build_object('collector', jsonb_build_object('type', 'external', 'name', 'Mr Mensah', 'phone', '024', 'idType', 'Ghana card', 'idNumber', 'GHA-1')), array[tkw]);

  -- books for one piece: top 7.77, down 0.41. Half given is refused; letters are refused; nothing changes on refusal.
  x := gold_test.code_of(format($q$select gold.release_transfer(%L, '{"scaledTop":"7.77"}'::jsonb, array[%L::uuid])$q$, trf1, tkw));
  perform gold_test.assert(x = 'VALIDATION_FAILED', 'both weights are needed: ' || x);
  x := gold_test.code_of(format($q$select gold.release_transfer(%L, '{"scaledTop":"abc","scaledDown":"1"}'::jsonb, array[%L::uuid])$q$, trf1, tkw));
  perform gold_test.assert(x = 'VALIDATION_FAILED', 'weights must be numbers: ' || x);
  perform gold_test.assert((select status from gold.transfers where id = trf1) = 'draft', 'a refused release leaves the draft alone');

  -- exact: ok, nobody notified
  r := gold.release_transfer(trf1, jsonb_build_object('scaledTop', '7.77', 'scaledDown', '0.41'), array[tkw]);
  perform gold_test.assert(r->>'status' = 'released' and r->'scaled'->>'level' = 'ok' and r->'scaled'->>'topDifference' = '0', 'exact scale: ok ' || (r->'scaled')::text);
  perform gold_test.assert((select count(*) from gold.notifications where kind = 'transfer_scale_difference') = 0, 'no notice for a match');

  -- 0.05 heavier top: recorded, yellow, still released
  r := gold.release_transfer(trf2, jsonb_build_object('scaledTop', '7.82', 'scaledDown', '0.41'), array[tkw]);
  perform gold_test.assert(r->>'status' = 'released' and r->'scaled'->>'topLevel' = 'notice' and r->'scaled'->>'topDifference' = '0.05' and r->'declared'->>'top' = '7.77',
    'a small gap is recorded and yellow; the books stay as they were: ' || (r->'scaled')::text);

  -- 0.3 lighter top: alert (orange), no notification
  r := gold.release_transfer(trf3, jsonb_build_object('scaledTop', '7.47', 'scaledDown', '0.41'), array[tkw]);
  perform gold_test.assert(r->'scaled'->>'level' = 'alert' and r->'scaled'->>'topDifference' = '-0.3', 'a bigger gap is an alert: ' || (r->'scaled')::text);
  perform gold_test.assert((select count(*) from gold.notifications where kind = 'transfer_scale_difference') = 0, 'an alert alone is not sent to reviewers');

  -- 0.9 heavier top: critical, the reviewer is told, the transfer is still released
  r := gold.release_transfer(trf4, jsonb_build_object('scaledTop', '8.67', 'scaledDown', '0.41'), array[tkw]);
  perform gold_test.assert(r->>'status' = 'released' and r->'scaled'->>'level' = 'critical', 'a big gap is critical but still recorded: ' || (r->'scaled')::text);
  select count(*) into n from gold.notifications where kind = 'transfer_scale_difference' and user_id = mgr;
  perform gold_test.assert(n = 1, 'the reviewer is told about a critical gap');
  perform gold_test.assert((select count(*) from gold.audit_events where action = 'transfer.scaled') = 4, 'every reading is in the audit trail');

  -- a transfer released without a reading (older devices) has no scale block
  perform gold_test.assert((select scaled_top from gold.transfers where id = trf1) = 7.77, 'the reading is stored with the transfer');
  raise notice 'transfer scaled weight ok';
end $$;