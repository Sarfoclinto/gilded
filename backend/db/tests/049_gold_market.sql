-- B55: the price a branch has paid over time, and what it bought each day.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); ksi uuid := gen_random_uuid(); r_role uuid := gen_random_uuid(); u uuid := gen_random_uuid();
  r jsonb; x text;
begin
  insert into gold.tenants (id, slug, name) values (t, 'market', 'Market Gold');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', false), (ksi, t, 'KSI', 'Kumasi', true);
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'director', 'Director');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u, t, 'dir', 'Dir', 'x', r_role);
  insert into gold.user_branches (tenant_id, user_id, branch_id) values (t, u, tkw), (t, u, ksi);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  set local role gold_app;
  perform set_config('app.user_id', u::text, true);

  perform gold_test.assert(gold.setting('market.worldChart') = 'true'::jsonb, 'the world chart is on by default');
  perform gold.set_settings('{"market.worldChart": false}'::jsonb);
  perform gold_test.assert(gold.setting('market.worldChart') = 'false'::jsonb, 'and a director can switch it off');
  perform gold_test.assert(gold_test.code_of($q$select gold.set_settings('{"market.worldChart": "no"}'::jsonb)$q$) = 'VALIDATION_FAILED', 'it is a yes/no setting');

  r := gold.price_history_json(tkw, 30);
  perform gold_test.assert(jsonb_array_length(r->'points') = 0 and jsonb_array_length(r->'daily') = 0 and (r->>'days')::int = 30, 'nothing yet: ' || r::text);
  perform gold_test.assert(gold_test.code_of(format($q$select gold.price_history_json(%L, 30)$q$, gen_random_uuid())) = 'NOT_FOUND', 'unknown branch');

  -- GoldBod 11,000 + margin 100, then GoldBod moves to 11,200 (the margin is kept), then the margin changes to 150
  perform gold.set_base_price(11000, now() - interval '3 days');
  perform gold.set_margin(tkw, 100, true);
  perform gold.set_base_price(11200, now() - interval '1 day');
  perform gold.set_margin(tkw, 150, true);
  r := gold.price_history_json(tkw, 30);
  -- (a new GoldBod price gives every branch a starting price with no margin, waiting for approval; then the margin is set)
  perform gold_test.assert(jsonb_array_length(r->'points') = 4 and (r#>>'{points,0,price}')::numeric = 11000 and r#>>'{points,0,status}' = 'provisional'
    and (r#>>'{points,1,price}')::numeric = 11100 and (r#>>'{points,1,margin}')::numeric = 100 and (r#>>'{points,2,price}')::numeric = 11300,
    'every change is a point, in order: ' || (r->'points')::text);
  perform gold_test.assert((select (p->>'price')::numeric from jsonb_array_elements(r->'points') with ordinality as z(p, n) order by n desc limit 1) = 11350, 'the last point is the price in force now');
  perform gold_test.assert((select bool_and((p->>'price')::numeric = (p->>'base')::numeric + (p->>'margin')::numeric) from jsonb_array_elements(r->'points') p), 'price is always base + margin');
  perform gold_test.assert((r#>>'{points,0,source}') in ('goldbod', 'manual') and (r#>>'{points,0,status}') in ('approved', 'provisional'), 'each point says where it came from');
  perform gold_test.assert((select bool_and((p->>'margin')::numeric = 0) from jsonb_array_elements(gold.price_history_json(ksi, 30)->'points') p), 'another branch has its own history (no margin set there)');
  perform gold_test.assert((select (p->>'price') from jsonb_array_elements(r->'points') with ordinality as z(p, n) order by n desc limit 1) = (gold.current_price(tkw)->>'effectivePrice'), 'the last point equals the current price');

  -- what was bought: two purchases today (7.77 g at 11,650 each in the test item), one of them cancelled later is left out
  perform gold.open_day(jsonb_build_object('id', gen_random_uuid(), 'branchId', tkw, 'businessDate', current_date, 'lines', '{"100":100}'::jsonb, 'capturedAt', now()));
  perform gold.post_transaction(jsonb_build_object('id', gen_random_uuid(), 'branchId', tkw, 'customer', jsonb_build_object('name', 'Ama'),
    'items', jsonb_build_array(gold_test.item(), gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '2000', 'calculatedAmount', '2000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 2000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(), 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 2000, 'lines', '{"100":20}'::jsonb))));
  perform gold.post_transaction(jsonb_build_object('id', gen_random_uuid(), 'branchId', tkw, 'customer', jsonb_build_object('name', 'Kofi'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(), 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb))));
  r := gold.price_history_json(tkw, 7);
  perform gold_test.assert(jsonb_array_length(r->'daily') = 1 and (r#>>'{daily,0,purchases}')::int = 2 and (r#>>'{daily,0,top}')::numeric = 23.31
    and (r#>>'{daily,0,amount}')::numeric = 3000 and (r#>>'{daily,0,avgPrice}')::numeric = 11650, 'today: 2 purchases, 3 pieces, GHS 3,000, average price per pound: ' || (r->'daily')::text);

  -- the period is kept within bounds, and a short period still starts from the price that was in force
  perform gold_test.assert((gold.price_history_json(tkw, 100000)->>'days')::int = 730 and (gold.price_history_json(tkw, 0)->>'days')::int = 1, 'days kept between 1 and 730');
  r := gold.price_history_json(tkw, 1);
  perform gold_test.assert(jsonb_array_length(r->'points') >= 1, 'a short period still knows the price it starts with: ' || (r->'points')::text);
  raise notice 'gold market ok';
end $$;