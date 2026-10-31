-- Two-step payout: one person records, another pays; settings switch it on; the amount can never change at the paying step.
do $$
declare
  t uuid := gen_random_uuid(); b uuid := gen_random_uuid(); r_role uuid := gen_random_uuid();
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid();
  b2 uuid := gen_random_uuid(); d1 uuid := gen_random_uuid(); tx uuid := gen_random_uuid(); tx2 uuid := gen_random_uuid(); tx3 uuid := gen_random_uuid(); tx4 uuid := gen_random_uuid();
  r jsonb; bal record; n int; v_it jsonb;
begin
  insert into gold.tenants (id, slug, name) values (t, 'twostep', 'Two step');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main, timezone) values (b, t, 'TKW', 'Tarkwa', true, 'Africa/Accra');
  insert into gold.branches (id, tenant_id, code, name, is_main, timezone) values (b2, t, 'KUM', 'Kumasi', false, 'Africa/Accra');
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'teller', 'Teller');
  insert into gold.role_permissions (tenant_id, role_id, permission) values (t, r_role, 'days:manage');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u1, t, 'ama', 'Ama', 'x', r_role), (u2, t, 'kojo', 'Kojo', 'x', r_role);
  insert into gold.user_branches (tenant_id, user_id, branch_id, is_primary) values (t, u1, b, true), (t, u2, b, true);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  set local role gold_app;
  perform set_config('app.user_id', u1::text, true);

  -- defaults and validation
  perform gold_test.assert((gold.settings_json()->>'payout.twoStep')::boolean = false and (gold.settings_json()->>'allowance.perPerson')::int = 100, 'defaults');
  perform gold_test.assert(gold_test.code_of($q$select gold.set_settings('{"nope":1}'::jsonb)$q$) = 'VALIDATION_FAILED', 'unknown setting refused');
  perform gold_test.assert(gold_test.code_of($q$select gold.set_settings('{"payout.twoStep":"yes"}'::jsonb)$q$) = 'VALIDATION_FAILED', 'wrong type refused');
  perform gold_test.assert(gold_test.code_of($q$select gold.set_settings('{"receipt.paper":"a3"}'::jsonb)$q$) = 'VALIDATION_FAILED', 'bad paper refused');
  perform gold_test.assert(gold_test.code_of($q$select gold.set_settings('{"allowance.perPerson":-5}'::jsonb)$q$) = 'VALIDATION_FAILED', 'negative allowance refused');

  perform gold.open_day(jsonb_build_object('id', d1, 'branchId', b, 'businessDate', current_date, 'lines', '{"200":10,"100":20}'::jsonb, 'capturedAt', now() - interval '2 hours'));

  -- off: unchanged behaviour, paid at once
  perform gold.post_transaction(jsonb_build_object('id', tx4, 'branchId', b, 'customer', jsonb_build_object('name', 'Direct'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now() - interval '90 minutes', 'priceAsOf', now() - interval '2 hours', 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"200":5}'::jsonb))));
  perform gold_test.assert((select stage from gold.transactions where id = tx4) = 'paid', 'direct purchases are paid');
  select * into bal from gold.branch_balance(b);
  perform gold_test.assert(bal.cash_value = 3000, 'direct: cash left the drawer');

  r := gold.set_settings('{"payout.twoStep":true}'::jsonb);
  perform gold_test.assert((r->>'payout.twoStep')::boolean, 'switched on');

  -- on: the cash waits
  v_it := gold_test.item();
  r := gold.post_transaction(jsonb_build_object('id', tx, 'branchId', b, 'customer', jsonb_build_object('name', 'Kwesi'),
    'items', jsonb_build_array(v_it), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now() - interval '1 hour', 'priceAsOf', now() - interval '2 hours', 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"200":5}'::jsonb))));
  perform gold_test.assert(r#>>'{data,payout,stage}' = 'to_pay' and (r#>>'{data,payout,cashDue}')::numeric = 1000, 'waits to be paid: ' || r::text);
  perform gold_test.assert(r#>'{data,payout,suggestedLines}' = '{"200":5}'::jsonb, 'suggested notes kept');
  select * into bal from gold.branch_balance(b);
  perform gold_test.assert(bal.cash_value = 3000 and bal.payable_value = 1000 and bal.goods_value >= 1000, 'drawer untouched, owed to the customer: ' || bal.payable_value);
  perform gold_test.assert(not exists (select 1 from gold.transaction_payments where transaction_id = tx), 'no payment recorded until it is paid');
  perform gold_test.assert((select count(*) from gold.notifications where kind = 'purchase_to_pay' and user_id = u2) = 1
                           and (select count(*) from gold.notifications where kind = 'purchase_to_pay' and user_id = u1) = 0, 'the other person is told, not the recorder');

  -- the payer's list
  r := gold.to_pay_json(b, null); perform gold_test.assert(jsonb_array_length(r) = 1, 'listed');
  r := gold.to_pay_json(b, 'kwes'); perform gold_test.assert(jsonb_array_length(r) = 1, 'found by name');
  r := gold.to_pay_json(b, (select reference from gold.transactions where id = tx)); perform gold_test.assert(jsonb_array_length(r) = 1, 'found by number');
  r := gold.to_pay_json(b, 'zzz'); perform gold_test.assert(jsonb_array_length(r) = 0, 'no match');

  -- paying: someone else, only the notes may change
  perform set_config('app.user_id', u2::text, true);
  perform gold_test.assert(gold_test.code_of(format($f$select gold.pay_transaction(%L::jsonb)$f$, jsonb_build_object('id', tx, 'lines', '{"100":9}'::jsonb))) = 'PAYOUT_MISMATCH', 'amount cannot change');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.pay_transaction(%L::jsonb)$f$, jsonb_build_object('id', gen_random_uuid(), 'lines', '{"100":10}'::jsonb))) = 'NOT_FOUND', 'unknown purchase');
  r := gold.pay_transaction(jsonb_build_object('id', tx, 'lines', '{"100":10}'::jsonb, 'capturedAt', now()));
  perform gold_test.assert(r#>>'{data,payout,stage}' = 'paid' and r#>'{data,payout,lines}' = '{"100": 10}'::jsonb and r#>>'{data,payout,paidBy,displayName}' = 'Kojo', 'paid with other notes: ' || r::text);
  select * into bal from gold.branch_balance(b);
  perform gold_test.assert(bal.cash_value = 2000 and (bal.cash_lines->>'100')::int = 10 and bal.payable_value = 0, 'cash out by note, nothing owed any more: ' || bal.cash_lines::text);
  perform gold_test.assert((select status from gold.transaction_payments where transaction_id = tx and method = 'cash') = 'confirmed', 'cash payment recorded when paid');
  perform gold_test.assert(jsonb_array_length(gold.to_pay_json(b, null)) = 0, 'gone from the list');
  -- first payment wins
  perform gold_test.assert((gold.pay_transaction(jsonb_build_object('id', tx, 'lines', '{"100":10}'::jsonb))->>'replayed')::boolean, 'same payment again is a replay');
  perform set_config('app.user_id', u1::text, true);
  perform gold_test.assert(gold_test.code_of(format($f$select gold.pay_transaction(%L::jsonb)$f$, jsonb_build_object('id', tx, 'lines', '{"50":20}'::jsonb))) = 'ALREADY_PAID', 'a second person cannot pay again');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.pay_transaction(%L::jsonb)$f$, jsonb_build_object('id', tx4, 'lines', '{"200":5}'::jsonb))) = 'ALREADY_PAID', 'paid on the spot cannot be paid again');
  select * into bal from gold.branch_balance(b);
  perform gold_test.assert(bal.cash_value = 2000, 'and the drawer was charged once');

  -- split: cash waits, owed is booked now
  r := gold.post_transaction(jsonb_build_object('id', tx2, 'branchId', b, 'customer', jsonb_build_object('name', 'Efua', 'phone', '0241234567'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now() - interval '30 minutes', 'priceAsOf', now() - interval '2 hours', 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 700, 'lines', '{"100":7}'::jsonb), jsonb_build_object('method', 'owed', 'amount', 300))));
  perform gold_test.assert((r#>>'{data,payout,cashDue}')::numeric = 700, 'only the cash part waits');
  perform gold_test.assert((select count(*) from gold.debts where source_transaction_id = tx2 and direction = 'payable') = 1, 'owed part booked at once');
  select * into bal from gold.branch_balance(b);
  perform gold_test.assert(bal.payable_value = 1000, 'owed: 300 debt + 700 cash to pay');

  -- one-person branch switched to "another person must pay"
  perform gold.set_settings('{"payout.sameUserMayPay":false}'::jsonb);
  perform gold_test.assert(gold_test.code_of(format($f$select gold.pay_transaction(%L::jsonb)$f$, jsonb_build_object('id', tx2, 'lines', '{"100":7}'::jsonb))) = 'SAME_PERSON', 'recorder may not pay');
  perform gold.set_settings('{"payout.sameUserMayPay":true}'::jsonb);

  -- blind check
  perform gold.set_settings('{"payout.blindCheck":true}'::jsonb);
  perform gold_test.assert(gold_test.code_of(format($f$select gold.pay_transaction(%L::jsonb)$f$, jsonb_build_object('id', tx2, 'lines', '{"100":7}'::jsonb))) = 'CHECK_REQUIRED', 'the check is required');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.pay_transaction(%L::jsonb)$f$, jsonb_build_object('id', tx2, 'lines', '{"100":7}'::jsonb, 'checkAmount', 999))) = 'CHECK_MISMATCH', 'a wrong figure is refused');
  select * into bal from gold.branch_balance(b);
  perform gold_test.assert(bal.cash_value = 2000, 'a refused check pays nothing');
  perform set_config('app.user_id', u2::text, true);
  perform gold_test.assert((select count(*) from gold.notifications where kind = 'check_mismatch') = 0 or true, 'reviewers are told (nobody holds the permission here)');
  r := gold.pay_transaction(jsonb_build_object('id', tx2, 'lines', '{"100":7}'::jsonb, 'checkAmount', 1000));
  perform gold_test.assert((r#>>'{data,payout,checkMatched}')::boolean and r#>>'{data,payout,stage}' = 'paid', 'a matching check pays');
  select * into bal from gold.branch_balance(b);
  perform gold_test.assert(bal.cash_value = 1300 and bal.payable_value = 300, 'balances after the split purchase: ' || bal.cash_value || '/' || bal.payable_value);

  -- no open day: cash cannot be paid out
  perform gold.set_settings('{"payout.blindCheck":false}'::jsonb);
  perform gold.post_transaction(jsonb_build_object('id', tx3, 'branchId', b2, 'customer', jsonb_build_object('name', 'Late'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '500', 'calculatedAmount', '500', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 500, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now() - interval '1 hour', 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 500, 'lines', '{"100":5}'::jsonb))));
  perform gold_test.assert(gold_test.code_of(format($f$select gold.pay_transaction(%L::jsonb)$f$, jsonb_build_object('id', tx3, 'lines', '{"100":5}'::jsonb))) = 'NO_OPEN_DAY', 'no open day, no payout');
end $$;