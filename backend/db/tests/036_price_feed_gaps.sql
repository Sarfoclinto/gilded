-- Price feed gaps: a decided held price is not held again, a continuing failure is repeated now and then, a window with no price is reported once.
do $$
declare
  t uuid := gen_random_uuid(); b uuid := gen_random_uuid(); r_role uuid := gen_random_uuid(); u uuid := gen_random_uuid();
  r jsonb; ev uuid; n int; tomorrow date := (now() at time zone 'Africa/Accra')::date + 1;
  held jsonb := jsonb_build_object('kind', 'held', 'message', 'Far from the current price', 'basePrice', '13500', 'publishedAt', '2026-10-27T15:00:00Z', 'usdPerOunce', '4500', 'rate', '11.55', 'discountPct', '0', 'computed', '13400');
begin
  insert into gold.tenants (id, slug, name) values (t, 'feedgaps', 'Feed gaps');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (b, t, 'TKW', 'Tarkwa', true);
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'director', 'Director');
  insert into gold.role_permissions (tenant_id, role_id, permission) values (t, r_role, 'prices:approve');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u, t, 'dir', 'Dir', 'x', r_role);
  insert into gold.user_branches (tenant_id, user_id, branch_id) values (t, u, b);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{"poundGrams":"7.75","priceReferenceKarat":"23"}');
  set local role gold_app;
  perform set_config('app.user_id', u::text, true);
  perform gold.set_price_feed_settings(jsonb_build_object('enabled', true, 'weekdays', jsonb_build_array(1, 2, 3, 4, 5, 6, 7), 'marginPolicy', 'approve', 'maxJumpPct', 8,
    'windows', jsonb_build_array(jsonb_build_object('start', '10:30', 'end', '11:30', 'everyMinutes', 5))));
  perform gold.set_base_price(11000, now() - interval '1 day');

  -- 1. a price held once stays decided
  perform gold.feed_record(held);
  select count(*) into n from gold.notifications where kind = 'price_held';
  perform gold_test.assert(n = 1, 'held and announced once');
  perform gold.feed_record(held);
  perform gold_test.assert((select count(*) from gold.price_feed_events where kind = 'held') = 1, 'the same held price waiting is not added again');
  select id into ev from gold.price_feed_events where kind = 'held';
  perform gold.feed_decide(ev, false);
  perform gold.feed_record(held);
  perform gold_test.assert((select count(*) from gold.price_feed_events where kind = 'held') = 1, 'a dismissed price is not held again');
  perform gold_test.assert((select count(*) from gold.notifications where kind = 'price_held') = 1, 'and not announced again');
  perform gold.feed_record(held || jsonb_build_object('basePrice', '13600', 'publishedAt', '2026-10-27T16:00:00Z'));
  perform gold_test.assert((select count(*) from gold.price_feed_events where kind = 'held') = 2, 'a different price is held as before');

  -- 2. failures: told once, again after three hours
  perform gold.feed_record('{"kind":"failed","message":"GoldBod could not be reached."}'::jsonb);
  perform gold.feed_record('{"kind":"failed","message":"GoldBod could not be reached."}'::jsonb);
  perform gold_test.assert((select count(*) from gold.notifications where kind = 'price_feed_failed') = 1, 'one announcement while it keeps failing');
  update gold.price_feed_events set at = now() - interval '4 hours' where kind = 'failed';
  perform gold.feed_record('{"kind":"failed","message":"GoldBod could not be reached."}'::jsonb);
  perform gold_test.assert((select count(*) from gold.notifications where kind = 'price_feed_failed') = 2, 'announced again when it is still failing hours later');

  -- 3. a window with nothing in it
  r := gold.feed_missed_check((tomorrow::text || ' 09:00 Africa/Accra')::timestamptz);
  perform gold_test.assert(r->>'result' = 'no window has ended', 'nothing to judge before the first window of the day ends: ' || r::text);
  r := gold.feed_missed_check((tomorrow::text || ' 12:00 Africa/Accra')::timestamptz);
  perform gold_test.assert(r->>'result' = 'missed', 'a window that ended with nothing in it is missed: ' || r::text);
  perform gold_test.assert((select count(*) from gold.notifications where kind = 'price_feed_missed') = 1, 'directors told');
  perform gold_test.assert((select count(*) from gold.price_feed_events where kind = 'missed') = 1 , 'recorded');
  r := gold.feed_missed_check((tomorrow::text || ' 12:05 Africa/Accra')::timestamptz);
  perform gold_test.assert(r->>'result' = 'something happened', 'told once per window: ' || r::text);
  perform gold_test.assert((select count(*) from gold.notifications where kind = 'price_feed_missed') = 1, 'not told again');
  raise notice 'price feed gaps ok';
end $$;