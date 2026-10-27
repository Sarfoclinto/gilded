do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); r_role uuid := gen_random_uuid(); u uuid := gen_random_uuid(); r jsonb; n int;
begin
  insert into gold.tenants (id, slug, name) values (t, 'exp', 'Export Gold');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', true);
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'teller', 'Teller');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u, t, 'ama', 'Ama', 'x', r_role);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  set local role gold_app;
  perform set_config('app.user_id', u::text, true);
  perform gold.open_day(jsonb_build_object('id', gen_random_uuid(), 'branchId', tkw, 'businessDate', current_date, 'lines', '{"100":50}'::jsonb, 'capturedAt', now()));
  perform gold.post_transaction(jsonb_build_object('id', gen_random_uuid(), 'branchId', tkw, 'customer', jsonb_build_object('name', 'Kofi', 'phone', '0241'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(), 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 600, 'lines', '{"100":6}'::jsonb), jsonb_build_object('method', 'owed', 'amount', 400))));
  perform gold.import_history(jsonb_build_object('batchId', gen_random_uuid(), 'rows', jsonb_build_array(jsonb_build_object('key', '2', 'branchId', tkw,
    'capturedAt', '2026-03-02T10:00:00Z', 'customer', jsonb_build_object('name', 'Ama', 'phone', null), 'items', jsonb_build_array(gold_test.item()),
    'formulaVersion', 'ExcelV1', 'calculatedAmount', '1000', 'clientAmount', '1000', 'payable', '1000', 'receiptNo', 'R-1'))), array[tkw]);

  r := gold.transactions_export_json(tkw, null, null, null);
  perform gold_test.assert(jsonb_array_length(r->'rows') = 2 and not (r->>'truncated')::boolean, 'both rows: ' || r::text);
  perform gold_test.assert(r#>>'{rows,0,customerName}' = 'Ama' and (r#>>'{rows,0,imported}')::boolean and r#>>'{rows,0,receiptNo}' = 'R-1', 'oldest first, imported marked');
  perform gold_test.assert(r#>>'{rows,1,cash}' = '600' and r#>>'{rows,1,owed}' = '400' and r#>>'{rows,1,pieces}' = '1' and r#>>'{rows,1,createdBy}' = 'Ama', 'payment split: ' || (r->'rows'->1)::text);
  r := gold.transactions_export_json(tkw, '2026-03-01', '2026-03-31', null);
  perform gold_test.assert(jsonb_array_length(r->'rows') = 1, 'date range');
  r := gold.transactions_export_json(tkw, null, null, 1);
  perform gold_test.assert(jsonb_array_length(r->'rows') = 1 and (r->>'truncated')::boolean, 'truncated flag');
end $$;