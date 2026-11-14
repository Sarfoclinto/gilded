-- B58: each branch's purchases over time as one line per branch, on a shared x axis.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); ksi uuid := gen_random_uuid(); acc uuid := gen_random_uuid();
  r_role uuid := gen_random_uuid(); u uuid := gen_random_uuid(); r jsonb; x text; d1 uuid := gen_random_uuid(); d2 uuid := gen_random_uuid();
begin
  insert into gold.tenants (id, slug, name) values (t, 'perf58', 'Perf Gold');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', false), (ksi, t, 'KSI', 'Kumasi', true), (acc, t, 'ACC', 'Accra', false);
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'director', 'Director');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u, t, 'dir', 'Dir', 'x', r_role);
  insert into gold.user_branches (tenant_id, user_id, branch_id) values (t, u, tkw), (t, u, ksi);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  set local role gold_app;
  perform set_config('app.user_id', u::text, true);

  -- empty: every branch in scope, in code order, with a point for every day
  r := gold.branch_performance_json(jsonb_build_object('scope', jsonb_build_array(tkw, ksi), 'days', 7));
  perform gold_test.assert(r->>'grain' = 'day' and jsonb_array_length(r->'buckets') = 7 and jsonb_array_length(r->'branches') = 2, 'a week is seven day buckets: ' || r::text);
  perform gold_test.assert(r#>>'{branches,0,code}' = 'KSI' and r#>>'{branches,1,code}' = 'TKW', 'branches come in code order so colours stay put');
  perform gold_test.assert(jsonb_array_length(r#>'{branches,0,points}') = 7 and (r#>>'{branches,0,points,0,paid}') = '0', 'empty days are zero points');
  perform gold_test.assert(r#>'{branches,0,best}' = 'null'::jsonb, 'no best day when nothing was bought');

  -- scope is respected
  x := gold_test.code_of(format($q$select gold.branch_performance_json(jsonb_build_object('scope', jsonb_build_array(%L), 'branchIds', jsonb_build_array(%L)))$q$, tkw, acc));
  perform gold_test.assert(x = 'FORBIDDEN', 'a branch outside the scope is refused: ' || x);

  -- grain follows the period, and the period is kept within bounds
  perform gold_test.assert(gold.branch_performance_json(jsonb_build_object('scope', jsonb_build_array(tkw), 'days', 90))->>'grain' = 'week', '90 days are weeks');
  r := gold.branch_performance_json(jsonb_build_object('scope', jsonb_build_array(tkw), 'days', 365));
  perform gold_test.assert(r->>'grain' = 'month' and jsonb_array_length(r->'buckets') between 12 and 13, 'a year is months: ' || (r->'buckets')::text);
  perform gold_test.assert((gold.branch_performance_json(jsonb_build_object('scope', jsonb_build_array(tkw), 'days', 2))->>'days')::int = 7, 'at least 7 days');
  perform gold_test.assert((gold.branch_performance_json(jsonb_build_object('scope', jsonb_build_array(tkw), 'days', 5000))->>'days')::int = 366, 'at most 366 days');

  -- purchases: two at Tarkwa today (one cancelled), one at Kumasi yesterday
  perform gold.open_day(jsonb_build_object('id', d1, 'branchId', tkw, 'businessDate', current_date, 'lines', '{"100":100}'::jsonb, 'capturedAt', now()));
  perform gold.open_day(jsonb_build_object('id', d2, 'branchId', ksi, 'businessDate', current_date, 'lines', '{"100":100}'::jsonb, 'capturedAt', now()));
  perform gold.post_transaction(jsonb_build_object('id', gen_random_uuid(), 'branchId', tkw, 'customer', jsonb_build_object('name', 'Kwesi'),
    'items', jsonb_build_array(gold_test.item(), gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '2000', 'calculatedAmount', '2000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 2000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(), 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 2000, 'lines', '{"100":20}'::jsonb))));
  perform gold.post_transaction(jsonb_build_object('id', gen_random_uuid(), 'branchId', tkw, 'customer', jsonb_build_object('name', 'Yaw'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(), 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb))));
  update gold.transactions set status = 'void', voided_at = now(), voided_by = u, void_reason = 'wrong' where customer_name = 'Yaw';
  perform gold.post_transaction(jsonb_build_object('id', gen_random_uuid(), 'branchId', ksi, 'customer', jsonb_build_object('name', 'Ama'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now() - interval '1 day', 'priceAsOf', now(), 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb))));

  r := gold.branch_performance_json(jsonb_build_object('scope', jsonb_build_array(tkw, ksi), 'days', 7));
  perform gold_test.assert(r#>>'{branches,1,total,paid}' = '2000' and (r#>>'{branches,1,total,count}')::int = 1 and r#>>'{branches,1,total,pounds}' = '2' and r#>>'{branches,1,total,top}' = '15.54',
    'Tarkwa: one purchase counted, the cancelled one left out: ' || (r#>'{branches,1,total}')::text);
  perform gold_test.assert(r#>>'{branches,1,points,6,paid}' = '2000' and r#>>'{branches,1,points,5,paid}' = '0', 'today is the last point');
  perform gold_test.assert(r#>>'{branches,0,points,5,paid}' = '1000' and r#>>'{branches,0,points,6,paid}' = '0', 'Kumasi bought yesterday');
  perform gold_test.assert(r#>>'{branches,1,best,paid}' = '2000' and r#>>'{branches,1,best,date}' = to_char(current_date, 'YYYY-MM-DD'), 'best day');
  perform gold_test.assert(r#>>'{branches,1,previous,paid}' = '0', 'nothing in the period before');

  -- only one branch asked for
  r := gold.branch_performance_json(jsonb_build_object('scope', jsonb_build_array(tkw, ksi), 'branchIds', jsonb_build_array(ksi), 'days', 7));
  perform gold_test.assert(jsonb_array_length(r->'branches') = 1 and r#>>'{branches,0,code}' = 'KSI', 'a single branch');

  -- the purchase before the window counts in "previous" when the window is moved: 7 days as of a week from now
  r := gold.branch_performance_json(jsonb_build_object('scope', jsonb_build_array(ksi), 'days', 7, 'asOf', now() + interval '8 days'));
  perform gold_test.assert(r#>>'{branches,0,total,paid}' = '0' and r#>>'{branches,0,previous,paid}' = '1000', 'last period: ' || (r#>'{branches,0}')::text);
  raise notice 'branch performance ok';
end $$;