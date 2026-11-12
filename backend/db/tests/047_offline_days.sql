-- B51: opening and closing the day with no connection (entries arriving through the offline sync).
do $$
declare
  t uuid := gen_random_uuid(); b uuid := gen_random_uuid(); r_role uuid := gen_random_uuid(); r_mgr uuid := gen_random_uuid();
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); mgr uuid := gen_random_uuid();
  d1 uuid := gen_random_uuid(); d2 uuid := gen_random_uuid(); d3 uuid := gen_random_uuid(); d4 uuid := gen_random_uuid(); da uuid := gen_random_uuid();
  c_close1 uuid := gen_random_uuid(); c_close2 uuid := gen_random_uuid(); c_close3 uuid := gen_random_uuid(); c_close4 uuid := gen_random_uuid(); c_late uuid := gen_random_uuid();
  c_mv uuid := gen_random_uuid(); mv uuid := gen_random_uuid(); c_mv2 uuid := gen_random_uuid(); mv2 uuid := gen_random_uuid();
  r jsonb; n int; x text;
  conf jsonb := jsonb_build_object('accepted', true, 'version', 'v3', 'text', 'I confirm that I have physically verified everything reported.');
  auto text := 'Found when the offline count reached the server.';
begin
  insert into gold.tenants (id, slug, name) values (t, 'offdays51', 'Off Days');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (b, t, 'TKW', 'Tarkwa', false);
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'teller', 'Teller'), (r_mgr, t, 'manager', 'Manager');
  insert into gold.role_permissions (tenant_id, role_id, permission) values (t, r_mgr, 'discrepancies:review'), (t, r_mgr, 'days:signoff');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values
    (u1, t, 'ama', 'Ama', 'x', r_role), (u2, t, 'kofi', 'Kofi', 'x', r_role), (mgr, t, 'boss', 'Boss', 'x', r_mgr);
  insert into gold.user_branches (tenant_id, user_id, branch_id) values (t, u1, b), (t, u2, b), (t, mgr, b);
  set local role gold_app;
  perform set_config('app.user_id', u1::text, true);

  -- Day 1 is opened online with GHS 1,000.
  perform gold.open_day(jsonb_build_object('id', d1, 'branchId', b, 'businessDate', current_date - 5, 'lines', '{"100":10}'::jsonb, 'capturedAt', now() - interval '5 days'));

  -- ONLINE stays strict: a count that differs needs a written reason.
  x := gold_test.code_of(format($q$select gold.close_day(jsonb_build_object('id', gen_random_uuid(), 'dayId', '%s', 'branchId', '%s', 'capturedAt', now(),
        'declared', jsonb_build_object('cash', '{"100":9}'::jsonb, 'goodsTop', '0', 'goodsDown', '0', 'goodsValue', '0', 'debt', '0', 'payable', '0', 'custodyTop', '0'),
        'confirmation', '%s'::jsonb))$q$, d1, b, conf));
  perform gold_test.assert(x = 'EXPLANATION_REQUIRED', 'online closing with a difference and no reason is still refused: ' || x);

  -- OFFLINE closing: the count (900) differs from the server's books (1,000) and no reason was written. It is recorded, never refused.
  r := gold.sync_apply(jsonb_build_object('id', c_close1, 'type', 'day.close', 'capturedAt', now() - interval '4 days 12 hours', 'payload',
        jsonb_build_object('id', c_close1, 'dayId', d1, 'branchId', b, 'capturedAt', now() - interval '4 days 12 hours',
          'declared', jsonb_build_object('cash', '{"100":9}'::jsonb, 'goodsTop', '0', 'goodsDown', '0', 'goodsValue', '0', 'debt', '0', 'payable', '0', 'custodyTop', '0'),
          'basis', jsonb_build_object('cash', '{"100":9}'::jsonb), 'confirmation', conf)));
  perform gold_test.assert(r->>'status' = 'applied' and r->'flags' ? 'found-at-sync' and r->'flags' ? 'offline', 'offline closing is applied and marked: ' || r::text);
  r := gold.day_json(d1);
  perform gold_test.assert(r->>'status' = 'closed' and r#>>'{closing,signoff,status}' = 'pending', 'the day is closed and waits for sign-off');
  perform gold_test.assert(r->'flags' ? 'OFFLINE_CLOSE' and r->'flags' ? 'FOUND_AT_SYNC' and r->'flags' ? 'CLOSING_DIFFERS', 'flags: ' || (r->'flags')::text);
  perform gold_test.assert((select explanation from gold.day_reconciliations where business_day_id = d1 and phase = 'closing' and asset = 'cash') = auto, 'the reason says it was found at sync');
  perform gold_test.assert((select difference from gold.discrepancies where business_day_id = d1 and kind = 'closing_variance' and asset = 'cash') = -100, 'a difference was opened for the manager');
  perform gold_test.assert((select closing_basis from gold.business_days where id = d1) = '{"cash":{"100":9}}'::jsonb, 'what the device showed is kept');
  perform gold_test.assert((select count(*) from gold.notifications where kind = 'offline_count' and user_id = mgr) = 1, 'the manager is told');
  select (gold.branch_balance(b)).cash_value into n; perform gold_test.assert(n = 900, 'the books follow the count');

  -- OFFLINE opening of the next day, matching the books: nothing to find.
  r := gold.sync_apply(jsonb_build_object('id', d2, 'type', 'day.open', 'capturedAt', now() - interval '4 days', 'payload',
        jsonb_build_object('id', d2, 'branchId', b, 'businessDate', current_date - 4, 'lines', '{"100":9}'::jsonb, 'source', 'counted', 'capturedAt', now() - interval '4 days')));
  perform gold_test.assert(r->>'status' = 'applied' and not r->'flags' ? 'found-at-sync', 'matching offline opening: ' || r::text);
  perform gold_test.assert(gold.day_json(d2)->'flags' ? 'OFFLINE_ENTRY' and not gold.day_json(d2)->'flags' ? 'FOUND_AT_SYNC', 'opened offline, nothing found');

  -- TWO COMPUTERS, entries arriving out of order. Kofi's computer sends first: a cash top-up for day 3 and the opening of day 3,
  -- while Ama's computer still holds the closing of day 2.
  perform set_config('app.user_id', u2::text, true);
  r := gold.sync_apply(jsonb_build_object('id', c_mv, 'type', 'drawer.movement', 'capturedAt', now() - interval '3 days', 'payload',
        jsonb_build_object('id', mv, 'dayId', d3, 'branchId', b, 'kind', 'topup', 'note', 'Float from the bank', 'lines', '{"100":1}'::jsonb, 'capturedAt', now() - interval '3 days')));
  perform gold_test.assert(r->>'status' = 'held', 'a movement for a day that has not arrived waits: ' || r::text);
  r := gold.sync_apply(jsonb_build_object('id', d3, 'type', 'day.open', 'capturedAt', now() - interval '3 days 2 hours', 'payload',
        jsonb_build_object('id', d3, 'branchId', b, 'businessDate', current_date - 3, 'lines', '{"100":9}'::jsonb, 'source', 'counted', 'capturedAt', now() - interval '3 days 2 hours')));
  perform gold_test.assert(r->>'status' = 'held' and r->>'code' = 'DAY_ALREADY_OPEN', 'the next opening waits for the closing before it: ' || r::text);
  -- Ama's closing of day 2 arrives: the server then puts the opening and the movement in by itself.
  perform set_config('app.user_id', u1::text, true);
  r := gold.sync_apply(jsonb_build_object('id', c_close2, 'type', 'day.close', 'capturedAt', now() - interval '3 days 12 hours', 'payload',
        jsonb_build_object('id', c_close2, 'dayId', d2, 'branchId', b, 'capturedAt', now() - interval '3 days 12 hours',
          'declared', jsonb_build_object('cash', '{"100":9}'::jsonb, 'goodsTop', '0', 'goodsDown', '0', 'goodsValue', '0', 'debt', '0', 'payable', '0', 'custodyTop', '0'), 'confirmation', conf)));
  perform gold_test.assert(r->>'status' = 'applied' and not r->'flags' ? 'found-at-sync', 'closing of day 2: ' || r::text);
  perform gold_test.assert((select status from gold.business_days where id = d3) = 'open', 'day 3 was opened by the server from the waiting entry');
  perform gold_test.assert((select opened_by from gold.business_days where id = d3) = u2, 'under the person who opened it');
  perform gold_test.assert((select business_day_id from gold.drawer_movements where id = mv) = d3, 'and the waiting movement went into day 3');
  perform gold_test.assert((select count(*) from gold.sync_commands where status = 'held') = 0, 'nothing is left waiting');
  perform gold_test.assert((select bool_and('auto-retried' = any(flags)) from gold.sync_commands where id in (c_mv, d3)), 'both marked as applied by the server');
  perform gold_test.assert(gold.current_actor() = u1, 'the current person is unchanged');
  select (gold.branch_balance(b)).cash_value into n; perform gold_test.assert(n = 1000, 'books: 900 + 100');

  -- Close day 3 (matches), then open day 4 OFFLINE with a count that differs from the books and no reason.
  r := gold.sync_apply(jsonb_build_object('id', c_close3, 'type', 'day.close', 'capturedAt', now() - interval '2 days 12 hours', 'payload',
        jsonb_build_object('id', c_close3, 'dayId', d3, 'branchId', b, 'capturedAt', now() - interval '2 days 12 hours',
          'declared', jsonb_build_object('cash', '{"100":10}'::jsonb, 'goodsTop', '0', 'goodsDown', '0', 'goodsValue', '0', 'debt', '0', 'payable', '0', 'custodyTop', '0'), 'confirmation', conf)));
  perform gold_test.assert(r->>'status' = 'applied', 'closing of day 3: ' || r::text);
  x := gold_test.code_of(format($q$select gold.open_day(jsonb_build_object('id', gen_random_uuid(), 'branchId', '%s', 'businessDate', current_date - 2, 'lines', '{"100":8}'::jsonb, 'capturedAt', now()))$q$, b));
  perform gold_test.assert(x = 'EXPLANATION_REQUIRED', 'online opening with a difference and no reason is still refused: ' || x);
  r := gold.sync_apply(jsonb_build_object('id', d4, 'type', 'day.open', 'capturedAt', now() - interval '2 days', 'payload',
        jsonb_build_object('id', d4, 'branchId', b, 'businessDate', current_date - 2, 'lines', '{"100":8}'::jsonb, 'source', 'counted',
          'basis', jsonb_build_object('cash', '{"100":8}'::jsonb), 'capturedAt', now() - interval '2 days')));
  perform gold_test.assert(r->>'status' = 'applied' and r->'flags' ? 'found-at-sync', 'offline opening with an unseen difference is recorded: ' || r::text);
  perform gold_test.assert((select difference from gold.discrepancies where business_day_id = d4 and kind = 'opening_variance') = -200, 'a difference was opened for the opening');
  perform gold_test.assert(gold.day_json(d4)->'flags' ? 'FOUND_AT_SYNC' and gold.day_json(d4)->'flags' ? 'OPENING_DIFFERS', 'day 4 is flagged');
  perform gold_test.assert((select count(*) from gold.notifications where kind = 'offline_count' and user_id = mgr) = 2, 'the manager is told again');

  -- BOTH SIDES OPENED THE SAME DATE. Day 4 is the day (it arrived first). Another computer opened the same date offline as "da".
  perform set_config('app.user_id', u2::text, true);
  r := gold.sync_apply(jsonb_build_object('id', da, 'type', 'day.open', 'capturedAt', now() - interval '47 hours', 'payload',
        jsonb_build_object('id', da, 'branchId', b, 'businessDate', current_date - 2, 'lines', '{"100":7}'::jsonb, 'source', 'counted', 'capturedAt', now() - interval '47 hours')));
  perform gold_test.assert(r->>'status' = 'applied' and r->'flags' ? 'merged-into-open-day', 'the second opening is merged, not refused: ' || r::text);
  perform gold_test.assert(not exists (select 1 from gold.business_days where id = da), 'no second day was made');
  perform gold_test.assert(gold.resolve_day(da) = d4, 'its id now means day 4');
  perform gold_test.assert((select differs from gold.day_counts where id = da and kind = 'second_open'), 'its count is kept, and differs');
  perform gold_test.assert((select difference from gold.discrepancies where business_day_id = d4 and kind = 'other' and asset = 'cash') = -100, 'difference between the two opening counts (800 vs 700)');
  perform gold_test.assert((select count(*) from gold.notifications where kind = 'offline_day_merged' and user_id = mgr) = 1, 'the manager is told about the double opening');
  r := gold.sync_apply(jsonb_build_object('id', gen_random_uuid(), 'type', 'day.open', 'capturedAt', now(), 'payload',
        jsonb_build_object('id', da, 'branchId', b, 'businessDate', current_date - 2, 'lines', '{"100":7}'::jsonb, 'capturedAt', now() - interval '47 hours')));
  perform gold_test.assert(r->>'status' = 'applied' and r->'flags' ? 'already-recorded', 'sending the merged opening again changes nothing: ' || r::text);
  perform gold_test.assert((select count(*) from gold.day_counts where day_id = d4) = 1, 'still one second count');
  -- entries made under the merged id join day 4
  r := gold.sync_apply(jsonb_build_object('id', c_mv2, 'type', 'drawer.movement', 'capturedAt', now() - interval '46 hours', 'payload',
        jsonb_build_object('id', mv2, 'dayId', da, 'branchId', b, 'kind', 'withdrawal', 'note', 'To the bank', 'lines', '{"100":1}'::jsonb, 'capturedAt', now() - interval '46 hours')));
  perform gold_test.assert(r->>'status' = 'applied' and (select business_day_id from gold.drawer_movements where id = mv2) = d4, 'a movement under the merged id lands in day 4: ' || r::text);
  -- and its closing closes day 4
  r := gold.sync_apply(jsonb_build_object('id', c_close4, 'type', 'day.close', 'capturedAt', now() - interval '36 hours', 'payload',
        jsonb_build_object('id', c_close4, 'dayId', da, 'branchId', b, 'capturedAt', now() - interval '36 hours',
          'declared', jsonb_build_object('cash', '{"100":7}'::jsonb, 'goodsTop', '0', 'goodsDown', '0', 'goodsValue', '0', 'debt', '0', 'payable', '0', 'custodyTop', '0'), 'confirmation', conf)));
  perform gold_test.assert(r->>'status' = 'applied' and (select status from gold.business_days where id = d4) = 'closed', 'a closing under the merged id closes day 4: ' || r::text);
  perform gold_test.assert(gold.day_json(d4)->'flags' ? 'SECOND_COUNT', 'day 4 shows it has a second count');

  -- THE DAY WAS ALREADY CLOSED. Ama's computer also closed day 4, later, with a different count.
  perform set_config('app.user_id', u1::text, true);
  r := gold.sync_apply(jsonb_build_object('id', c_late, 'type', 'day.close', 'capturedAt', now() - interval '35 hours', 'payload',
        jsonb_build_object('id', c_late, 'dayId', d4, 'branchId', b, 'capturedAt', now() - interval '35 hours',
          'declared', jsonb_build_object('cash', '{"100":6}'::jsonb, 'goodsTop', '0', 'goodsDown', '0', 'goodsValue', '0', 'debt', '0', 'payable', '0', 'custodyTop', '0'),
          'explanations', jsonb_build_object('cash', 'One note was torn'), 'confirmation', conf)));
  perform gold_test.assert(r->>'status' = 'applied' and r->'flags' ? 'second-count', 'a closing for a closed day is kept as a second count: ' || r::text);
  perform gold_test.assert((select closing_command_id from gold.business_days where id = d4) = c_close4, 'the day keeps the closing it was closed on');
  perform gold_test.assert((select differs from gold.day_counts where id = c_late and kind = 'second_close'), 'the second count is kept, and differs');
  perform gold_test.assert((select count(*) from gold.discrepancies where business_day_id = d4 and kind = 'other' and asset = 'cash' and difference = -100
                              and reported_explanation like 'One note was torn%') = 1, 'difference between the two closing counts, with the teller''s words');
  select (gold.branch_balance(b)).cash_value into n; perform gold_test.assert(n = 700, 'the books are not changed by a second count');
  r := gold.sync_apply(jsonb_build_object('id', gen_random_uuid(), 'type', 'day.close', 'capturedAt', now(), 'payload',
        jsonb_build_object('id', c_late, 'dayId', d4, 'branchId', b, 'capturedAt', now(),
          'declared', jsonb_build_object('cash', '{"100":6}'::jsonb, 'goodsTop', '0', 'goodsDown', '0', 'goodsValue', '0', 'debt', '0', 'payable', '0', 'custodyTop', '0'), 'confirmation', conf)));
  perform gold_test.assert(r->'flags' ? 'already-recorded' and (select count(*) from gold.day_counts where day_id = d4 and kind = 'second_close') = 1, 'sending it again adds nothing: ' || r::text);
  -- online, a closed day is still simply closed
  x := gold_test.code_of(format($q$select gold.close_day(jsonb_build_object('id', gen_random_uuid(), 'dayId', '%s', 'branchId', '%s', 'capturedAt', now(),
        'declared', jsonb_build_object('cash', '{"100":7}'::jsonb, 'goodsTop', '0', 'goodsDown', '0', 'goodsValue', '0', 'debt', '0', 'payable', '0', 'custodyTop', '0'),
        'confirmation', '%s'::jsonb))$q$, d4, b, conf));
  perform gold_test.assert(x = 'DAY_ALREADY_CLOSED', 'online, closing a closed day is still refused: ' || x);
  perform gold_test.assert((select count(*) from gold.audit_events where action in ('day.merged', 'day.second_close')) = 2, 'both audited');
  raise notice 'offline days ok';
end $$;