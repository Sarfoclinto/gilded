-- Past purchases and customers imported from spreadsheets.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); ksi uuid := gen_random_uuid();
  r_role uuid := gen_random_uuid(); u uuid := gen_random_uuid(); b1 uuid := gen_random_uuid(); b2 uuid := gen_random_uuid();
  r jsonb; rows jsonb; n int; cash_before numeric; cash_after numeric;
begin
  insert into gold.tenants (id, slug, name) values (t, 'imp', 'Import Gold');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', false), (ksi, t, 'KSI', 'Kumasi', true);
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'teller', 'Teller');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u, t, 'ama', 'Ama', 'x', r_role);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  set local role gold_app;
  perform set_config('app.user_id', u::text, true);

  rows := jsonb_build_array(
    jsonb_build_object('key', '2', 'branchId', tkw, 'capturedAt', '2026-03-02T10:15:00Z', 'customer', jsonb_build_object('name', 'Kofi Boateng', 'phone', '024 100 0001'),
      'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'calculatedAmount', '1000', 'clientAmount', '1000', 'payable', '1000', 'receiptNo', 'R-17'),
    jsonb_build_object('key', '3', 'branchId', tkw, 'capturedAt', '2026-03-02T14:00:00Z', 'customer', jsonb_build_object('name', 'Ama Serwaa', 'phone', null),
      'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'calculatedAmount', '1000', 'clientAmount', '990', 'payable', '990',
      'flags', jsonb_build_array('CALC_MISMATCH')));
  r := gold.import_history(jsonb_build_object('batchId', b1, 'label', 'March', 'rows', rows), array[tkw, ksi]);
  perform gold_test.assert((r->>'created')::int = 2 and (r->>'skipped')::int = 0, 'two purchases created: ' || r::text);
  perform gold_test.assert(r#>>'{rows,0,reference}' like 'TKW-H20260302-%', 'historical reference: ' || r::text);

  -- resending the batch changes nothing
  r := gold.import_history(jsonb_build_object('batchId', b1, 'rows', rows), array[tkw, ksi]);
  perform gold_test.assert((r->>'created')::int = 0 and (r->>'skipped')::int = 2, 'resend is skipped: ' || r::text);

  -- records only: no payments, no ledger, gold marked historical, flagged
  select count(*) into n from gold.transactions where imported_batch = b1;
  perform gold_test.assert(n = 2, 'two rows stored');
  select count(*) into n from gold.transaction_items where location_state = 'historical';
  perform gold_test.assert(n = 2, 'items are historical');
  perform gold_test.assert((select count(*) from gold.transactions where imported_batch = b1 and 'HISTORICAL' = any(flags)) = 2, 'flagged');
  perform gold_test.assert((select payout_difference from gold.transactions where import_key = '3') = -10, 'difference is paid minus calculated');
  perform gold_test.assert((select count(*) from gold.customers) = 1, 'only customers with a phone are created');

  -- the branch list shows them, newest first by date
  r := gold.transactions_json(tkw, 50);
  perform gold_test.assert(jsonb_array_length(r) = 2 and r->0->>'customerName' = 'Ama Serwaa', 'listed by captured time: ' || r::text);
  perform gold_test.assert(jsonb_array_length(gold.import_batches_json(array[tkw])) = 1, 'batch listed');
  perform gold_test.assert((gold.import_batches_json(array[tkw])->0->>'purchases')::int = 2, 'batch counts purchases');
  perform gold_test.assert(jsonb_array_length(gold.import_batches_json(array[ksi])) = 0, 'a batch of another branch is not shown');

  -- refusals
  perform gold_test.assert(gold_test.refuses(format('select gold.import_history(%L::jsonb, array[%L::uuid])',
    jsonb_build_object('batchId', gen_random_uuid(), 'rows', rows)::text, ksi), 'FORBIDDEN'), 'branch outside scope');
  perform gold_test.assert(gold_test.refuses(format('select gold.import_history(%L::jsonb, array[%L::uuid])',
    jsonb_build_object('batchId', gen_random_uuid(), 'rows', jsonb_build_array(jsonb_set(rows->0, '{capturedAt}', '"2999-01-01T00:00:00Z"'))), tkw), 'VALIDATION_FAILED'), 'future date');
  perform gold_test.assert(gold_test.refuses(format('select gold.import_history(%L::jsonb, array[%L::uuid])',
    jsonb_build_object('batchId', gen_random_uuid(), 'rows', jsonb_build_array(jsonb_set(rows->0, '{customer,name}', '""'))), tkw), 'VALIDATION_FAILED'), 'no name');

  -- undo voids the batch and closes it
  perform gold_test.assert(gold_test.refuses(format('select gold.import_undo(%L, %L, array[%L::uuid])', b1, 'x', tkw), 'VALIDATION_FAILED'), 'reason needed');
  r := gold.import_undo(b1, 'Wrong sheet used', array[tkw]);
  perform gold_test.assert((r->>'voided')::int = 2, 'voided');
  perform gold_test.assert(gold_test.refuses(format('select gold.import_history(%L::jsonb, array[%L::uuid])',
    jsonb_build_object('batchId', b1, 'rows', rows)::text, tkw), 'BATCH_CLOSED'), 'closed batch refuses');
  perform gold_test.assert(gold_test.refuses(format('select gold.import_undo(%L, %L, array[%L::uuid])', b1, 'Again please', tkw), 'ALREADY_UNDONE'), 'once only');

  -- customers
  r := gold.import_customers(jsonb_build_object('rows', jsonb_build_array(
    jsonb_build_object('name', 'Kofi Boateng', 'phone', '0241000001'),
    jsonb_build_object('name', 'Yaw Owusu', 'phone', '0242000002', 'notes', 'regular'))));
  perform gold_test.assert((r->>'created')::int = 1 and (r->>'existing')::int = 1, 'customers: ' || r::text);
  perform gold_test.assert(gold_test.refuses(format('select gold.import_customers(%L::jsonb)', jsonb_build_object('rows', jsonb_build_array(jsonb_build_object('name', 'No Phone')))::text), 'VALIDATION_FAILED'), 'phone needed');
end $$;