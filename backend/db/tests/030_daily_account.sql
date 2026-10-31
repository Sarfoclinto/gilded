-- The daily account: what the tellers write on the A4 sheet, built from the closed day.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); ksi uuid := gen_random_uuid(); r_role uuid := gen_random_uuid(); u uuid := gen_random_uuid();
  d1 uuid := gen_random_uuid(); d2 uuid := gen_random_uuid(); kofi uuid; r jsonb; a jsonb; v_failed boolean := false;
  conf jsonb := jsonb_build_object('accepted', true, 'version', 'v3', 'text', 'I confirm that I have physically verified everything reported.');
  h30 timestamptz := now() - interval '30 hours';
begin
  insert into gold.tenants (id, slug, name) values (t, 'account', 'Account Gold');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main, timezone) values (tkw, t, 'TKW', 'Tarkwa', false, 'Africa/Accra'), (ksi, t, 'KSI', 'Kumasi', true, 'Africa/Accra');
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'teller', 'Teller');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u, t, 'ama', 'Ama Teller', 'x', r_role);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  set local role gold_app;
  perform set_config('app.user_id', u::text, true);

  -- day 1: 300 hundreds and 50 twenties; a purchase paid in cash, a loan, the office allowance for 3 people
  perform gold.open_day(jsonb_build_object('id', d1, 'branchId', tkw, 'businessDate', current_date - 1, 'lines', '{"100":300,"20":50}'::jsonb, 'capturedAt', h30));
  perform gold.post_transaction(jsonb_build_object('id', gen_random_uuid(), 'branchId', tkw, 'customer', jsonb_build_object('name', 'Kwesi'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', h30 + interval '10 minutes', 'priceAsOf', h30, 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb))));
  perform gold.issue_loan(jsonb_build_object('id', gen_random_uuid(), 'branchId', tkw, 'principal', 500, 'customer', jsonb_build_object('name', 'Kofi', 'phone', '0200000001'),
    'lines', '{"100":5}'::jsonb, 'reason', 'fees', 'capturedAt', h30 + interval '20 minutes'));
  perform gold.record_movement(jsonb_build_object('id', gen_random_uuid(), 'dayId', d1, 'branchId', tkw, 'kind', 'allowance', 'people', 3, 'lines', '{"100":3}'::jsonb, 'capturedAt', h30 + interval '30 minutes'));
  perform gold_test.assert((select note from gold.drawer_movements where kind = 'allowance') = 'Office allowance for 3 people', 'allowance writes its own note');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.record_movement(%L::jsonb)$f$, jsonb_build_object('id', gen_random_uuid(), 'dayId', d1, 'branchId', tkw,
    'kind', 'allowance', 'lines', '{"100":3}'::jsonb, 'capturedAt', h30 + interval '31 minutes'))) = 'VALIDATION_FAILED', 'allowance needs the number of people');
  -- 300 - 10 - 5 - 3 = 282 hundreds
  perform gold.close_day(jsonb_build_object('id', gen_random_uuid(), 'dayId', d1, 'branchId', tkw, 'capturedAt', h30 + interval '1 hour', 'confirmation', conf,
    'declared', jsonb_build_object('cash', '{"100":282,"20":50}'::jsonb, 'goodsTop', '7.77', 'goodsDown', '0.41', 'goodsValue', '1000', 'debt', '500', 'payable', '0', 'custodyTop', '0')));

  a := gold.daily_accounts_json(array[tkw], null, current_date - 1)#>'{branches,0}';
  perform gold_test.assert(a->>'status' = 'closed', 'closed: ' || a::text);
  perform gold_test.assert(a#>>'{cash,bundlesTotal}' = '20000' and a#>>'{cash,looseTotal}' = '9200' and a#>>'{cash,total}' = '29200', 'cash split in bundles and loose: ' || (a->'cash')::text);
  perform gold_test.assert(a#>>'{cash,bundles,0,denomination}' = '100' and a#>>'{cash,bundles,0,count}' = '200' and a#>>'{cash,loose,0,count}' = '82', 'by note');
  perform gold_test.assert(a->>'debtTotal' = '500' and jsonb_array_length(a->'debtors') = 1 and a#>>'{debtors,0,name}' = 'Kofi' and a#>>'{debtors,0,change}' is null, 'debtors');
  perform gold_test.assert(a#>>'{goods,total}' = '1000' and jsonb_array_length(a#>'{goods,days}') = 1 and a#>>'{goods,broughtForward}' = '0', 'goods by day');
  perform gold_test.assert(a#>>'{allowance,paid}' = '300' and a#>>'{allowance,people}' = '3', 'allowance');
  perform gold_test.assert(a->>'closing' = '30700' and a->'previous' = 'null'::jsonb, 'closing balance = cash + debts + goods: ' || (a->>'closing'));

  -- day 2: another loan, part of Kofi's repaid
  perform gold.open_day(jsonb_build_object('id', d2, 'branchId', tkw, 'businessDate', current_date, 'lines', '{"100":282,"20":50}'::jsonb, 'capturedAt', now() - interval '5 hours'));
  perform gold.issue_loan(jsonb_build_object('id', gen_random_uuid(), 'branchId', tkw, 'principal', 100, 'customer', jsonb_build_object('name', 'Justice', 'phone', '0200000002'),
    'lines', '{"100":1}'::jsonb, 'reason', 'fees', 'capturedAt', now() - interval '4 hours'));
  select id into kofi from gold.debts where party_name = 'Kofi';
  perform gold.repay_debt(jsonb_build_object('id', gen_random_uuid(), 'debtId', kofi, 'amount', 200, 'method', 'cash', 'lines', '{"100":2}'::jsonb, 'capturedAt', now() - interval '4 hours'));
  perform gold.close_day(jsonb_build_object('id', gen_random_uuid(), 'dayId', d2, 'branchId', tkw, 'capturedAt', now() - interval '3 hours', 'confirmation', conf,
    'declared', jsonb_build_object('cash', '{"100":283,"20":50}'::jsonb, 'goodsTop', '7.77', 'goodsDown', '0.41', 'goodsValue', '1000', 'debt', '400', 'payable', '0', 'custodyTop', '0')));
  a := gold.daily_accounts_json(array[tkw], null, current_date)#>'{branches,0}';
  perform gold_test.assert(a->>'debtTotal' = '400' and jsonb_array_length(a->'debtors') = 2, 'two debtors: ' || (a->'debtors')::text);
  perform gold_test.assert((select r2->>'change' from jsonb_array_elements(a->'debtors') r2 where r2->>'name' = 'Kofi') = '-200', 'Kofi repaid 200');
  perform gold_test.assert((select (r2->>'isNew')::boolean from jsonb_array_elements(a->'debtors') r2 where r2->>'name' = 'Justice'), 'Justice is new');
  perform gold_test.assert(a->>'closing' = '30700' and a#>>'{previous,closing}' = '30700' and a->>'change' = '0' and a#>>'{allowance,paid}' = '0', 'the balance carried: ' || a::text);

  -- a date with no closed day, and branches the caller may not see
  perform gold_test.assert(gold.daily_accounts_json(array[tkw], null, current_date - 20)#>>'{branches,0,status}' = 'none', 'no day');
  begin perform gold.daily_accounts_json(array[tkw], ksi, current_date); exception when others then v_failed := true; end;
  perform gold_test.assert(v_failed, 'another branch is refused');
  perform gold_test.assert(jsonb_array_length(gold.daily_accounts_json(array[tkw, ksi], null, current_date)->'branches') = 2, 'all branches in scope');
end $$;