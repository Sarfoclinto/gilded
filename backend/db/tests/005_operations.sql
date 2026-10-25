-- B3: prices, days, drawer, purchases with split payments, gold-for-debt, loans with security, repayments. Runs as the application login.
create function gold_test.code_of(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return split_part(sqlerrm, '|', 1);
end $$;

grant execute on function gold_test.code_of(text) to gold_app;
create function gold_test.item() returns jsonb language sql as $$
  select jsonb_build_object('id', gen_random_uuid(), 'label', 'ring', 'top', '7.77', 'down', '0.41', 'price', '11650', 'density', '18.95',
         'karat', '22.5', 'purity', '0.9375', 'netWeight', '7.28', 'pounds', '1.00', 'amount', '1000')
$$;
grant execute on function gold_test.item() to gold_app;

do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); ksi uuid := gen_random_uuid();
  r_teller uuid := gen_random_uuid(); u_teller uuid := gen_random_uuid(); u_kumasi uuid := gen_random_uuid();
  r jsonb; bal record; n int; d1 uuid := gen_random_uuid(); tx uuid; tx2 uuid; tx3 uuid; tx4 uuid; tx5 uuid; tx6 uuid;
  loan_kofi uuid := gen_random_uuid(); loan_ama uuid := gen_random_uuid(); loan_yaw uuid := gen_random_uuid(); coll uuid; pay uuid;
  item jsonb; v_day uuid; ksi_day uuid := gen_random_uuid(); ksi_day2 uuid := gen_random_uuid(); owed_debt uuid; kofi uuid; ama uuid;
begin
  -- owner sets up the company
  insert into gold.tenants (id, slug, name) values (t, 'ops', 'Ops Gold');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', false), (ksi, t, 'KSI', 'Kumasi', true);
  insert into gold.roles (id, tenant_id, key, name) values (r_teller, t, 'teller', 'Teller');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values
    (u_teller, t, 'ama', 'Ama Teller', 'x', r_teller), (u_kumasi, t, 'kwame', 'Kwame Kumasi', 'x', r_teller);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');

  set local role gold_app;
  perform set_config('app.user_id', u_teller::text, true);

  item := jsonb_build_object('id', gen_random_uuid(), 'label', 'ring', 'top', '7.77', 'down', '0.41', 'price', '11650', 'density', '18.95',
          'karat', '22.5', 'purity', '0.9375', 'netWeight', '7.28', 'pounds', '1.00', 'amount', '1000');

  -- 1. Prices ------------------------------------------------------------
  perform gold.set_base_price(11458, null);
  r := gold.set_margin(tkw, 190, false);
  perform gold_test.assert(r->>'effectivePrice' = '11648' and r->>'status' = 'provisional', 'provisional margin priced: ' || r::text);
  r := gold.set_margin(ksi, 192, true);
  perform gold_test.assert(r->>'status' = 'approved', 'approved margin');
  perform gold.set_base_price(11500, null);
  r := gold.current_price(tkw);
  perform gold_test.assert(r->>'basePrice' = '11500' and r->>'margin' = '190' and r->>'status' = 'provisional', 'a new base price keeps each branch margin and status: ' || r::text);
  perform gold_test.assert(gold.current_price(ksi)->>'effectivePrice' = '11692', 'Kumasi price follows');
  r := gold.approve_margin(tkw);
  perform gold_test.assert(r->>'status' = 'approved', 'approving the margin');
  perform gold_test.assert(gold.current_price(gen_random_uuid()) is null, 'no price for an unknown branch');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.set_margin(%L, 5, false)$f$, gen_random_uuid())) = 'NOT_FOUND', 'margin for an unknown branch');

  -- 2. Opening a day, the drawer ----------------------------------------------
  r := gold.open_day(jsonb_build_object('id', d1, 'branchId', tkw, 'businessDate', current_date, 'lines', '{"100":100,"20":50}'::jsonb, 'source', 'counted', 'capturedAt', now()));
  perform gold_test.assert((r->>'replayed')::boolean = false and r#>>'{data,status}' = 'open', 'day opened: ' || r::text);
  perform gold_test.assert(r#>>'{data,opening,lines,100}' = '100', 'opening lines kept');
  perform gold_test.assert((gold.open_day(jsonb_build_object('id', d1, 'branchId', tkw, 'businessDate', current_date, 'lines', '{}'::jsonb, 'capturedAt', now()))->>'replayed')::boolean,
    'opening again with the same id is a replay');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.open_day(%L::jsonb)$f$, jsonb_build_object('id', gen_random_uuid(), 'branchId', tkw,
    'businessDate', current_date + 1, 'lines', '{"100":1}'::jsonb, 'capturedAt', now()))) = 'DAY_ALREADY_OPEN', 'only one open day');
  select * into bal from gold.branch_balance(tkw);
  perform gold_test.assert(bal.cash_value = 11000, 'go-live balance is the first count: ' || bal.cash_value);
  v_day := d1;

  r := gold.record_movement(jsonb_build_object('id', gen_random_uuid(), 'dayId', d1, 'branchId', tkw, 'kind', 'topup', 'lines', '{"50":10}'::jsonb, 'note', 'restock', 'capturedAt', now()));
  perform gold_test.assert(r#>>'{data,lines,50}' = '10', 'top-up recorded');
  select * into bal from gold.branch_balance(tkw);
  perform gold_test.assert(bal.cash_value = 11500, 'top-up added 500');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.record_movement(%L::jsonb)$f$, jsonb_build_object('id', gen_random_uuid(), 'dayId', d1, 'branchId', tkw,
    'kind', 'withdrawal', 'lines', '{"7":1}'::jsonb, 'note', 'x', 'capturedAt', now()))) = 'BAD_DENOMINATION', 'a 7 cedi note does not exist');
  r := gold.day_state(tkw);
  perform gold_test.assert((r->'balance'->>'100')::int = 100 and jsonb_array_length(r->'movements') = 1, 'day state balance and movements: ' || r::text);
  perform gold_test.assert(r->'appliedIds' @> to_jsonb(d1::text), 'the day command is listed as applied');

  -- 3. A plain cash purchase ----------------------------------------------------
  tx := gen_random_uuid();
  r := gold.post_transaction(jsonb_build_object('id', tx, 'branchId', tkw, 'customer', jsonb_build_object('name', 'Kwesi'), 'items', jsonb_build_array(gold_test.item()),
        'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down', 'strategy', 'fewest-notes', 'payable', 1000,
        'difference', 0, 'capturedAt', now(), 'priceAsOf', now(), 'flags', '[]'::jsonb,
        'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb))));
  perform gold_test.assert(r#>>'{data,reference}' = 'TKW-' || to_char(current_date, 'YYYYMMDD') || '-0001', 'reference number: ' || (r#>>'{data,reference}'));
  perform gold_test.assert(r#>>'{data,payout,lines,100}' = '10' and r#>>'{data,payout,totalNotes}' = '10', 'payout notes shown');
  perform gold_test.assert(r#>>'{data,items,0,result,amount}' = '1000' and r#>>'{data,items,0,top}' = '7.77', 'item numbers as plain strings');
  perform gold_test.assert((gold.post_transaction(jsonb_build_object('id', tx, 'branchId', tkw))->>'replayed')::boolean, 'same id replays');
  select * into bal from gold.branch_balance(tkw);
  perform gold_test.assert(bal.cash_value = 10500 and bal.goods_value = 1000 and bal.goods_top = 7.77 and bal.goods_down = 0.41,
    'purchase: cash out 1000, goods in 1000 at top 7.77: ' || bal.cash_value || '/' || bal.goods_value);

  -- 4. Split payment: cash + mobile money from Kumasi + owed ---------------------------------
  tx2 := gen_random_uuid();
  perform gold_test.assert(gold_test.code_of(format($f$select gold.post_transaction(%L::jsonb)$f$, jsonb_build_object('id', tx2, 'branchId', tkw,
    'customer', jsonb_build_object('name', 'Efua'), 'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '2000',
    'calculatedAmount', '2000', 'policy', 'down', 'strategy', 'fewest-notes', 'payable', 2000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 500, 'lines', '{"100":5}'::jsonb),
       jsonb_build_object('method', 'mobile_money', 'amount', 1000, 'paidByBranchId', ksi, 'externalRef', 'MM1'),
       jsonb_build_object('method', 'owed', 'amount', 500))))) = 'CUSTOMER_REQUIRED', 'owing a customer needs name and phone');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.post_transaction(%L::jsonb)$f$, jsonb_build_object('id', tx2, 'branchId', tkw,
    'customer', jsonb_build_object('name', 'Efua', 'phone', '024 111 2222'), 'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '2000',
    'calculatedAmount', '2000', 'policy', 'down', 'strategy', 'fewest-notes', 'payable', 2000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 500, 'lines', '{"100":5}'::jsonb))))) = 'PAYOUT_MISMATCH', 'parts must add up');
  select count(*) into n from gold.transactions where id = tx2;
  perform gold_test.assert(n = 0, 'a rejected purchase leaves nothing behind');
  r := gold.post_transaction(jsonb_build_object('id', tx2, 'branchId', tkw,
    'customer', jsonb_build_object('name', 'Efua', 'phone', '024 111 2222'), 'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '2000',
    'calculatedAmount', '2000', 'policy', 'down', 'strategy', 'fewest-notes', 'payable', 2000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 500, 'lines', '{"100":5}'::jsonb),
       jsonb_build_object('method', 'mobile_money', 'amount', 1000, 'paidByBranchId', ksi, 'externalRef', 'MM1'),
       jsonb_build_object('method', 'owed', 'amount', 500))));
  perform gold_test.assert(r#>>'{data,reference}' like '%-0002' and jsonb_array_length(r#>'{data,payments}') = 3, 'second purchase of the day is number 2 with three payments');
  select * into bal from gold.branch_balance(tkw);
  perform gold_test.assert(bal.cash_value = 10000 and bal.payable_value = 500 and bal.goods_value = 3000, 'cash -500, payable +500, goods +2000: ' || bal.cash_value || '/' || bal.payable_value || '/' || bal.goods_value);
  select id into pay from gold.transaction_payments where transaction_id = tx2 and method = 'mobile_money';
  perform gold_test.assert(gold_test.code_of(format($f$select gold.resolve_payment(%L, 'confirmed', %L::uuid[], null)$f$, pay, array[tkw])) = 'FORBIDDEN',
    'the receiving branch cannot confirm money it did not send');
  r := gold.resolve_payment(pay, 'confirmed', array[ksi], null);
  perform gold_test.assert(r#>>'{data,payments,1,status}' is null and (select status from gold.transaction_payments where id = pay) = 'confirmed', 'mobile money confirmed');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.resolve_payment(%L, 'failed', %L::uuid[], '[]')$f$, pay, array[ksi])) = 'ALREADY_RESOLVED', 'resolved once only');
  perform gold_test.assert((select mobile_money_paid_on_behalf from gold.v_interbranch_position where sender_branch_id = ksi and receiver_branch_id = tkw) = 1000,
    'Kumasi is shown as having paid 1000 on the branch''s behalf');

  -- 5. Mobile money that fails is covered by cash ------------------------------------------
  tx3 := gen_random_uuid();
  perform gold.post_transaction(jsonb_build_object('id', tx3, 'branchId', tkw, 'customer', jsonb_build_object('name', 'Yaa'), 'items', jsonb_build_array(gold_test.item()),
    'formulaVersion', 'ExcelV1', 'clientAmount', '600', 'calculatedAmount', '600', 'policy', 'down', 'strategy', 'fewest-notes', 'payable', 600, 'difference', 0,
    'capturedAt', now(), 'priceAsOf', now(), 'payments', jsonb_build_array(jsonb_build_object('method', 'mobile_money', 'amount', 600, 'paidByBranchId', ksi))));
  select id into pay from gold.transaction_payments where transaction_id = tx3;
  perform gold_test.assert(gold_test.code_of(format($f$select gold.resolve_payment(%L, 'failed', %L::uuid[], '[{"method":"cash","amount":500,"lines":{"100":5}}]')$f$, pay, array[ksi])) = 'PAYOUT_MISMATCH',
    'replacements must cover the whole failed amount');
  r := gold.resolve_payment(pay, 'failed', array[ksi], '[{"method":"cash","amount":600,"lines":{"100":6}}]');
  perform gold_test.assert(r#>>'{payout,lines,100}' = '6', 'cash replaced the failed mobile money: ' || r::text);
  select * into bal from gold.branch_balance(tkw);
  perform gold_test.assert(bal.cash_value = 9400 and bal.goods_value = 3600, 'books after the replacement: ' || bal.cash_value || '/' || bal.goods_value);

  -- 6. A loan against unrefined gold, then refined and used to settle it ----------------------
  perform gold_test.assert(gold_test.code_of(format($f$select gold.issue_loan(%L::jsonb)$f$, jsonb_build_object('id', gen_random_uuid(), 'branchId', tkw, 'principal', 1000,
    'customer', jsonb_build_object('name', 'Kofi'), 'lines', '{"100":10}'::jsonb, 'capturedAt', now()))) = 'CUSTOMER_REQUIRED', 'a loan to a customer needs a phone');
  r := gold.issue_loan(jsonb_build_object('id', loan_kofi, 'branchId', tkw, 'principal', 1000, 'customer', jsonb_build_object('name', 'Kofi', 'phone', '0200000001'),
        'lines', '{"100":10}'::jsonb, 'reason', 'School fees', 'collateral', jsonb_build_object('topWeight', '50.5', 'description', 'unrefined lump'), 'capturedAt', now()));
  perform gold_test.assert(r#>>'{data,outstanding}' = '1000' and r#>>'{data,collateral,topWeight}' = '50.5', 'loan with security: ' || r::text);
  select * into bal from gold.branch_balance(tkw);
  perform gold_test.assert(bal.cash_value = 8400 and bal.debt_value = 1000 and bal.custody_top = 50.5 and bal.goods_top = 3 * 7.77,
    'cash out, debt up, custody up, goods untouched: ' || bal.cash_value || '/' || bal.debt_value || '/' || bal.custody_top);
  select id, customer_id into coll, kofi from gold.collateral_holdings where debt_id = loan_kofi;
  perform gold_test.assert(gold_test.code_of(format($f$select gold.return_collateral(%L, null)$f$, coll)) = 'DEBT_NOT_SETTLED', 'security stays until the loan is settled');

  tx4 := gen_random_uuid();
  perform gold_test.assert(gold_test.code_of(format($f$select gold.post_transaction(%L::jsonb)$f$, jsonb_build_object('id', gen_random_uuid(), 'branchId', tkw,
    'customer', jsonb_build_object('name', 'Someone', 'phone', '0299999999'), 'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1500',
    'calculatedAmount', '1500', 'policy', 'down', 'strategy', 'fewest-notes', 'payable', 1500, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(),
    'payments', jsonb_build_array(jsonb_build_object('method', 'debt_offset', 'amount', 1000, 'debtId', loan_kofi), jsonb_build_object('method', 'cash', 'amount', 500, 'lines', '{"100":5}'::jsonb))))) = 'DEBT_NOT_CUSTOMERS',
    'gold cannot settle somebody else''s debt');
  r := gold.post_transaction(jsonb_build_object('id', tx4, 'branchId', tkw, 'customer', jsonb_build_object('name', 'Kofi', 'phone', '0200000001'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1500', 'calculatedAmount', '1500', 'policy', 'down', 'strategy', 'fewest-notes',
    'payable', 1500, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(), 'collateralId', coll,
    'payments', jsonb_build_array(jsonb_build_object('method', 'debt_offset', 'amount', 1000, 'debtId', loan_kofi),
                                  jsonb_build_object('method', 'cash', 'amount', 500, 'lines', '{"100":5}'::jsonb))));
  select * into bal from gold.branch_balance(tkw);
  perform gold_test.assert(bal.debt_value = 0 and bal.custody_top = 0 and bal.cash_value = 7900 and bal.goods_value = 5100,
    'gold worth more than the debt: debt cleared, security gone, the rest paid in cash: ' || bal.debt_value || '/' || bal.custody_top || '/' || bal.cash_value || '/' || bal.goods_value);
  perform gold_test.assert((select status from gold.debts where id = loan_kofi) = 'settled', 'the loan is settled');
  perform gold_test.assert((select method from gold.debt_repayments where debt_id = loan_kofi) = 'gold', 'the repayment says it was paid with gold');
  perform gold_test.assert((select status from gold.collateral_holdings where id = coll) = 'converted', 'the security was converted into the purchase');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.post_transaction(%L::jsonb)$f$, jsonb_build_object('id', gen_random_uuid(), 'branchId', tkw,
    'customer', jsonb_build_object('name', 'Kofi', 'phone', '0200000001'), 'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1500',
    'calculatedAmount', '1500', 'policy', 'down', 'strategy', 'fewest-notes', 'payable', 1500, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(), 'collateralId', coll,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1500, 'lines', '{"100":15}'::jsonb))))) = 'COLLATERAL_NOT_HELD', 'security can be used once');

  -- 7. Gold worth less than the debt; the customer then pays the rest in cash --------------------
  perform gold.issue_loan(jsonb_build_object('id', loan_ama, 'branchId', tkw, 'principal', 800, 'customer', jsonb_build_object('name', 'Ama B', 'phone', '0200000002'),
        'lines', '{"100":8}'::jsonb, 'capturedAt', now()));
  tx5 := gen_random_uuid();
  perform gold_test.assert(gold_test.code_of(format($f$select gold.post_transaction(%L::jsonb)$f$, jsonb_build_object('id', gen_random_uuid(), 'branchId', tkw,
    'customer', jsonb_build_object('name', 'Ama B', 'phone', '0200000002'), 'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000',
    'calculatedAmount', '1000', 'policy', 'down', 'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(),
    'payments', jsonb_build_array(jsonb_build_object('method', 'debt_offset', 'amount', 1000, 'debtId', loan_ama))))) = 'OVERPAYMENT', 'cannot offset more than is owed');
  perform gold.post_transaction(jsonb_build_object('id', tx5, 'branchId', tkw, 'customer', jsonb_build_object('name', 'Ama B', 'phone', '0200000002'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '500', 'calculatedAmount', '500', 'policy', 'down', 'strategy', 'fewest-notes',
    'payable', 500, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(), 'payments', jsonb_build_array(jsonb_build_object('method', 'debt_offset', 'amount', 500, 'debtId', loan_ama))));
  perform gold_test.assert((select outstanding from gold.v_debts_outstanding where id = loan_ama) = 300, 'gold worth less: 300 still owed');
  r := gold.repay_debt(jsonb_build_object('id', gen_random_uuid(), 'debtId', loan_ama, 'amount', 300, 'method', 'cash', 'lines', '{"100":3}'::jsonb, 'capturedAt', now()));
  perform gold_test.assert(r#>>'{data,status}' = 'settled' and r#>>'{data,outstanding}' = '0', 'the rest paid in cash settles it');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.repay_debt(%L::jsonb)$f$, jsonb_build_object('id', gen_random_uuid(), 'debtId', loan_ama, 'amount', 1, 'method', 'cash',
    'lines', '{"5":1}'::jsonb, 'capturedAt', now()))) = 'DEBT_CLOSED', 'a settled debt takes no more');

  -- 8. Settling what the branch owes a customer ------------------------------------------------
  select id into owed_debt from gold.debts where source_transaction_id = tx2 and direction = 'payable';
  perform gold_test.assert(gold_test.code_of(format($f$select gold.repay_debt(%L::jsonb)$f$, jsonb_build_object('id', gen_random_uuid(), 'debtId', owed_debt, 'amount', 500,
    'method', 'cash', 'lines', '{"100":4}'::jsonb, 'capturedAt', now()))) = 'PAYOUT_MISMATCH', 'notes must match the amount');
  select * into bal from gold.branch_balance(tkw);
  r := gold.repay_debt(jsonb_build_object('id', gen_random_uuid(), 'debtId', owed_debt, 'amount', 500, 'method', 'cash', 'lines', '{"100":5}'::jsonb, 'capturedAt', now()));
  perform gold_test.assert(r#>>'{data,status}' = 'settled', 'owed amount paid');
  select * into bal from gold.branch_balance(tkw);
  perform gold_test.assert(bal.payable_value = 0, 'nothing owed to customers any more');

  -- 9. Security returned after the loan is paid ---------------------------------------------------------
  perform gold.issue_loan(jsonb_build_object('id', loan_yaw, 'branchId', tkw, 'principal', 200, 'customer', jsonb_build_object('name', 'Yaw', 'phone', '0200000003'),
        'lines', '{"100":2}'::jsonb, 'collateral', jsonb_build_object('topWeight', '20'), 'capturedAt', now()));
  select id into coll from gold.collateral_holdings where debt_id = loan_yaw;
  perform gold.repay_debt(jsonb_build_object('id', gen_random_uuid(), 'debtId', loan_yaw, 'amount', 200, 'method', 'cash', 'lines', '{"100":2}'::jsonb, 'capturedAt', now()));
  r := gold.return_collateral(coll, 'collected by Yaw');
  perform gold_test.assert(r->>'status' = 'returned', 'security handed back');
  select * into bal from gold.branch_balance(tkw);
  perform gold_test.assert(bal.custody_top = 0, 'nothing held any more');

  -- 10. The whole branch books after everything above ----------------------------------------------------
  select * into bal from gold.branch_balance(tkw);
  -- cash: 11500 -1000 -500 -600 -1000(loan) -500(tx4) -800(loan) +300(repay) -500(owed) -200(loan) +200(repay) -0 = 6900, gold bought: 1000+2000+600+1500+500 = 5600
  perform gold_test.assert(bal.cash_value = 6900, 'final cash ' || bal.cash_value);
  perform gold_test.assert(bal.goods_value = 5600, 'final goods value = everything paid for gold ' || bal.goods_value);
  perform gold_test.assert(bal.debt_value = 0 and bal.payable_value = 0, 'no debts either way');
  perform gold_test.assert(gold.transactions_json(tkw, 50) is not null and jsonb_array_length(gold.transactions_json(tkw, 50)) = 5, 'transactions list');
  perform gold_test.assert(jsonb_array_length(gold.debts_json(tkw, 'receivable', false, null)) = 3, 'debt list');
  perform gold_test.assert(jsonb_array_length(gold.customers_json('kof')) = 1, 'customer search');
  select count(*) into n from gold.v_branch_timeline where branch_id = tkw and running_custody_top is not null;
  perform gold_test.assert(n > 20, 'timeline includes the new rows');

  -- 11. No open day: the purchase is still saved, flagged, and the cash still leaves the books ----------------
  ksi_day := gen_random_uuid();
  r := gold.post_transaction(jsonb_build_object('id', gen_random_uuid(), 'branchId', ksi, 'customer', jsonb_build_object('name', 'Kojo'), 'items', jsonb_build_array(gold_test.item()),
    'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down', 'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0,
    'capturedAt', now(), 'priceAsOf', now(), 'flags', '["OFFLINE_ENTRY"]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb))));
  perform gold_test.assert(r#>'{data,flags}' @> '"NO_OPEN_DAY"' and r#>'{data,flags}' @> '"OFFLINE_ENTRY"', 'flags kept and NO_OPEN_DAY added');
  perform gold_test.assert(r#>>'{data,reference}' like 'KSI-%-0001', 'numbering is per branch');
  select * into bal from gold.branch_balance(ksi);
  perform gold_test.assert(bal.cash_value = -1000 and bal.goods_value = 1000, 'still on the books, with no day attached');

  -- 12. Continuity: tomorrow starts from today's closing -------------------------------------------------------
  -- Kumasi already had history (the purchase above left its drawer at -1000), so a counted 5000 is a difference that needs a reason.
  perform gold_test.assert(gold_test.code_of(format($f$select gold.open_day(%L::jsonb)$f$, jsonb_build_object('id', ksi_day, 'branchId', ksi, 'businessDate', current_date - 3,
    'lines', '{"100":50}'::jsonb, 'capturedAt', now()))) = 'EXPLANATION_REQUIRED', 'the first count after a sale made with no open day needs a reason');
  r := gold.open_day(jsonb_build_object('id', ksi_day, 'branchId', ksi, 'businessDate', current_date - 3, 'lines', '{"100":50}'::jsonb,
        'explanation', 'sold earlier while the day was not open', 'capturedAt', now()));
  reset role;
  update gold.business_days set status = 'closed', closed_at = now(), closed_by = u_teller, closing_confirmed = true,
    closing_confirmation_version = 'v2', closing_confirmation_text = 'test' where id = ksi_day;
  set local role gold_app;
  perform set_config('app.tenant_id', t::text, true);
  perform set_config('app.user_id', u_teller::text, true);
  select * into bal from gold.branch_balance(ksi);
  ksi_day2 := gen_random_uuid();
  perform gold_test.assert(gold_test.code_of(format($f$select gold.open_day(%L::jsonb)$f$, jsonb_build_object('id', ksi_day2, 'branchId', ksi, 'businessDate', current_date - 2,
    'lines', jsonb_build_object('100', 49), 'capturedAt', now()))) = 'EXPLANATION_REQUIRED', 'a different opening count needs a reason');
  select count(*) into n from gold.business_days where id = ksi_day2;
  perform gold_test.assert(n = 0, 'refused opening leaves nothing behind');
  r := gold.open_day(jsonb_build_object('id', ksi_day2, 'branchId', ksi, 'businessDate', current_date - 2, 'lines', jsonb_build_object('100', 49),
        'explanation', 'one note taken home by the manager', 'capturedAt', now()));
  select * into bal from gold.branch_balance(ksi);
  perform gold_test.assert(bal.cash_value = 4900 and r#>'{data,flags}' @> '"OPENING_DIFFERS"', 'the ledger now agrees with the count and the day is flagged: ' || bal.cash_value);
  perform gold_test.assert((select count(*) from gold.day_reconciliations where business_day_id = ksi_day2 and outcome = 'shortage') = 1, 'the shortage is recorded');
  reset role;
  update gold.business_days set status = 'closed', closed_at = now(), closed_by = u_teller, closing_confirmed = true,
    closing_confirmation_version = 'v2', closing_confirmation_text = 'test' where id = ksi_day2;
  set local role gold_app;
  perform set_config('app.tenant_id', t::text, true);
  perform set_config('app.user_id', u_teller::text, true);
  r := gold.open_day(jsonb_build_object('id', gen_random_uuid(), 'branchId', ksi, 'businessDate', current_date - 1, 'lines', '{}'::jsonb, 'source', 'carried', 'capturedAt', now()));
  perform gold_test.assert(r#>>'{data,opening,source}' = 'carried' and r#>>'{data,opening,lines,100}' = '49' and not (r#>'{data,flags}' @> '"OPENING_DIFFERS"'),
    'carried opening takes the books as they are: ' || r::text);

  -- 13. Guards ---------------------------------------------------------------------------------------------------
  perform set_config('app.user_id', '', true);
  perform gold_test.assert(gold_test.code_of($f$select gold.set_base_price(100, null)$f$) = 'UNAUTHENTICATED', 'writes need a signed-in user');
  reset role;
  raise notice 'operations core: all assertions passed';
end $$;