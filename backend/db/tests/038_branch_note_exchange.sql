-- Changing notes for the branch itself: both sides equal, different notes, drawer holds what goes out, audited, listed.
do $$
declare
  t uuid := gen_random_uuid(); b uuid := gen_random_uuid(); r_role uuid := gen_random_uuid(); u1 uuid := gen_random_uuid(); d1 uuid := gen_random_uuid();
  e1 uuid := gen_random_uuid(); r jsonb; bal record; tx uuid := gen_random_uuid(); e2 uuid := gen_random_uuid();
begin
  insert into gold.tenants (id, slug, name) values (t, 'swap', 'Swap');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main, timezone) values (b, t, 'TKW', 'Tarkwa', true, 'Africa/Accra');
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'manager', 'Manager');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u1, t, 'ama', 'Ama', 'x', r_role);
  insert into gold.user_branches (tenant_id, user_id, branch_id, is_primary) values (t, u1, b, true);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  set local role gold_app;
  perform set_config('app.user_id', u1::text, true);
  perform gold.open_day(jsonb_build_object('id', d1, 'branchId', b, 'businessDate', current_date, 'lines', '{"100":20,"10":50}'::jsonb, 'capturedAt', now() - interval '2 hours'));
  select * into bal from gold.branch_balance(b);
  perform gold_test.assert(bal.cash_value = 2500, 'start');

  -- the branch hands out 10 x GHS 10 (=100) and gets back a GHS 100: no purchase involved
  r := gold.record_exchange(jsonb_build_object('id', e1, 'dayId', d1, 'branchId', b, 'gave', '{"100":1}'::jsonb, 'took', '{"10":10}'::jsonb, 'capturedAt', now()));
  perform gold_test.assert((r->>'replayed')::boolean = false, 'recorded');
  select * into bal from gold.branch_balance(b);
  perform gold_test.assert(bal.cash_value = 2500 and (bal.cash_lines->>'100')::int = 21 and (bal.cash_lines->>'10')::int = 40, 'same value, different notes: ' || bal.cash_lines::text);
  perform gold_test.assert(gold.record_exchange(jsonb_build_object('id', e1, 'dayId', d1, 'branchId', b, 'gave', '{"100":1}'::jsonb, 'took', '{"10":10}'::jsonb, 'capturedAt', now()))->>'replayed' = 'true', 'sent twice is recorded once');

  -- every exchange is audited
  perform gold_test.assert((select count(*) from gold.audit_events where action = 'drawer.notes_exchanged' and entity_id = e1::text) = 1, 'audit entry written');
  perform gold_test.assert((select after->>'value' from gold.audit_events where action = 'drawer.notes_exchanged' and entity_id = e1::text) = '100', 'audit holds the value');
  perform gold_test.assert((select after->'handedOut' from gold.audit_events where action = 'drawer.notes_exchanged' and entity_id = e1::text) = '{"10":10}'::jsonb, 'and what went out');
  perform gold_test.assert((select actor_user_id from gold.audit_events where action = 'drawer.notes_exchanged' and entity_id = e1::text) = u1, 'and who');

  -- refusals
  perform gold_test.assert(gold_test.code_of(format($q$select gold.record_exchange(%L::jsonb)$q$, jsonb_build_object('id', gen_random_uuid(), 'dayId', d1, 'branchId', b, 'gave', '{"100":1}'::jsonb, 'took', '{"10":9}'::jsonb, 'capturedAt', now()))) = 'EXCHANGE_MISMATCH', 'out must equal in');
  perform gold_test.assert(gold_test.code_of(format($q$select gold.record_exchange(%L::jsonb)$q$, jsonb_build_object('id', gen_random_uuid(), 'dayId', d1, 'branchId', b, 'gave', '{"100":1}'::jsonb, 'took', '{"100":1}'::jsonb, 'capturedAt', now()))) = 'EXCHANGE_SAME_NOTE', 'different notes');
  perform gold_test.assert((select count(*) from gold.audit_events where action = 'drawer.notes_exchanged') = 1, 'refused ones leave no audit entry');

  -- the list
  r := gold.exchanges_json(b, 20);
  perform gold_test.assert(jsonb_array_length(r) = 1 and r->0->>'value' = '100' and r->0->'exchange'->'gave' = '{"100":1}'::jsonb and r->0->'exchange'->'took' = '{"10":10}'::jsonb, 'listed: ' || r::text);
  perform gold_test.assert(r->0#>>'{createdBy,displayName}' = 'Ama', 'with who');
  raise notice 'branch note exchange ok';
end $$;