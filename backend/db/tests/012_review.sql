-- Review: discrepancy inbox and workflow, branch timeline, between-branches position.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); ksi uuid := gen_random_uuid();
  r_role uuid := gen_random_uuid(); u uuid := gen_random_uuid(); case1 uuid := gen_random_uuid(); case2 uuid := gen_random_uuid();
  a jsonb; pg jsonb; n int;
begin
  insert into gold.tenants (id, slug, name) values (t, 'review', 'Review Gold');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', false), (ksi, t, 'KSI', 'Kumasi', true);
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'manager', 'Manager');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u, t, 'kwame', 'Kwame', 'x', r_role);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  set local role gold_app;
  perform set_config('app.user_id', u::text, true);
  perform gold.open_day(jsonb_build_object('id', gen_random_uuid(), 'branchId', tkw, 'businessDate', current_date, 'lines', '{"100":50}'::jsonb, 'capturedAt', now()));
  insert into gold.discrepancies (id, tenant_id, branch_id, kind, expected, actual, difference, reported_explanation, opened_by)
  values (case1, t, tkw, 'other', 100, 90, -10, 'Short by 10', u), (case2, t, ksi, 'other', 5, 5, 0, 'Other branch', u);

  -- inbox: scope decides what is seen
  a := gold.discrepancies_json(array[tkw], null, null);
  perform gold_test.assert(jsonb_array_length(a) = 1 and a->0->>'branchName' = 'Tarkwa' and a->0->>'status' = 'open', 'inbox shows only the caller''s branch: ' || a::text);
  perform gold_test.assert(jsonb_array_length(gold.discrepancies_json(array[tkw, ksi], null, ksi)) = 1, 'branch filter');
  perform gold_test.assert(gold_test.refuses(format($f$select gold.discrepancy_json(%L, array[%L]::uuid[])$f$, case2, tkw), 'NOT_FOUND'), 'cannot open another branch''s case');

  -- workflow
  a := gold.discrepancy_act(case1, '{"action":"take"}'::jsonb, array[tkw]);
  perform gold_test.assert(a->>'status' = 'under_review' and a#>>'{assignedTo,displayName}' = 'Kwame', 'taken: ' || a::text);
  a := gold.discrepancy_act(case1, '{"action":"note","note":"Counted twice"}'::jsonb, array[tkw]);
  perform gold_test.assert(gold_test.refuses(format($f$select gold.discrepancy_act(%L, '{"action":"note","note":"x"}'::jsonb, array[%L]::uuid[])$f$, case1, tkw), 'VALIDATION_FAILED'), 'note needs text');
  perform gold_test.assert(gold_test.refuses(format($f$select gold.discrepancy_act(%L, '{"action":"resolve","resolutionType":"found","summary":"short"}'::jsonb, array[%L]::uuid[])$f$, case1, tkw), 'VALIDATION_FAILED'), 'resolution needs a real summary');
  perform gold_test.assert(gold_test.refuses(format($f$select gold.discrepancy_act(%L, '{"action":"take"}'::jsonb, array[%L]::uuid[])$f$, case2, tkw), 'NOT_FOUND'), 'cannot act outside scope');
  a := gold.discrepancy_act(case1, '{"action":"resolve","resolutionType":"found","summary":"Found in the other drawer"}'::jsonb, array[tkw]);
  perform gold_test.assert(a->>'status' = 'resolved' and a->>'resolutionType' = 'found', 'resolved');
  perform gold_test.assert(jsonb_array_length(gold.discrepancies_json(array[tkw], null, null)) = 0, 'a resolved case leaves the active inbox');
  perform gold_test.assert(jsonb_array_length(gold.discrepancies_json(array[tkw], 'resolved', null)) = 1, 'and shows under resolved');
  perform gold_test.assert(gold_test.refuses(format($f$select gold.discrepancy_act(%L, '{"action":"resolve","resolutionType":"found","summary":"Found again today"}'::jsonb, array[%L]::uuid[])$f$, case1, tkw), 'CASE_CLOSED'), 'closed cannot be resolved again');
  a := gold.discrepancy_act(case1, '{"action":"reopen","note":"Count was wrong"}'::jsonb, array[tkw]);
  perform gold_test.assert(a->>'status' = 'under_review' and a->>'resolutionType' is null, 'reopened');
  select count(*) into n from jsonb_array_elements(a->'actions') x where x->>'type' in ('opened', 'status_changed', 'note', 'resolved', 'reopened');
  perform gold_test.assert(n >= 5, 'the history keeps every step: ' || (a->'actions')::text);
  a := gold.discrepancy_act(case1, '{"action":"resolve","resolutionType":"written_off","summary":"Loss accepted by management"}'::jsonb, array[tkw]);
  perform gold_test.assert(a->>'status' = 'written_off', 'written off');

  -- timeline
  a := gold.branch_timeline_json(tkw, null, null, null, null, 100);
  perform gold_test.assert(jsonb_array_length(a->'entries') >= 1 and a->'nextBefore' = 'null'::jsonb, 'timeline has the opening entry');
  perform gold_test.assert((a#>>'{entries,0,running,cash}')::numeric = 5000, 'running cash after the opening');
  a := gold.branch_timeline_json(tkw, null, null, 'goods', null, 100);
  perform gold_test.assert(jsonb_array_length(a->'entries') = 0, 'asset filter');
  perform gold_test.assert(gold_test.refuses(format($f$select gold.branch_timeline_json(%L, null, null, 'nonsense', null, 10)$f$, tkw), 'VALIDATION_FAILED'), 'bad asset');
  a := gold.branch_timeline_json(tkw, null, null, null, null, 1);
  perform gold_test.assert(jsonb_array_length(a->'entries') = 1, 'page of one');

  -- position: empty at first, scoped
  pg := gold.interbranch_position_json(array[tkw]);
  perform gold_test.assert(jsonb_typeof(pg) = 'array', 'position is a list');
  raise notice 'ok 012';
end $$;