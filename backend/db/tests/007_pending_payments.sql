-- B4+: the list of mobile money waiting to be confirmed. Runs as the application login.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); ksi uuid := gen_random_uuid();
  r_role uuid := gen_random_uuid(); u uuid := gen_random_uuid(); tx uuid := gen_random_uuid(); r jsonb; pay uuid;
begin
  insert into gold.tenants (id, slug, name) values (t, 'pending', 'Pending Gold');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', false), (ksi, t, 'KSI', 'Kumasi', true);
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'teller', 'Teller');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u, t, 'ama', 'Ama', 'x', r_role);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  set local role gold_app;
  perform set_config('app.user_id', u::text, true);

  perform gold.open_day(jsonb_build_object('id', gen_random_uuid(), 'branchId', tkw, 'businessDate', current_date, 'lines', '{"100":50}'::jsonb, 'capturedAt', now()));
  r := gold.post_transaction(jsonb_build_object('id', tx, 'branchId', tkw, 'customer', jsonb_build_object('name', 'Kwesi'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(), 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 400, 'lines', '{"100":4}'::jsonb),
                                  jsonb_build_object('method', 'mobile_money', 'amount', 600, 'paidByBranchId', ksi, 'externalRef', 'MM9'))));
  r := gold.pending_payments_json(ksi, 'sending');
  perform gold_test.assert(jsonb_array_length(r) = 1 and r->0->>'amount' = '600' and r->0->>'purchaseBranchName' = 'Tarkwa' and r->0->>'externalRef' = 'MM9',
    'Kumasi sees the 600 it must send: ' || r::text);
  perform gold_test.assert(jsonb_array_length(gold.pending_payments_json(tkw, 'sending')) = 0, 'Tarkwa has nothing to send');
  perform gold_test.assert(jsonb_array_length(gold.pending_payments_json(tkw, 'receiving')) = 1, 'Tarkwa is waiting for 600');
  pay := (r->0->>'paymentId')::uuid;
  perform gold.resolve_payment(pay, 'confirmed', array[ksi], null);
  perform gold_test.assert(jsonb_array_length(gold.pending_payments_json(ksi, 'sending')) = 0 and jsonb_array_length(gold.pending_payments_json(tkw, 'receiving')) = 0,
    'once confirmed it leaves both lists');
  reset role;
  raise notice 'pending payments: all assertions passed';
end $$;