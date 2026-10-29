-- A branch with no margin yet is still priced when a reference price arrives; a branch created later starts on the latest price.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); ksi uuid := gen_random_uuid(); r_role uuid := gen_random_uuid(); u uuid := gen_random_uuid();
  r jsonb; nb uuid := gen_random_uuid();
begin
  insert into gold.tenants (id, slug, name) values (t, 'startprice', 'Start Price Gold');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', true), (ksi, t, 'KSI', 'Kumasi', false);
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'director', 'Director');
  insert into gold.role_permissions (tenant_id, role_id, permission) values (t, r_role, 'prices:approve'), (t, r_role, 'branches:manage');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u, t, 'dir', 'Dir', 'x', r_role);
  insert into gold.user_branches (tenant_id, user_id, branch_id) values (t, u, tkw), (t, u, ksi);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{"poundGrams":"7.75","priceReferenceKarat":"23"}');
  set local role gold_app;
  perform set_config('app.user_id', u::text, true);

  -- no branch has a margin: a first reference price still prices both, at margin 0, provisional
  perform gold.set_base_price(11000, now() - interval '1 hour');
  r := gold.current_price(tkw);
  perform gold_test.assert(r is not null and r->>'effectivePrice' = '11000' and r->>'status' = 'provisional', 'first price reaches a branch with no margin: ' || coalesce(r::text, 'null'));
  perform gold_test.assert(gold.current_price(ksi) is not null, 'second branch priced too');

  -- an existing approved margin is still carried unchanged
  perform gold.set_margin(tkw, 50, true);
  perform gold.set_base_price(11100, now() - interval '30 minutes');
  r := gold.current_price(tkw);
  perform gold_test.assert(r->>'effectivePrice' = '11150' and r->>'status' = 'approved', 'margin and status carried: ' || r::text);

  -- a feed price does the same for a branch without a margin
  r := gold.create_branch(jsonb_build_object('id', nb, 'code', 'ACC', 'name', 'Accra'));
  perform gold_test.assert(gold.current_price(nb)->>'effectivePrice' = '11100' and gold.current_price(nb)->>'status' = 'provisional', 'new branch starts on the latest price: ' || coalesce(gold.current_price(nb)::text, 'null'));
  perform gold.feed_apply(11200, now() - interval '10 minutes', '{}'::jsonb, u);
  perform gold_test.assert(gold.current_price(nb)->>'effectivePrice' = '11200', 'feed price reaches the new branch');
  perform gold_test.assert(gold.current_price(tkw)->>'effectivePrice' = '11250' and gold.current_price(tkw)->>'status' = 'provisional', 'feed price carries margin as provisional');
end $$;