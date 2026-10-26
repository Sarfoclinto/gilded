-- "This day only": one day's movements apart from the running totals.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); r_role uuid := gen_random_uuid(); u uuid := gen_random_uuid();
  day1 uuid := gen_random_uuid(); loan uuid := gen_random_uuid(); r jsonb; a jsonb;
begin
  insert into gold.tenants (id, slug, name) values (t, 'activity', 'Activity Gold');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', true);
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'teller', 'Teller');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u, t, 'ama', 'Ama', 'x', r_role);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  set local role gold_app;
  perform set_config('app.user_id', u::text, true);
  perform gold.open_day(jsonb_build_object('id', day1, 'branchId', tkw, 'businessDate', current_date, 'lines', '{"100":50}'::jsonb, 'capturedAt', now()));

  r := gold.post_transaction(jsonb_build_object('id', gen_random_uuid(), 'branchId', tkw, 'customer', jsonb_build_object('name', 'Kofi Boateng', 'phone', '0241'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(), 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb))));
  perform gold.issue_loan(jsonb_build_object('id', loan, 'branchId', tkw, 'principal', 300, 'customer', jsonb_build_object('name', 'Ama B', 'phone', '0200000002'),
    'lines', '{"100":3}'::jsonb, 'capturedAt', now()));
  perform gold.repay_debt(jsonb_build_object('id', gen_random_uuid(), 'debtId', loan, 'amount', 100, 'method', 'cash', 'lines', '{"100":1}'::jsonb, 'capturedAt', now()));

  a := gold.day_activity_json(day1);
  perform gold_test.assert(a#>>'{cash,opening,100}' = '50', 'opened with 50 x 100: ' || a::text);
  perform gold_test.assert(a#>>'{cash,out,100}' = '13' and a#>>'{cash,in,100}' = '1', 'cash out 10 + 3, in 1: ' || (a->'cash')::text);
  perform gold_test.assert(a#>>'{cash,net,100}' = '-12' and (a#>>'{cash,netValue}')::numeric = -1200, 'net -12 notes');
  perform gold_test.assert((a#>>'{goods,value}')::numeric > 0 and (a#>>'{goods,top}')::numeric > 0, 'goods bought today');
  perform gold_test.assert((a#>>'{debts,net}')::numeric = 200, 'debts rose by 200');
  perform gold_test.assert(jsonb_array_length(a#>'{debts,debtors}') = 1 and a#>>'{debts,debtors,0,name}' = 'Ama B'
    and (a#>>'{debts,debtors,0,issued}')::numeric = 300 and (a#>>'{debts,debtors,0,repaid}')::numeric = 100 and (a#>>'{debts,debtors,0,net}')::numeric = 200,
    'debtor shown with issued, repaid, net: ' || (a#>'{debts}')::text);
  perform gold_test.assert(gold_test.refuses(format($f$select gold.day_activity_json(%L)$f$, gen_random_uuid()), 'NOT_FOUND'), 'unknown day');
  raise notice 'ok 011';
end $$;