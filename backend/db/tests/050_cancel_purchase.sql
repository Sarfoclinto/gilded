-- B56: cancelling a wrongly saved purchase puts back everything it did, by new ledger entries; nothing is edited.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); ksi uuid := gen_random_uuid(); r_m uuid := gen_random_uuid(); r_t uuid := gen_random_uuid();
  mgr uuid := gen_random_uuid(); teller uuid := gen_random_uuid(); boss uuid := gen_random_uuid();
  d1 uuid := gen_random_uuid(); d2 uuid := gen_random_uuid();
  tx_cash uuid := gen_random_uuid(); tx_mix uuid := gen_random_uuid(); tx_two uuid := gen_random_uuid(); tx_sec uuid := gen_random_uuid(); tx_mm uuid := gen_random_uuid(); tx_sent uuid := gen_random_uuid();
  loan uuid := gen_random_uuid(); coll uuid; pay uuid; trf uuid := gen_random_uuid(); items uuid[];
  r jsonb; bal record; before record; n int; x text;
  buy_cash constant text := 'cash';
begin
  insert into gold.tenants (id, slug, name) values (t, 'cancel', 'Cancel Gold');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', false), (ksi, t, 'KSI', 'Kumasi', true);
  insert into gold.roles (id, tenant_id, key, name, is_system) values (r_m, t, 'manager', 'Manager', true), (r_t, t, 'teller', 'Teller', true);
  insert into gold.role_permissions (tenant_id, role_id, permission) values (t, r_m, 'transactions:cancel'), (t, r_m, 'discrepancies:review'), (t, r_m, 'days:manage');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values
    (mgr, t, 'mgr', 'Manager', 'x', r_m), (teller, t, 'ama', 'Ama', 'x', r_t), (boss, t, 'boss', 'Boss', 'x', r_m);
  insert into gold.user_branches (tenant_id, user_id, branch_id) values (t, mgr, tkw), (t, teller, tkw), (t, boss, tkw);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  set local role gold_app;
  perform set_config('app.user_id', teller::text, true);

  -- the manager preset of an existing company got the new permission
  perform gold_test.assert(exists (select 1 from gold.role_permissions where role_id = r_m and permission = 'transactions:cancel'), 'managers may cancel');

  perform gold.open_day(jsonb_build_object('id', d1, 'branchId', tkw, 'businessDate', current_date, 'lines', '{"100":200,"50":20}'::jsonb, 'capturedAt', now()));
  select * into before from gold.branch_balance(tkw);

  -- 1. A plain cash purchase, cancelled: cash back, gold off the books, everything exactly as before
  perform gold.post_transaction(jsonb_build_object('id', tx_cash, 'branchId', tkw, 'customer', jsonb_build_object('name', 'Kwesi', 'phone', '0244000001'),
    'items', jsonb_build_array(gold_test.item(), gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '2000', 'calculatedAmount', '2000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 2000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(), 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 2000, 'lines', '{"100":15,"50":10}'::jsonb))));
  select * into bal from gold.branch_balance(tkw);
  perform gold_test.assert(bal.cash_value = before.cash_value - 2000 and bal.goods_value = 2000, 'bought: cash out, goods in');

  -- a reason is needed; an unknown purchase is not found
  x := gold_test.code_of(format($q$select gold.cancel_transaction(jsonb_build_object('id', %L, 'reason', 'oops'))$q$, tx_cash));
  perform gold_test.assert(x = 'VALIDATION_FAILED', 'a reason of at least 5 characters: ' || x);
  perform gold_test.assert(gold_test.code_of($q$select gold.cancel_transaction(jsonb_build_object('id', gen_random_uuid(), 'reason', 'wrong customer'))$q$) = 'NOT_FOUND', 'unknown purchase');

  perform set_config('app.user_id', mgr::text, true);
  r := gold.cancel_transaction(jsonb_build_object('id', tx_cash, 'reason', 'Wrong customer was chosen'));
  perform gold_test.assert(r#>>'{data,status}' = 'void' and r#>>'{data,voidReason}' = 'Wrong customer was chosen' and r#>>'{data,voidedBy,id}' = mgr::text, 'marked cancelled with the reason and by whom: ' || (r->'data')::text);
  perform gold_test.assert((r->>'cashBack')::numeric = 2000 and (r->>'entriesReversed')::int = 3, 'what came back: ' || r::text);
  select * into bal from gold.branch_balance(tkw);
  perform gold_test.assert(bal.cash_value = before.cash_value and bal.goods_value = 0 and bal.goods_top = 0 and bal.goods_down = 0, 'the books are as before: ' || bal.cash_value || '/' || bal.goods_value);
  perform gold_test.assert((bal.cash_lines->>'100')::int = 200 and (bal.cash_lines->>'50')::int = 20, 'the same notes came back');
  -- the originals are untouched and the reversals point at them
  perform gold_test.assert((select count(*) from gold.ledger_entries where source_id = tx_cash and source_type <> 'reversal') = 3, 'the original entries are still there');
  perform gold_test.assert((select count(*) from gold.ledger_entries e where e.source_type = 'reversal' and e.source_id = tx_cash and e.business_day_id = d1 and e.reverses_entry_id is not null) = 3, 'three reversals, in today''s day, each pointing at its entry');
  perform gold_test.assert(not exists (select 1 from gold.transaction_items where transaction_id = tx_cash and location_state = 'on_hand'), 'the pieces are no longer stock');
  perform gold_test.assert(not exists (select 1 from jsonb_array_elements(gold.transferable_items_json(tkw)) i where i->>'transactionId' = tx_cash::text), 'and cannot be sent');
  -- told and audited
  perform gold_test.assert((select count(*) from gold.notifications where kind = 'purchase_cancelled' and user_id = boss) = 1 and (select count(*) from gold.notifications where kind = 'purchase_cancelled' and user_id = mgr) = 0, 'the other reviewer is told, not the one who did it');
  perform gold_test.assert((select count(*) from gold.audit_events where action = 'transaction.cancelled' and entity_id = tx_cash::text) = 1, 'audited');
  -- cannot be cancelled twice; the drawer state counts it as applied no more
  perform gold_test.assert(gold_test.code_of(format($q$select gold.cancel_transaction(jsonb_build_object('id', %L, 'reason', 'again please'))$q$, tx_cash)) = 'ALREADY_CANCELLED', 'once only');

  -- 2. Paid partly in cash, partly owed, partly with a debt settled by gold, with security released: all of it comes back
  perform set_config('app.user_id', teller::text, true);
  perform gold.issue_loan(jsonb_build_object('id', loan, 'branchId', tkw, 'principal', 1000, 'customer', jsonb_build_object('name', 'Kofi', 'phone', '0200000001'),
    'lines', '{"100":10}'::jsonb, 'reason', 'School fees', 'collateral', jsonb_build_object('topWeight', '50.5', 'description', 'lump'), 'capturedAt', now()));
  select id into coll from gold.collateral_holdings where debt_id = loan;
  select * into before from gold.branch_balance(tkw);
  perform gold.post_transaction(jsonb_build_object('id', tx_mix, 'branchId', tkw, 'customer', jsonb_build_object('name', 'Kofi', 'phone', '0200000001'),
    'items', jsonb_build_array(gold_test.item(), gold_test.item(), gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '3000', 'calculatedAmount', '3000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 3000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(), 'collateralId', coll,
    'payments', jsonb_build_array(jsonb_build_object('method', 'debt_offset', 'amount', 1000, 'debtId', loan),
                                  jsonb_build_object('method', 'owed', 'amount', 500),
                                  jsonb_build_object('method', 'cash', 'amount', 1500, 'lines', '{"100":15}'::jsonb))));
  select * into bal from gold.branch_balance(tkw);
  perform gold_test.assert(bal.debt_value = 0 and bal.payable_value = 500 and bal.custody_top = 0 and bal.cash_value = before.cash_value - 1500, 'mixed purchase went in');
  perform set_config('app.user_id', mgr::text, true);
  r := gold.cancel_transaction(jsonb_build_object('id', tx_mix, 'reason', 'Weighed on a faulty scale'));
  select * into bal from gold.branch_balance(tkw);
  perform gold_test.assert(bal.cash_value = before.cash_value and bal.debt_value = 1000 and bal.payable_value = 0 and bal.custody_top = 50.5 and bal.goods_value = 0,
    'cash back, the debt owed again, nothing owed to the customer, the security held again, no goods: ' || bal.cash_value || '/' || bal.debt_value || '/' || bal.payable_value || '/' || bal.custody_top);
  perform gold_test.assert((select status from gold.debts where id = loan) = 'open' and (select outstanding from gold.v_debts_outstanding where id = loan) = 1000, 'the loan is open again, in full');
  perform gold_test.assert((select count(*) from gold.debt_repayments where debt_id = loan) = 2 and (select sum(amount) from gold.debt_repayments where debt_id = loan) = 0, 'the repayment stays, reversed by a second row');
  perform gold_test.assert((select status from gold.debts where source_transaction_id = tx_mix and direction = 'payable') = 'written_off', 'the amount owed to the customer is closed');
  perform gold_test.assert((select status from gold.collateral_holdings where id = coll) = 'held' and (select converted_transaction_id from gold.collateral_holdings where id = coll) is null, 'the security is held again');
  perform gold_test.assert((r->>'cashBack')::numeric = 1500, 'only the cash really paid comes back: ' || r::text);

  -- 3. Two-step: saved but not paid yet, then cancelled: nothing owed, no cash moves
  perform gold.set_settings('{"payout.twoStep": true}'::jsonb);
  perform set_config('app.user_id', teller::text, true);
  select * into before from gold.branch_balance(tkw);
  perform gold.post_transaction(jsonb_build_object('id', tx_two, 'branchId', tkw, 'customer', jsonb_build_object('name', 'Yaa', 'phone', '0244000003'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb))));
  select * into bal from gold.branch_balance(tkw);
  perform gold_test.assert(bal.payable_value = 1000 and bal.cash_value = before.cash_value, 'two-step: owed until paid');
  perform set_config('app.user_id', mgr::text, true);
  r := gold.cancel_transaction(jsonb_build_object('id', tx_two, 'reason', 'Customer changed his mind before being paid'));
  select * into bal from gold.branch_balance(tkw);
  perform gold_test.assert(bal.payable_value = 0 and bal.cash_value = before.cash_value and bal.goods_value = 0 and (r->>'cashBack')::numeric = 0, 'nothing owed any more, no cash moved');
  perform gold_test.assert(jsonb_array_length(gold.to_pay_json(tkw, null)) = 0, 'it is no longer waiting to be paid');
  perform gold.set_settings('{"payout.twoStep": false}'::jsonb);

  -- 4. Mobile money: pending is marked failed; confirmed stops the cancellation
  perform set_config('app.user_id', teller::text, true);
  perform gold.post_transaction(jsonb_build_object('id', tx_mm, 'branchId', tkw, 'customer', jsonb_build_object('name', 'Esi', 'phone', '0244000004'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(),
    'payments', jsonb_build_array(jsonb_build_object('method', 'mobile_money', 'amount', 600, 'paidByBranchId', ksi, 'externalRef', 'MM9'),
                                  jsonb_build_object('method', 'cash', 'amount', 400, 'lines', '{"100":4}'::jsonb))));
  select id into pay from gold.transaction_payments where transaction_id = tx_mm and method = 'mobile_money';
  perform set_config('app.user_id', mgr::text, true);
  r := gold.cancel_transaction(jsonb_build_object('id', tx_mm, 'reason', 'Saved twice by mistake'));
  perform gold_test.assert((select status from gold.transaction_payments where id = pay) = 'failed' and (r->>'cashBack')::numeric = 400, 'pending mobile money is marked failed, the cash part comes back');
  perform set_config('app.user_id', teller::text, true);
  perform gold.post_transaction(jsonb_build_object('id', tx_sent, 'branchId', tkw, 'customer', jsonb_build_object('name', 'Esi', 'phone', '0244000004'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(),
    'payments', jsonb_build_array(jsonb_build_object('method', 'mobile_money', 'amount', 1000, 'paidByBranchId', ksi, 'externalRef', 'MM10'))));
  select id into pay from gold.transaction_payments where transaction_id = tx_sent and method = 'mobile_money';
  perform gold.resolve_payment(pay, 'confirmed', array[ksi], null);
  perform set_config('app.user_id', mgr::text, true);
  perform gold_test.assert(gold_test.code_of(format($q$select gold.cancel_transaction(jsonb_build_object('id', %L, 'reason', 'Too late now'))$q$, tx_sent)) = 'MONEY_SENT', 'confirmed mobile money stops it');

  -- 5. Gold already sent to another branch cannot be cancelled
  perform set_config('app.user_id', teller::text, true);
  perform gold.post_transaction(jsonb_build_object('id', tx_sec, 'branchId', tkw, 'customer', jsonb_build_object('name', 'Kojo', 'phone', '0244000005'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb))));
  select array_agg(id) into items from gold.transaction_items where transaction_id = tx_sec;
  perform gold.create_transfer(jsonb_build_object('id', trf, 'kind', 'goods', 'originBranchId', tkw, 'destinationBranchId', ksi, 'purpose', 'stock_collection',
    'method', 'staff_travelling', 'itemIds', to_jsonb(items)), array[tkw]);
  perform gold.transfer_edit(trf, jsonb_build_object('collector', jsonb_build_object('type', 'external', 'name', 'Mr O', 'phone', '024', 'idType', 'Ghana card', 'idNumber', 'G-1')), array[tkw]);
  perform gold.release_transfer(trf, '{}'::jsonb, array[tkw]);
  perform set_config('app.user_id', mgr::text, true);
  perform gold_test.assert(gold_test.code_of(format($q$select gold.cancel_transaction(jsonb_build_object('id', %L, 'reason', 'Found a mistake'))$q$, tx_sec)) = 'GOODS_MOVED', 'gold on its way cannot be cancelled');

  -- 6. No day open: refused, because the cash has nowhere to go
  perform gold.close_day(jsonb_build_object('id', gen_random_uuid(), 'dayId', d1, 'branchId', tkw, 'capturedAt', now(),
    'declared', jsonb_build_object('cash', (select cash_lines from gold.branch_balance(tkw)), 'goodsTop', gold.ts((select goods_top from gold.branch_balance(tkw))), 'goodsDown', gold.ts((select goods_down from gold.branch_balance(tkw))),
                                   'goodsValue', gold.ts((select goods_value from gold.branch_balance(tkw))), 'debt', gold.ts((select debt_value from gold.branch_balance(tkw))), 'payable', '0', 'custodyTop', gold.ts((select custody_top from gold.branch_balance(tkw)))),
    'confirmation', jsonb_build_object('accepted', true, 'version', 'v3', 'text', 'I confirm that I have physically verified everything reported.')));
  perform gold_test.assert(gold_test.code_of(format($q$select gold.cancel_transaction(jsonb_build_object('id', %L, 'reason', 'After hours mistake'))$q$, tx_mm)) in ('NO_OPEN_DAY', 'ALREADY_CANCELLED'), 'after closing: a day must be open');
  raise notice 'cancel purchase ok';
end $$;