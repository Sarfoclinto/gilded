-- B4: closing a day with the full reconciliation, the confirmation, sign-off and history. Runs as the application login.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); ksi uuid := gen_random_uuid();
  r_role uuid := gen_random_uuid(); u_teller uuid := gen_random_uuid(); u_mgr uuid := gen_random_uuid();
  d1 uuid := gen_random_uuid(); d2 uuid := gen_random_uuid(); k1 uuid := gen_random_uuid(); k2 uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); c3 uuid := gen_random_uuid(); ck1 uuid := gen_random_uuid(); ck2 uuid := gen_random_uuid();
  r jsonb; bal record; n int; decl jsonb; expl jsonb;
  conf jsonb := jsonb_build_object('accepted', true, 'version', 'v3', 'text', 'I confirm that I have physically verified everything reported.');
begin
  insert into gold.tenants (id, slug, name) values (t, 'closing', 'Closing Gold');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', false), (ksi, t, 'KSI', 'Kumasi', true);
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'teller', 'Teller');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values
    (u_teller, t, 'ama', 'Ama Teller', 'x', r_role), (u_mgr, t, 'kojo', 'Kojo Manager', 'x', r_role);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');

  set local role gold_app;
  perform set_config('app.user_id', u_teller::text, true);

  -- A busy day at Tarkwa: opening count, a purchase and a loan against unrefined gold ---------------------
  perform gold.open_day(jsonb_build_object('id', d1, 'branchId', tkw, 'businessDate', current_date - 5, 'lines', '{"100":100,"20":50}'::jsonb, 'capturedAt', now()));
  perform gold.post_transaction(jsonb_build_object('id', gen_random_uuid(), 'branchId', tkw, 'customer', jsonb_build_object('name', 'Kwesi'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(), 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb))));
  perform gold.issue_loan(jsonb_build_object('id', gen_random_uuid(), 'branchId', tkw, 'principal', 500, 'customer', jsonb_build_object('name', 'Kofi', 'phone', '0200000001'),
    'lines', '{"100":5}'::jsonb, 'reason', 'fees', 'collateral', jsonb_build_object('topWeight', '24.5'), 'capturedAt', now()));

  r := gold.closing_preview(d1);
  perform gold_test.assert(r#>>'{expected,cash,value}' = '9500' and r#>>'{expected,goodsTop}' = '7.77' and r#>>'{expected,goodsValue}' = '1000'
    and r#>>'{expected,debt}' = '500' and r#>>'{expected,custodyTop}' = '24.5' and r#>>'{expected,payable}' = '0', 'the preview shows what the books say: ' || r::text);

  decl := jsonb_build_object('cash', '{"100":84,"20":50}'::jsonb, 'goodsTop', '7.70', 'goodsDown', '0.41', 'goodsValue', '1000', 'debt', '500', 'payable', '0', 'custodyTop', '24.5');

  -- Refusals leave nothing behind --------------------------------------------------------------------------
  perform gold_test.assert(gold_test.code_of(format($f$select gold.close_day(%L::jsonb)$f$, jsonb_build_object('id', c1, 'dayId', d1, 'branchId', tkw, 'declared', decl,
    'explanations', jsonb_build_object('cash', 'one note missing', 'goods_top', 'scale difference'),
    'confirmation', jsonb_build_object('accepted', false, 'version', 'v3', 'text', 'x'), 'capturedAt', now()))) = 'CONFIRMATION_REQUIRED', 'closing needs the confirmation');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.close_day(%L::jsonb)$f$, jsonb_build_object('id', c1, 'dayId', d1, 'branchId', tkw, 'declared', decl,
    'explanations', jsonb_build_object('cash', 'one note missing'), 'confirmation', conf, 'capturedAt', now()))) = 'EXPLANATION_REQUIRED', 'every difference needs its own reason');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.close_day(%L::jsonb)$f$, jsonb_build_object('id', c1, 'dayId', d1, 'branchId', tkw,
    'declared', decl - 'debt', 'confirmation', conf, 'capturedAt', now()))) = 'VALIDATION_FAILED', 'every figure must be reported');
  select count(*) into n from gold.day_reconciliations where business_day_id = d1 and phase = 'closing';
  perform gold_test.assert(n = 0 and (select status from gold.business_days where id = d1) = 'open', 'a refused closing leaves the day open and untouched');
  select * into bal from gold.branch_balance(tkw);
  perform gold_test.assert(bal.cash_value = 9500 and bal.goods_top = 7.77, 'and the books unchanged');

  -- A closing with differences ---------------------------------------------------------------------------------
  expl := jsonb_build_object('cash', 'one 100 note missing from the drawer', 'goods_top', 'the scale reads lower this evening');
  r := gold.close_day(jsonb_build_object('id', c1, 'dayId', d1, 'branchId', tkw, 'declared', decl, 'explanations', expl, 'confirmation', conf, 'capturedAt', now()));
  perform gold_test.assert(r#>>'{data,status}' = 'closed' and r#>>'{data,closing,signoff,status}' = 'pending' and r#>'{data,flags}' @> '"CLOSING_DIFFERS"', 'closed, awaiting sign-off: ' || r::text);
  perform gold_test.assert(r#>>'{data,closing,confirmation,version}' = 'v3' and r#>>'{data,closing,confirmation,text}' like 'I confirm%', 'the wording and its version are kept');
  perform gold_test.assert(jsonb_array_length(r#>'{data,closing,figures}') = 7, 'seven figures');
  perform gold_test.assert((select r2->>'outcome' from jsonb_array_elements(r#>'{data,closing,figures}') r2 where r2->>'asset' = 'cash') = 'shortage'
    and (select r2->>'outcome' from jsonb_array_elements(r#>'{data,closing,figures}') r2 where r2->>'asset' = 'goods_top') = 'shortage'
    and (select count(*) from jsonb_array_elements(r#>'{data,closing,figures}') r2 where r2->>'outcome' = 'balanced') = 5, 'the database labels shortage and balanced');
  perform gold_test.assert(r#>>'{data,closing,cash,expected,100}' = '85' and r#>>'{data,closing,cash,counted,100}' = '84', 'cash expected and counted by note');
  select * into bal from gold.branch_balance(tkw);
  perform gold_test.assert(bal.cash_value = 9400 and bal.goods_top = 7.70 and bal.goods_value = 1000 and bal.debt_value = 500 and bal.custody_top = 24.5,
    'the books now agree with the report: ' || bal.cash_value || '/' || bal.goods_top);
  perform gold_test.assert((select count(*) from gold.ledger_entries where branch_id = tkw and source_type = 'closing_adjustment') = 2, 'originals untouched, adjustments added');
  perform gold_test.assert((select count(*) from gold.discrepancies where business_day_id = d1 and status = 'open' and kind = 'closing_variance') = 2, 'a case for each real difference');
  perform gold_test.assert((select reported_explanation from gold.discrepancies where business_day_id = d1 and asset = 'cash') like 'one 100 note%', 'the teller''s own words are kept');
  perform gold_test.assert((gold.close_day(jsonb_build_object('id', c1, 'dayId', d1, 'branchId', tkw))->>'replayed')::boolean, 'the same command replays');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.close_day(%L::jsonb)$f$, jsonb_build_object('id', gen_random_uuid(), 'dayId', d1, 'branchId', tkw, 'declared', decl,
    'explanations', expl, 'confirmation', conf, 'capturedAt', now()))) = 'DAY_ALREADY_CLOSED', 'a different command cannot close it again');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.record_movement(%L::jsonb)$f$, jsonb_build_object('id', gen_random_uuid(), 'dayId', d1, 'branchId', tkw,
    'kind', 'topup', 'lines', '{"50":1}'::jsonb, 'note', 'late', 'capturedAt', now()))) = 'DAY_CLOSED', 'no drawer movements on a closed day');

  -- Sign-off ------------------------------------------------------------------------------------------------------
  perform gold_test.assert(gold_test.code_of(format($f$select gold.signoff_day(%L, 'approved', null)$f$, d1)) = 'SELF_SIGNOFF', 'the closer cannot sign off their own day');
  perform set_config('app.user_id', u_mgr::text, true);
  perform gold_test.assert(gold_test.code_of(format($f$select gold.signoff_day(%L, 'rejected', 'no')$f$, d1)) = 'VALIDATION_FAILED', 'rejecting needs a real reason');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.signoff_day(%L, 'maybe', null)$f$, d1)) = 'VALIDATION_FAILED', 'only approved or rejected');
  r := gold.signoff_day(d1, 'approved', 'checked the drawer with the teller');
  perform gold_test.assert(r#>>'{closing,signoff,status}' = 'approved' and r#>>'{closing,signoff,by,displayName}' = 'Kojo Manager', 'approved by the manager: ' || r::text);
  perform gold_test.assert(gold_test.code_of(format($f$select gold.signoff_day(%L, 'approved', null)$f$, d1)) = 'NOTHING_TO_SIGN', 'signing twice is refused');
  perform gold_test.assert((select count(*) from gold.discrepancies where business_day_id = d1 and status = 'open') = 2, 'sign-off does not close the cases: they are reviewed separately');
  perform set_config('app.user_id', u_teller::text, true);

  -- Tomorrow starts where today ended -----------------------------------------------------------------------------
  r := gold.open_day(jsonb_build_object('id', d2, 'branchId', tkw, 'businessDate', current_date - 4, 'lines', '{"100":84,"20":50}'::jsonb, 'capturedAt', now()));
  perform gold_test.assert(not (r#>'{data,flags}' @> '"OPENING_DIFFERS"'), 'counting what was reported at close opens without a difference');

  -- Clean closing: everything matches, nothing to review -----------------------------------------------------------
  perform gold.open_day(jsonb_build_object('id', k1, 'branchId', ksi, 'businessDate', current_date - 3, 'lines', '{"100":10}'::jsonb, 'capturedAt', now()));
  r := gold.close_day(jsonb_build_object('id', ck1, 'dayId', k1, 'branchId', ksi, 'capturedAt', now(), 'confirmation', conf,
        'declared', jsonb_build_object('cash', '{"100":10}'::jsonb, 'goodsTop', 0, 'goodsDown', 0, 'goodsValue', 0, 'debt', 0, 'payable', 0, 'custodyTop', 0)));
  perform gold_test.assert(r#>>'{data,closing,signoff,status}' = 'not_required' and not (r#>'{data,flags}' @> '"CLOSING_DIFFERS"'), 'nothing to sign off');
  perform gold_test.assert((select count(*) from gold.discrepancies where branch_id = ksi) = 0 and
    (select count(*) from gold.ledger_entries where branch_id = ksi and source_type = 'closing_adjustment') = 0, 'no cases, no adjustments');

  -- Same value, different notes: still needs a reason and a look, but there is no money to chase ----------------------
  perform gold.open_day(jsonb_build_object('id', k2, 'branchId', ksi, 'businessDate', current_date - 2, 'lines', '{}'::jsonb, 'source', 'carried', 'capturedAt', now()));
  decl := jsonb_build_object('cash', '{"50":20}'::jsonb, 'goodsTop', 0, 'goodsDown', 0, 'goodsValue', 0, 'debt', 0, 'payable', 0, 'custodyTop', 0);
  perform gold_test.assert(gold_test.code_of(format($f$select gold.close_day(%L::jsonb)$f$, jsonb_build_object('id', ck2, 'dayId', k2, 'branchId', ksi, 'declared', decl,
    'confirmation', conf, 'capturedAt', now()))) = 'EXPLANATION_REQUIRED', 'a different mix of notes needs a reason');
  r := gold.close_day(jsonb_build_object('id', ck2, 'dayId', k2, 'branchId', ksi, 'declared', decl, 'explanations', jsonb_build_object('cash', 'changed 100s into 50s at the bank'),
        'confirmation', conf, 'capturedAt', now()));
  perform gold_test.assert(r#>>'{data,closing,signoff,status}' = 'pending' and (select count(*) from gold.discrepancies where branch_id = ksi) = 0,
    'pending sign-off, no discrepancy case');
  select * into bal from gold.branch_balance(ksi);
  perform gold_test.assert(bal.cash_value = 1000 and bal.cash_lines = '{"50":20}'::jsonb, 'the notes on the books follow the count');

  -- Debts, amounts owed and unrefined gold are reconciled too ----------------------------------------------------------
  perform gold.open_day(jsonb_build_object('id', c2, 'branchId', ksi, 'businessDate', current_date - 1, 'lines', '{}'::jsonb, 'source', 'carried', 'capturedAt', now()));
  r := gold.close_day(jsonb_build_object('id', c3, 'dayId', c2, 'branchId', ksi, 'capturedAt', now(), 'confirmation', conf,
        'declared', jsonb_build_object('cash', '{"50":20}'::jsonb, 'goodsTop', 0, 'goodsDown', 0, 'goodsValue', 0, 'debt', 300, 'payable', 0, 'custodyTop', 12),
        'explanations', jsonb_build_object('debt', 'a staff advance not recorded', 'custody_top', 'lump left by a customer, not yet recorded')));
  select * into bal from gold.branch_balance(ksi);
  perform gold_test.assert(bal.debt_value = 300 and bal.custody_top = 12, 'debt and unrefined gold follow the report');
  perform gold_test.assert((select count(*) from gold.discrepancies where branch_id = ksi and status = 'open') = 2, 'a case for each');

  -- History ---------------------------------------------------------------------------------------------------------------
  r := gold.days_json(tkw, null, null, null, 60);
  perform gold_test.assert(jsonb_array_length(r) = 2 and r->0->>'status' = 'open' and r->1->>'status' = 'closed', 'history lists newest first');
  perform gold_test.assert(jsonb_array_length(gold.days_json(ksi, null, null, 'pending', 60)) = 2, 'filter by pending sign-off');
  perform gold_test.assert(jsonb_array_length(gold.days_json(ksi, current_date - 2, current_date - 2, null, 60)) = 1, 'filter by date range');
  reset role;
  raise notice 'day closing: all assertions passed';
end $$;