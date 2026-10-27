-- Opening gold and debts on the day a branch goes live.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); ksi uuid := gen_random_uuid();
  r_role uuid := gen_random_uuid(); u uuid := gen_random_uuid(); b1 uuid := gen_random_uuid(); b2 uuid := gen_random_uuid(); b3 uuid := gen_random_uuid();
  r jsonb; rows jsonb; bal record; debt uuid;
begin
  insert into gold.tenants (id, slug, name) values (t, 'open', 'Opening Gold');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', false), (ksi, t, 'KSI', 'Kumasi', true);
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'teller', 'Teller');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u, t, 'ama', 'Ama', 'x', r_role);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  set local role gold_app;
  perform set_config('app.user_id', u::text, true);

  rows := jsonb_build_array(
    jsonb_build_object('kind', 'goods', 'branchId', tkw, 'top', '120.5', 'down', '6.2', 'value', '95000'),
    jsonb_build_object('kind', 'debt', 'branchId', tkw, 'partyName', 'Kofi Boateng', 'phone', '0241000001', 'amount', '2500', 'reason', 'Old loan'),
    jsonb_build_object('kind', 'debt', 'branchId', tkw, 'partyName', 'Ama Teller', 'partyType', 'staff', 'amount', '500'));
  r := gold.import_opening(jsonb_build_object('batchId', b1, 'label', 'Go live', 'asOf', '2026-10-01T08:00:00Z', 'rows', rows), array[tkw, ksi]);
  perform gold_test.assert((r->>'goods')::int = 1 and (r->>'debts')::int = 2 and not (r->>'alreadyApplied')::boolean, 'applied: ' || r::text);

  select * into bal from gold.branch_balance(tkw);
  perform gold_test.assert(bal.goods_top = 120.5 and bal.goods_value = 95000 and bal.debt_value = 3000 and bal.cash_value = 0, 'balances: ' || row_to_json(bal)::text);

  -- same batch again: nothing changes
  r := gold.import_opening(jsonb_build_object('batchId', b1, 'asOf', '2026-10-01T08:00:00Z', 'rows', rows), array[tkw, ksi]);
  perform gold_test.assert((r->>'alreadyApplied')::boolean, 'resend recognised');
  select * into bal from gold.branch_balance(tkw);
  perform gold_test.assert(bal.goods_value = 95000, 'no double count');

  -- gold can be set once per branch
  perform gold_test.assert(gold_test.refuses(format('select gold.import_opening(%L::jsonb, array[%L::uuid])',
    jsonb_build_object('batchId', gen_random_uuid(), 'asOf', '2026-10-01T08:00:00Z', 'rows', jsonb_build_array(rows->0))::text, tkw), 'ALREADY_SET'), 'second opening gold refused');
  -- validation and scope
  perform gold_test.assert(gold_test.refuses(format('select gold.import_opening(%L::jsonb, array[%L::uuid])',
    jsonb_build_object('batchId', gen_random_uuid(), 'asOf', '2026-10-01T08:00:00Z', 'rows', jsonb_build_array(rows->0)  )::text, ksi), 'FORBIDDEN'), 'branch outside scope');
  perform gold_test.assert(gold_test.refuses(format('select gold.import_opening(%L::jsonb, array[%L::uuid])',
    jsonb_build_object('batchId', gen_random_uuid(), 'asOf', '2999-01-01T00:00:00Z', 'rows', jsonb_build_array(rows->1))::text, tkw), 'VALIDATION_FAILED'), 'future date');
  perform gold_test.assert(gold_test.refuses(format('select gold.import_opening(%L::jsonb, array[%L::uuid])',
    jsonb_build_object('batchId', gen_random_uuid(), 'asOf', '2026-10-01T08:00:00Z', 'rows', jsonb_build_array(jsonb_build_object('kind', 'debt', 'branchId', tkw, 'partyName', 'No Phone', 'amount', '10')))::text, tkw), 'CUSTOMER_REQUIRED'), 'customer needs a phone');
  select * into bal from gold.branch_balance(tkw);
  perform gold_test.assert(bal.debt_value = 3000, 'a refused batch leaves nothing behind');

  -- listed with its kind
  r := gold.import_batches_json(array[tkw]);
  perform gold_test.assert(r->0->>'kind' = 'opening' and (r->0->>'purchases')::int = 3, 'listed: ' || r::text);

  -- a debt from the import is repaid like any other, which blocks undoing the import
  select id into debt from gold.debts where party_name = 'Kofi Boateng';
  perform gold_test.assert(debt is not null, 'debt exists');
  perform gold.open_day(jsonb_build_object('id', gen_random_uuid(), 'branchId', tkw, 'businessDate', current_date, 'lines', '{"100":50}'::jsonb, 'capturedAt', now()));
  perform gold.repay_debt(jsonb_build_object('id', gen_random_uuid(), 'debtId', debt, 'amount', 100, 'lines', '{"100":1}'::jsonb, 'receivedAt', now()));
  perform gold_test.assert(gold_test.refuses(format('select gold.import_undo(%L, %L, array[%L::uuid])', b1, 'Wrong numbers', tkw), 'ALREADY_IN_USE'), 'repaid debt blocks undo');

  -- a batch nobody has used can be undone, and the gold can then be set again
  rows := jsonb_build_array(jsonb_build_object('kind', 'goods', 'branchId', ksi, 'top', '10', 'down', '1', 'value', '5000'),
                            jsonb_build_object('kind', 'debt', 'branchId', ksi, 'partyName', 'Yaw', 'phone', '0242', 'amount', '400'));
  perform gold.import_opening(jsonb_build_object('batchId', b2, 'asOf', '2026-10-01T08:00:00Z', 'rows', rows), array[tkw, ksi]);
  select * into bal from gold.branch_balance(ksi);
  perform gold_test.assert(bal.goods_value = 5000 and bal.debt_value = 400, 'kumasi set');
  r := gold.import_undo(b2, 'Entered the wrong sheet', array[tkw, ksi]);
  select * into bal from gold.branch_balance(ksi);
  perform gold_test.assert(bal.goods_value = 0 and bal.debt_value = 0 and bal.goods_top = 0, 'reversed to nothing');
  perform gold_test.assert((select status from gold.debts where party_name = 'Yaw') = 'written_off', 'debt written off');
  perform gold.import_opening(jsonb_build_object('batchId', b3, 'asOf', '2026-10-01T08:00:00Z', 'rows', jsonb_build_array(rows->0)), array[tkw, ksi]);
  select * into bal from gold.branch_balance(ksi);
  perform gold_test.assert(bal.goods_value = 5000, 'can be set again after undo');
end $$;