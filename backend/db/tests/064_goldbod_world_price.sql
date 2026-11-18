-- B73: the price history carries GoldBod's own world price (USD per ounce) and dollar rate, with the time GoldBod published them.
do $$
declare
  t uuid := gen_random_uuid(); b uuid := gen_random_uuid(); r_role uuid := gen_random_uuid(); u uuid := gen_random_uuid();
  r jsonb;
begin
  insert into gold.tenants (id, slug, name) values (t, 'gbusd', 'GoldBod USD');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (b, t, 'TKW', 'Tarkwa', true);
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'director', 'Director');
  insert into gold.role_permissions (tenant_id, role_id, permission) values (t, r_role, 'prices:approve');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u, t, 'dir', 'Dir', 'x', r_role);
  insert into gold.user_branches (tenant_id, user_id, branch_id) values (t, u, b);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{"poundGrams":"7.75","priceReferenceKarat":"23"}');
  set local role gold_app;
  perform set_config('app.user_id', u::text, true);
  perform gold.set_price_feed_settings(jsonb_build_object('enabled', true, 'weekdays', jsonb_build_array(1, 2, 3, 4, 5, 6, 7), 'marginPolicy', 'approve', 'maxJumpPct', 50,
    'windows', jsonb_build_array(jsonb_build_object('start', '10:30', 'end', '11:30', 'everyMinutes', 5))));

  -- a price typed in by hand has no dollar figure
  perform gold.set_base_price(11000, now() - interval '2 days');
  r := gold.price_history_json(b, 30);
  perform gold_test.assert(r ? 'goldbod' and jsonb_typeof(r->'goldbod') = 'null', 'no GoldBod reading yet: ' || coalesce(r->>'goldbod', 'null'));

  -- two readings from GoldBod: the newest one is returned
  perform gold.feed_record(jsonb_build_object('kind', 'applied', 'message', 'ok', 'basePrice', '11100', 'publishedAt', (now() - interval '1 day')::text,
    'usdPerOunce', 3701.10, 'rate', 11.5, 'discountPct', 0, 'computed', 11100));
  perform gold.feed_record(jsonb_build_object('kind', 'applied', 'message', 'ok', 'basePrice', '11200', 'publishedAt', (now() - interval '2 hours')::text,
    'usdPerOunce', 3759.35, 'rate', 11.55, 'discountPct', 0, 'computed', 11200));
  r := gold.price_history_json(b, 30);
  perform gold_test.assert((r#>>'{goldbod,usdPerOunce}')::numeric = 3759.35 and (r#>>'{goldbod,rate}')::numeric = 11.55, 'the newest GoldBod figure: ' || (r->'goldbod')::text);
  perform gold_test.assert(abs(extract(epoch from (r#>>'{goldbod,publishedAt}')::timestamptz - (now() - interval '2 hours'))) < 2, 'with the time GoldBod published it');

  -- a later price typed in by hand does not hide GoldBod's last figure
  perform gold.set_base_price(11300, now() - interval '1 hour');
  r := gold.price_history_json(b, 30);
  perform gold_test.assert((r#>>'{goldbod,usdPerOunce}')::numeric = 3759.35, 'still the last GoldBod figure after a manual price');
  raise notice 'goldbod world price ok';
end $$;