-- End-to-end accounting scenario for one branch over two days, a transfer between branches, and the safety rules.
-- Every assert states what the business expects. A failure raises an exception and stops the run.
create schema gold_test;

create function gold_test.assert(ok boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'ASSERT FAILED: %', msg; end if; end $$;

-- True when running the statement raises an error (optionally a specific SQLSTATE).
create function gold_test.fails(stmt text, state text default null) returns boolean language plpgsql as $$
begin
  execute stmt;
  return false;
exception when others then
  return state is null or sqlstate = state;
end $$;

create function gold_test.cash(t uuid, b uuid, d uuid, src text, src_id uuid, denom int, cnt int, u uuid)
returns void language sql as $$
  insert into gold.ledger_entries (tenant_id, branch_id, business_day_id, occurred_at, recorded_by, asset, denomination,
                                   delta_count, delta_value, source_type, source_id)
  values (t, b, d, now(), u, 'cash', denom, cnt, denom * cnt, src, src_id)
$$;
create function gold_test.goods(t uuid, b uuid, d uuid, src text, src_id uuid, top numeric, down numeric, val numeric, u uuid)
returns void language sql as $$
  insert into gold.ledger_entries (tenant_id, branch_id, business_day_id, occurred_at, recorded_by, asset, delta_top, delta_down,
                                   delta_value, source_type, source_id)
  values (t, b, d, now(), u, 'goods', top, down, val, src, src_id)
$$;
create function gold_test.debt(t uuid, b uuid, d uuid, src text, src_id uuid, val numeric, u uuid)
returns void language sql as $$
  insert into gold.ledger_entries (tenant_id, branch_id, business_day_id, occurred_at, recorded_by, asset, delta_value, source_type, source_id)
  values (t, b, d, now(), u, 'debt', val, src, src_id)
$$;

do $$
declare
  ta uuid := gen_random_uuid();  tb uuid := gen_random_uuid();
  ksi uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); other_branch uuid := gen_random_uuid();
  r_teller uuid := gen_random_uuid(); r_mgr uuid := gen_random_uuid();
  teller uuid := gen_random_uuid();  mgr uuid := gen_random_uuid();  other_user uuid := gen_random_uuid();
  day1 uuid := gen_random_uuid();  day2 uuid := gen_random_uuid();
  tx1 uuid := gen_random_uuid();   item1 uuid := gen_random_uuid();
  mv1 uuid := gen_random_uuid();   debt1 uuid := gen_random_uuid();   rep1 uuid := gen_random_uuid();
  trf uuid := gen_random_uuid();   line1 uuid := gen_random_uuid();   pay1 uuid := gen_random_uuid();
  rec_cash uuid;  disc uuid;  bal record;  n int;
begin
  -- ---- setup: a company, two branches (Kumasi is the main one), people ----
  insert into gold.tenants (id, slug, name) values (ta, 'demo', 'Demo Gold Ltd'), (tb, 'other', 'Other Co');
  insert into gold.branches (id, tenant_id, code, name, is_main) values (ksi, ta, 'KSI', 'Kumasi', true), (tkw, ta, 'TKW', 'Tarkwa', false), (other_branch, tb, 'ACC', 'Accra', true);
  perform gold_test.assert(gold_test.fails($f$insert into gold.branches (tenant_id, code, name, is_main) select tenant_id, 'X', 'Second main', true from gold.branches where code = 'KSI'$f$, '23505'),
    'a company can have only one main branch');
  insert into gold.roles (id, tenant_id, key, name) values (r_teller, ta, 'teller', 'Teller'), (r_mgr, ta, 'manager', 'Manager'), (gen_random_uuid(), tb, 'teller', 'Teller');
  insert into gold.role_permissions (tenant_id, role_id, permission) values (ta, r_teller, 'transactions:create'), (ta, r_mgr, 'days:signoff');
  perform gold_test.assert(gold_test.fails($f$insert into gold.role_permissions (tenant_id, role_id, permission) select tenant_id, id, 'BadPermission' from gold.roles limit 1$f$, '23514'),
    'permissions must look like resource:action');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values
    (teller, ta, 'ama', 'Ama (Tarkwa)', 'x', r_teller), (mgr, ta, 'kofi', 'Kofi (Manager)', 'x', r_mgr),
    (other_user, tb, 'ama', 'Other tenant Ama', 'x', (select id from gold.roles where tenant_id = tb));  -- same username in another company is fine
  perform gold_test.assert(gold_test.fails(format($f$insert into gold.users (tenant_id, username, display_name, password_hash, role_id) values (%L, 'AMA', 'dup', 'x', %L)$f$, ta, r_teller), '23505'),
    'usernames are unique per company, case-insensitively');
  insert into gold.user_branches (tenant_id, user_id, branch_id, is_primary) values (ta, teller, tkw, true), (ta, mgr, ksi, true), (ta, mgr, tkw, false);
  insert into gold.formula_versions (tenant_id, key, params) values (ta, 'ExcelV1', '{"correctionRate":"0.007"}');
  perform gold_test.assert(gold.next_document_number(ta, 'transaction', tkw, date '2026-10-22') = 1 and gold.next_document_number(ta, 'transaction', tkw, date '2026-10-22') = 2
    and gold.next_document_number(ta, 'transaction', tkw, date '2026-10-23') = 1, 'document numbers count per branch per day');

  -- ---- DAY 1 at Tarkwa: first ever day, opening balance goes into the ledger ----
  insert into gold.business_days (id, tenant_id, branch_id, business_date, opened_at, opened_by) values (day1, ta, tkw, '2026-10-22', now(), teller);
  perform gold_test.cash(ta, tkw, day1, 'go_live_balance', day1, 100, 100, teller);
  perform gold_test.cash(ta, tkw, day1, 'go_live_balance', day1, 50, 20, teller);
  perform gold_test.cash(ta, tkw, day1, 'go_live_balance', day1, 20, 10, teller);
  perform gold_test.cash(ta, tkw, day1, 'go_live_balance', day1, 10, 10, teller);
  perform gold_test.goods(ta, tkw, day1, 'go_live_balance', day1, 1000, 55, 90000, teller);
  perform gold_test.debt(ta, tkw, day1, 'go_live_balance', day1, 2000, teller);
  select * into bal from gold.branch_balance(tkw);
  perform gold_test.assert(bal.cash_value = 11300 and bal.goods_value = 90000 and bal.debt_value = 2000, 'opening balance is the sum of the go-live entries');

  -- the ledger refuses malformed rows
  perform gold_test.assert(gold_test.fails(format($f$insert into gold.ledger_entries (tenant_id, branch_id, occurred_at, asset, denomination, delta_count, delta_value, source_type, source_id) values (%L, %L, now(), 'cash', 100, 3, 999, 'drawer_movement', gen_random_uuid())$f$, ta, tkw), '23514'),
    'cash value must equal denomination x count');
  perform gold_test.assert(gold_test.fails(format($f$insert into gold.ledger_entries (tenant_id, branch_id, occurred_at, asset, delta_value, source_type, source_id) values (%L, %L, now(), 'goods', 5, 'drawer_movement', gen_random_uuid())$f$, ta, tkw), '23514'),
    'a goods row must carry top and down weights');

  -- a purchase: goods in, notes out, all pointing at the transaction
  insert into gold.transactions (id, tenant_id, branch_id, business_day_id, reference, customer_name, formula_version, price_as_of, client_amount, calculated_amount,
                                 payout_policy, payout_strategy, payable, payout_difference, captured_at, created_by)
  values (tx1, ta, tkw, day1, 'TKW-20261022-0001', 'Kofi Mensah', 'ExcelV1', now(), 4080, 4080, 'down', 'prefer-100s', 4080, 0, now(), teller);
  insert into gold.transaction_items (id, tenant_id, transaction_id, line_no, top, down, price, density, karat, purity, net_weight, pounds, amount, location_branch_id)
  values (item1, ta, tx1, 1, 3, 0.17, 11650, 17.64, 21.20, 0.8833, 2.64, 0.38, 4080, tkw);
  perform gold_test.goods(ta, tkw, day1, 'transaction_purchase', tx1, 3, 0.17, 4080, teller);
  perform gold_test.cash(ta, tkw, day1, 'transaction_payout', tx1, 100, -40, teller);
  perform gold_test.cash(ta, tkw, day1, 'transaction_payout', tx1, 50, -1, teller);
  perform gold_test.cash(ta, tkw, day1, 'transaction_payout', tx1, 20, -1, teller);
  perform gold_test.cash(ta, tkw, day1, 'transaction_payout', tx1, 10, -1, teller);
  perform gold_test.assert(gold_test.fails(format($f$insert into gold.transactions (id, tenant_id, branch_id, reference, customer_name, formula_version, price_as_of, client_amount, calculated_amount, payout_policy, payout_strategy, payable, payout_difference, captured_at, created_by) values (gen_random_uuid(), %L, %L, 'TKW-20261022-0001', 'dup', 'ExcelV1', now(), 1, 1, 'down', 'prefer-100s', 0, 0, now(), %L)$f$, ta, tkw, teller), '23505'),
    'a reference number is never reused within a branch');

  -- restock from the safe, a staff advance (cash out, debt up), part repaid (cash in, debt down)
  insert into gold.drawer_movements (id, tenant_id, branch_id, business_day_id, kind, note, occurred_at, created_by) values (mv1, ta, tkw, day1, 'topup', 'Restock from Kumasi', now(), teller);
  perform gold_test.cash(ta, tkw, day1, 'drawer_movement', mv1, 100, 10, teller);
  insert into gold.debts (id, tenant_id, branch_id, party_name, party_type, principal, reason, issued_at, issued_by) values (debt1, ta, tkw, 'Kwame (kitchen)', 'staff', 500, 'Salary advance', now(), teller);
  perform gold_test.cash(ta, tkw, day1, 'debt_issued', debt1, 50, -10, teller);
  perform gold_test.debt(ta, tkw, day1, 'debt_issued', debt1, 500, teller);
  insert into gold.debt_repayments (id, tenant_id, debt_id, amount, received_at, received_by) values (rep1, ta, debt1, 200, now(), teller);
  perform gold_test.cash(ta, tkw, day1, 'debt_repayment', rep1, 100, 2, teller);
  perform gold_test.debt(ta, tkw, day1, 'debt_repayment', rep1, -200, teller);
  perform gold_test.assert((select outstanding from gold.v_debts_outstanding where id = debt1) = 300, 'debt outstanding = principal - repayments');

  select * into bal from gold.branch_balance(tkw);
  perform gold_test.assert(bal.cash_value = 7920, 'cash: 11300 - 4080 + 1000 - 500 + 200 = 7920, got ' || bal.cash_value);
  perform gold_test.assert(bal.cash_lines = '{"100":72,"50":9,"20":9,"10":9}'::jsonb, 'notes by denomination, got ' || bal.cash_lines::text);
  perform gold_test.assert(bal.goods_top = 1003 and bal.goods_down = 55.17 and bal.goods_value = 94080, 'goods balance after one purchase');
  perform gold_test.assert(bal.debt_value = 2300, 'debts: 2000 + 500 - 200');

  -- ---- CLOSING DAY 1: the teller counts one 100-note less than expected ----
  insert into gold.day_balances (tenant_id, business_day_id, kind, cash_lines, cash_value, goods_top, goods_down, goods_value, debt_value, ledger_seq)
  select ta, day1, 'closing_expected', cash_lines, cash_value, goods_top, goods_down, goods_value, debt_value, (select max(seq) from gold.ledger_entries) from gold.branch_balance(tkw);
  insert into gold.day_balances (tenant_id, business_day_id, kind, cash_lines, cash_value, goods_top, goods_down, goods_value, debt_value, captured_by)
  values (ta, day1, 'closing_declared', '{"100":71,"50":9,"20":9,"10":9}', 7820, 1003, 55.17, 94080, 2300, teller);

  perform gold_test.assert(gold_test.fails(format($f$insert into gold.day_reconciliations (tenant_id, business_day_id, phase, asset, expected, actual) values (%L, %L, 'closing', 'cash', 7920, 7820)$f$, ta, day1), '23514'),
    'a shortage without an explanation is rejected');
  perform gold_test.assert(gold_test.fails(format($f$insert into gold.day_reconciliations (tenant_id, business_day_id, phase, asset, expected, actual, explanation, explained_by) values (%L, %L, 'closing', 'cash', 7920, 7820, 'ok', %L)$f$, ta, day1, teller), '23514'),
    'a one-word explanation is rejected');
  insert into gold.day_reconciliations (tenant_id, business_day_id, phase, asset, expected, actual, detail, explanation, explained_by)
  values (ta, day1, 'closing', 'cash', 7920, 7820, '{"100": -1}', 'Customer was given an extra 100 note by mistake, to be recovered', teller)
  returning id into rec_cash;
  insert into gold.day_reconciliations (tenant_id, business_day_id, phase, asset, expected, actual) values
    (ta, day1, 'closing', 'goods_top', 1003, 1003), (ta, day1, 'closing', 'goods_down', 55.17, 55.17),
    (ta, day1, 'closing', 'goods_value', 94080, 94080), (ta, day1, 'closing', 'debt', 2300, 2300);
  perform gold_test.assert((select outcome from gold.day_reconciliations where id = rec_cash) = 'shortage'
    and (select difference from gold.day_reconciliations where id = rec_cash) = -100, 'outcome is computed: shortage of 100');
  perform gold_test.assert((select count(*) from gold.day_reconciliations where business_day_id = day1 and outcome = 'balanced') = 4, 'four assets balanced');
  perform gold_test.assert(gold_test.fails(format($f$update gold.day_reconciliations set explanation = 'rewritten history' where id = %L$f$, rec_cash), '23000'),
    'reconciliation rows cannot be edited afterwards');

  -- the shortage becomes an explicit ledger adjustment, so the ledger now equals what was really there
  perform gold_test.cash(ta, tkw, day1, 'closing_adjustment', day1, 100, -1, teller);
  insert into gold.discrepancies (tenant_id, branch_id, business_day_id, kind, asset, reconciliation_id, expected, actual, difference, reported_explanation, opened_by)
  values (ta, tkw, day1, 'closing_variance', 'cash', rec_cash, 7920, 7820, -100, 'Customer was given an extra 100 note by mistake, to be recovered', teller)
  returning id into disc;

  -- the day cannot be closed without the physical-verification confirmation
  perform gold_test.assert(gold_test.fails(format($f$update gold.business_days set status = 'closed', closed_at = now(), closed_by = %L where id = %L$f$, teller, day1), '23514'),
    'closing without the confirmation is rejected');
  perform gold_test.assert(gold_test.fails(format($f$update gold.business_days set status = 'closed', closed_at = now(), closed_by = %L, closing_confirmed = false, closing_confirmation_version = 'v1', closing_confirmation_text = 'I verified' where id = %L$f$, teller, day1), '23514'),
    'closing with the box unticked is rejected');
  update gold.business_days set status = 'closed', closed_at = now(), closed_by = teller, closing_confirmed = true,
    closing_confirmation_version = 'v1', closing_confirmation_text = 'I confirm I have physically verified and accounted for the cash, goods and debts reported above.',
    signoff_status = 'pending' where id = day1;

  select * into bal from gold.branch_balance(tkw);
  perform gold_test.assert(bal.cash_value = 7820 and bal.cash_lines = '{"100":71,"50":9,"20":9,"10":9}'::jsonb, 'after the adjustment the ledger equals the declared closing count');

  -- ---- the discrepancy case: managers review without touching the original ----
  perform gold_test.assert((select count(*) from gold.discrepancy_actions where discrepancy_id = disc) = 1, 'opening a case logs itself');
  update gold.discrepancies set status = 'under_review', assigned_to = mgr where id = disc;
  perform gold_test.assert(gold_test.fails(format($f$update gold.discrepancies set status = 'resolved', resolved_at = now(), resolved_by = %L, resolution_type = 'recovered', resolution_summary = 'short' where id = %L$f$, mgr, disc), '23514'),
    'a case cannot be closed without a real written resolution');
  perform gold_test.assert(gold_test.fails(format($f$update gold.discrepancies set expected = 1 where id = %L$f$, disc), '23000'),
    'the recorded facts of a case cannot be edited');
  perform gold_test.cash(ta, tkw, null, 'discrepancy_resolution', disc, 100, 1, mgr);   -- customer returned the note next day
  update gold.discrepancies set status = 'resolved', resolved_at = now(), resolved_by = mgr, resolution_type = 'recovered',
    resolution_summary = 'Customer returned the extra GHS 100 note the next morning; verified by the manager.' where id = disc;
  insert into gold.discrepancy_actions (tenant_id, discrepancy_id, action_type, note, ledger_entry_ids, actor_user_id)
  select ta, disc, 'adjustment_posted', 'Recovered note posted back to the drawer', array_agg(id), mgr from gold.ledger_entries where source_type = 'discrepancy_resolution' and source_id = disc;
  perform gold_test.assert((select array_agg(action_type order by id) from gold.discrepancy_actions where discrepancy_id = disc) = array['opened', 'status_changed', 'resolved', 'adjustment_posted'],
    'the full case history is logged automatically, got ' || (select array_agg(action_type order by id)::text from gold.discrepancy_actions where discrepancy_id = disc));
  perform gold_test.assert((select outcome from gold.day_reconciliations where id = rec_cash) = 'shortage', 'the original shortage record is still there after resolution');
  perform gold_test.assert(gold_test.fails(format($f$delete from gold.discrepancies where id = %L$f$, disc), '23000'), 'cases cannot be deleted');

  -- ---- DAY 2: continuity. Opening should equal yesterday's closing; a different count must be explained ----
  perform gold_test.assert(gold_test.fails(format($f$insert into gold.business_days (tenant_id, branch_id, business_date, opened_at, opened_by) values (%L, %L, '2026-10-22', now(), %L)$f$, ta, tkw, teller), '23505'),
    'one day per branch per date');
  insert into gold.business_days (id, tenant_id, branch_id, business_date, previous_day_id, opened_at, opened_by) values (day2, ta, tkw, '2026-10-23', day1, now(), teller);
  perform gold_test.assert(gold_test.fails(format($f$insert into gold.business_days (tenant_id, branch_id, business_date, opened_at, opened_by) values (%L, %L, '2026-10-24', now(), %L)$f$, ta, tkw, teller), '23505'),
    'only one open day per branch');
  insert into gold.day_balances (tenant_id, business_day_id, kind, cash_lines, cash_value, goods_top, goods_down, goods_value, debt_value, ledger_seq)
  select ta, day2, 'opening_expected', cash_lines, cash_value, goods_top, goods_down, goods_value, debt_value, (select max(seq) from gold.ledger_entries) from gold.branch_balance(tkw);
  perform gold_test.assert((select cash_value from gold.day_balances where business_day_id = day2 and kind = 'opening_expected')
                         = (select cash_value from gold.day_balances where business_day_id = day1 and kind = 'closing_declared') + 100,
    'tomorrow expects yesterday closing (plus the recovered note posted since)');
  -- teller counts GHS 50 more than expected: allowed, but only with a reason
  perform gold_test.assert(gold_test.fails(format($f$insert into gold.day_reconciliations (tenant_id, business_day_id, phase, asset, expected, actual) values (%L, %L, 'opening', 'cash', 7920, 7970)$f$, ta, day2), '23514'),
    'an opening that differs from yesterday needs an explanation');
  insert into gold.day_reconciliations (tenant_id, business_day_id, phase, asset, expected, actual, explanation, explained_by)
  values (ta, day2, 'opening', 'cash', 7920, 7970, 'Manager left GHS 50 in the safe drawer overnight', teller);
  perform gold_test.cash(ta, tkw, day2, 'opening_adjustment', day2, 50, 1, teller);
  perform gold_test.assert((select cash_value from gold.branch_balance(tkw)) = 7970, 'opening adjustment aligns the ledger with the opening count');

  -- ---- TRANSFER: Kumasi sends someone to collect the Tarkwa gold ----
  insert into gold.transfers (id, tenant_id, reference, origin_branch_id, destination_branch_id, purpose, method, created_by)
  values (trf, ta, 'TRF-TKW-20261023-0001', tkw, ksi, 'stock_collection', 'collector_from_destination', teller);
  perform gold_test.assert(gold_test.fails(format($f$insert into gold.transfers (tenant_id, reference, origin_branch_id, destination_branch_id, purpose, method, created_by) values (%L, 'X', %L, %L, 'other', 'other', %L)$f$, ta, tkw, tkw, teller), '23514'),
    'a transfer needs two different branches');
  perform gold_test.assert(gold_test.fails(format($f$insert into gold.transfer_goods_lines (id, tenant_id, transfer_id, line_no, released_top, released_down, released_value) values (gen_random_uuid(), %L, %L, 9, 1, 1, 1)$f$, ta, trf), '23514'),
    'a goods line needs an item or a description');
  insert into gold.transfer_goods_lines (id, tenant_id, transfer_id, line_no, transaction_item_id, released_top, released_down, released_value) values (line1, ta, trf, 1, item1, 3, 0.17, 4080);
  perform gold_test.assert(gold_test.fails(format($f$update gold.transfers set status = 'released', released_by = %L, released_at = now() where id = %L$f$, teller, trf), '23514'),
    'releasing without a collector and totals is rejected');
  update gold.transfers set status = 'released', released_by = teller, released_at = now(), collector_type = 'external', collector_name = 'Yaw Boateng',
    collector_phone = '0240000000', collector_id_type = 'Ghana Card', collector_id_number = 'GHA-000000000-0', collector_relationship = 'Sent by Kumasi manager',
    collected_at = now(), declared_top = 3, declared_down = 0.17, declared_value = 4080 where id = trf;
  update gold.transaction_items set location_state = 'in_transit' where id = item1;
  perform gold_test.goods(ta, tkw, day2, 'transfer_release', trf, -3, -0.17, -4080, teller);
  -- GHS 100 handed to the collector for transport, recorded against the transfer
  insert into gold.transfer_payments (id, tenant_id, transfer_id, direction, amount, method, purpose, paid_at, recorded_by) values (pay1, ta, trf, 'paid_to_collector', 100, 'cash', 'Transport', now(), teller);
  perform gold_test.cash(ta, tkw, day2, 'transfer_payment', pay1, 100, -1, teller);
  select * into bal from gold.branch_balance(tkw);
  perform gold_test.assert(bal.goods_top = 1000 and bal.goods_value = 90000, 'goods left Tarkwa at release');

  -- Kumasi receives 0.10 g less than was released
  update gold.transfers set status = 'received_with_discrepancy', received_by = mgr, received_at = now(), received_top = 2.9, received_down = 0.17, received_value = 4080,
    receipt_note = 'Seal intact, weight short by 0.1 g' where id = trf;
  update gold.transfer_goods_lines set received_top = 2.9, received_down = 0.17, received_value = 4080, outcome = 'differs' where id = line1;
  update gold.transaction_items set location_branch_id = ksi, location_state = 'on_hand' where id = item1;
  perform gold_test.goods(ta, ksi, null, 'transfer_receipt', trf, 2.9, 0.17, 4080, mgr);
  insert into gold.discrepancies (tenant_id, branch_id, kind, asset, transfer_id, transfer_line_id, expected, actual, difference, reported_explanation, opened_by)
  values (ta, ksi, 'transfer_receipt', 'goods_top', trf, line1, 3, 2.9, -0.1, 'Seal intact, weight short by 0.1 g', mgr);
  insert into gold.transfer_events (tenant_id, transfer_id, event_type, actor_user_id, occurred_at, data) values
    (ta, trf, 'created', teller, now(), '{}'), (ta, trf, 'released', teller, now(), '{"collector":"Yaw Boateng"}'),
    (ta, trf, 'received', mgr, now(), '{"top":2.9}'), (ta, trf, 'discrepancy_flagged', mgr, now(), '{"line":1}');
  select * into bal from gold.branch_balance(ksi);
  perform gold_test.assert(bal.goods_top = 2.9 and bal.goods_value = 4080, 'goods appear at Kumasi for what was actually received');
  perform gold_test.assert((select location_branch_id from gold.transaction_items where id = item1) = ksi, 'the customer item now shows it is at Kumasi');
  perform gold_test.assert(gold_test.fails(format($f$update gold.transfer_events set event_type = 'note_added' where transfer_id = %L$f$, trf), '23000'), 'transfer history cannot be edited');
  perform gold_test.assert((select count(*) from gold.discrepancies where transfer_id = trf and status = 'open') = 1, 'the short weight opened a case');

  -- ---- the whole-day timeline for a branch, with running balances ----
  select count(*) into n from gold.v_branch_timeline where branch_id = tkw and occurred_at >= now() - interval '1 day';
  perform gold_test.assert(n >= 20, 'timeline lists every ledger movement');
  perform gold_test.assert((select running_cash from gold.v_branch_timeline where branch_id = tkw order by seq desc limit 1) = (select cash_value from gold.branch_balance(tkw)),
    'the last running balance equals the branch balance');

  -- ---- immutability and isolation ----
  perform gold_test.assert(gold_test.fails($f$update gold.ledger_entries set memo = 'edited'$f$, '23000'), 'ledger rows cannot be edited');
  perform gold_test.assert(gold_test.fails($f$delete from gold.ledger_entries$f$, '23000'), 'ledger rows cannot be deleted');
  perform gold_test.assert(gold_test.fails(format($f$insert into gold.ledger_entries (tenant_id, branch_id, occurred_at, asset, delta_value, source_type, source_id) values (%L, %L, now(), 'debt', 1, 'debt_issued', gen_random_uuid())$f$, ta, other_branch), '23503'),
    'a company cannot post to another company''s branch');
  perform gold_test.assert(gold_test.fails(format($f$insert into gold.business_days (tenant_id, branch_id, business_date, opened_at, opened_by) values (%L, %L, '2026-11-01', now(), %L)$f$, ta, ksi, other_user), '23503'),
    'a company cannot use another company''s user');

  -- a reversal must point at what it reverses
  perform gold_test.assert(gold_test.fails(format($f$insert into gold.ledger_entries (tenant_id, branch_id, occurred_at, asset, delta_value, source_type, source_id) values (%L, %L, now(), 'debt', 1, 'reversal', gen_random_uuid())$f$, ta, tkw), '23514'),
    'a reversal without a target is rejected');

  raise notice 'accounting flow: all assertions passed';
end $$;
