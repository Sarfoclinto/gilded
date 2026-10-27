do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); ksi uuid := gen_random_uuid(); r_role uuid := gen_random_uuid(); u uuid := gen_random_uuid();
  r jsonb; n int; ev uuid; bp record;
  good jsonb := jsonb_build_object('kind', 'applied', 'message', 'Read GH₵ 11,194.00', 'basePrice', '11194', 'publishedAt', '2026-10-27T15:00:00Z', 'usdPerOunce', '4057.25', 'rate', '11.55', 'discountPct', '0', 'computed', '11189');
begin
  insert into gold.tenants (id, slug, name) values (t, 'feed', 'Feed Gold');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', false), (ksi, t, 'KSI', 'Kumasi', true);
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'director', 'Director');
  insert into gold.role_permissions (tenant_id, role_id, permission) values (t, r_role, 'prices:approve');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u, t, 'dir', 'Dir', 'x', r_role);
  insert into gold.user_branches (tenant_id, user_id, branch_id) values (t, u, tkw), (t, u, ksi);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{"poundGrams":"7.75","priceReferenceKarat":"23"}');
  set local role gold_app;
  perform set_config('app.user_id', u::text, true);

  -- defaults before anything is saved
  r := gold.price_feed_json();
  perform gold_test.assert(not (r->>'enabled')::boolean and jsonb_array_length(r->'windows') = 2, 'defaults: ' || r::text);

  -- validation
  perform gold_test.assert(gold_test.refuses(format('select gold.set_price_feed_settings(%L::jsonb)', jsonb_build_object('enabled', true, 'weekdays', jsonb_build_array(1),
    'windows', jsonb_build_array(jsonb_build_object('start', '11:00', 'end', '10:00', 'everyMinutes', 5)))::text), 'VALIDATION_FAILED'), 'end before start');
  perform gold_test.assert(gold_test.refuses(format('select gold.set_price_feed_settings(%L::jsonb)', jsonb_build_object('enabled', true, 'weekdays', jsonb_build_array(),
    'windows', jsonb_build_array(jsonb_build_object('start', '10:00', 'end', '11:00', 'everyMinutes', 5)))::text), 'VALIDATION_FAILED'), 'a day is needed');
  perform gold_test.assert(gold_test.refuses(format('select gold.set_price_feed_settings(%L::jsonb)', jsonb_build_object('enabled', true, 'weekdays', jsonb_build_array(1),
    'windows', jsonb_build_array(jsonb_build_object('start', '10:00', 'end', '11:00', 'everyMinutes', 0)))::text), 'VALIDATION_FAILED'), 'interval');

  r := gold.set_price_feed_settings(jsonb_build_object('enabled', true, 'weekdays', jsonb_build_array(1, 2, 3, 4, 5), 'marginPolicy', 'approve', 'maxJumpPct', 8,
    'windows', jsonb_build_array(jsonb_build_object('start', '10:30', 'end', '11:30', 'everyMinutes', 5))));
  perform gold_test.assert((r->>'enabled')::boolean and (r->>'maxJumpPct') = '8' and jsonb_array_length(r->'windows') = 1, 'saved');
  perform gold_test.assert((select count(*) from gold.price_feed_registry) = 1, 'registered for the worker');
  perform gold_test.assert(gold.price_feed_state()->>'actor' = u::text and gold.price_feed_state()->>'poundGrams' = '7.75' and gold.price_feed_state() ? 'latestFeedPublishedAt', 'state for the worker');

  -- a first price and approved margins at both branches
  perform gold.set_base_price(11000, now() - interval '1 day');
  perform gold.set_margin(tkw, 50, true);
  perform gold.set_margin(ksi, 60, true);

  -- applying a price: margins come along as provisional, approvers are told
  r := gold.feed_record(good);
  perform gold_test.assert(r->>'result' = 'applied', 'applied: ' || r::text);
  select * into bp from (select distinct on (branch_id) * from gold.branch_prices where branch_id = tkw order by branch_id, effective_from desc, created_at desc) x;
  perform gold_test.assert(bp.status = 'provisional' and bp.margin = 50 and bp.approved_by is null, 'margin is provisional');
  perform gold_test.assert(gold.current_price(tkw)->>'basePrice' = '11194' and gold.current_price(tkw)->>'source' = 'goldbod' and gold.current_price(tkw)->>'effectivePrice' = '11244', 'new price in force: ' || gold.current_price(tkw)::text);
  select count(*) into n from gold.notifications where kind = 'margin_to_approve';
  perform gold_test.assert(n >= 2, 'approvers notified, got ' || n);
  -- same price twice changes nothing
  r := gold.feed_record(good);
  perform gold_test.assert(r->>'result' = 'unchanged', 'same published time is not applied twice');
  -- approving works as always
  perform gold.approve_margin(tkw);
  perform gold_test.assert(gold.current_price(tkw)->>'status' = 'approved', 'approved');

  -- carry policy keeps approved margins approved
  perform gold.set_price_feed_settings(jsonb_build_object('enabled', true, 'weekdays', jsonb_build_array(1), 'marginPolicy', 'carry',
    'windows', jsonb_build_array(jsonb_build_object('start', '10:30', 'end', '11:30', 'everyMinutes', 5))));
  perform gold.feed_record(good || jsonb_build_object('basePrice', '11200', 'publishedAt', '2026-10-28T10:30:00Z'));
  perform gold_test.assert(gold.current_price(tkw)->>'status' = 'approved' and gold.current_price(ksi)->>'status' = 'provisional', 'carry keeps each status');

  -- a held price is not applied until a director accepts it
  r := gold.feed_record(jsonb_build_object('kind', 'held', 'message', 'Up 30 percent', 'basePrice', '15000', 'publishedAt', '2026-10-29T10:30:00Z', 'usdPerOunce', '5000', 'rate', '12', 'excerpt', 'Total Price Per Pound GHS 15,000'));
  perform gold_test.assert(gold.current_price(tkw)->>'basePrice' = '11200', 'held price not in force');
  perform gold.feed_record(jsonb_build_object('kind', 'held', 'message', 'Up 30 percent', 'basePrice', '15000', 'publishedAt', '2026-10-29T10:30:00Z'));
  select id into ev from gold.price_feed_events where kind = 'held';
  perform gold_test.assert((select count(*) from gold.price_feed_events where kind = 'held') = 1, 'no duplicate held rows');
  perform gold_test.assert((select count(*) from gold.notifications where kind = 'price_held') = 1, 'directors told once');
  r := gold.feed_decide(ev, true);
  perform gold_test.assert(gold.current_price(tkw)->>'basePrice' = '15000', 'accepted price in force');
  perform gold_test.assert(gold_test.refuses(format('select gold.feed_decide(%L, false)', ev), 'ALREADY_DECIDED'), 'decided once');

  -- failures are recorded once until something succeeds
  perform gold.feed_record(jsonb_build_object('kind', 'failed', 'message', 'Could not find the price on the page'));
  perform gold.feed_record(jsonb_build_object('kind', 'failed', 'message', 'Could not find the price on the page'));
  perform gold_test.assert((select count(*) from gold.price_feed_events where kind = 'failed') = 1, 'one failure row');
  perform gold_test.assert((gold.price_feed_json()->>'lastResult') like 'Could not%', 'last result shown');

  -- switching off removes it from the worker's list
  perform gold.set_price_feed_settings(jsonb_build_object('enabled', false, 'weekdays', jsonb_build_array(1), 'windows', jsonb_build_array(jsonb_build_object('start', '10:30', 'end', '11:30', 'everyMinutes', 5))));
  perform gold_test.assert((select count(*) from gold.price_feed_registry) = 0, 'unregistered');
end $$;