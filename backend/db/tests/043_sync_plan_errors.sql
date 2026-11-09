-- An entry the server already found invalid (planError) is recorded as rejected with the real reason, nothing is run, and a manager is told.
do $$
declare
  t uuid := gen_random_uuid(); b uuid := gen_random_uuid(); r_role uuid := gen_random_uuid(); u1 uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); r jsonb;
begin
  insert into gold.tenants (id, slug, name) values (t, 'planco', 'Plan');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main, timezone) values (b, t, 'TKW', 'Tarkwa', true, 'Africa/Accra');
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'director', 'Director');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u1, t, 'dir', 'Dir', 'x', r_role);
  insert into gold.user_branches (tenant_id, user_id, branch_id, is_primary) values (t, u1, b, true);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  insert into gold.role_permissions (tenant_id, role_id, permission) values (t, r_role, 'discrepancies:review');
  set local role gold_app;
  perform set_config('app.user_id', u1::text, true);

  r := gold.sync_apply(jsonb_build_object('id', c1, 'type', 'transaction.create', 'capturedAt', now(),
        'payload', jsonb_build_object('branchId', b, 'customerName', ''),
        'planError', jsonb_build_object('code', 'VALIDATION_FAILED', 'message', 'Enter the customer name.')));
  perform gold_test.assert(r->>'status' = 'rejected' and r->>'code' = 'VALIDATION_FAILED' and r->>'message' = 'Enter the customer name.', 'plan error is recorded as rejected: ' || r::text);
  perform gold_test.assert((select count(*) from gold.transactions) = 0, 'nothing was run');
  r := gold.sync_apply(jsonb_build_object('id', c1, 'type', 'transaction.create', 'payload', '{}'::jsonb));
  perform gold_test.assert((r->>'replayed')::boolean and r->>'status' = 'rejected', 'sending it again is a replay');

  -- a plan error that means "try later" is held, not rejected
  r := gold.sync_apply(jsonb_build_object('id', c2, 'type', 'transaction.pay', 'capturedAt', now(),
        'payload', jsonb_build_object('id', gen_random_uuid()), 'planError', jsonb_build_object('code', 'NOT_FOUND', 'message', 'Purchase was not found.')));
  perform gold_test.assert(r->>'status' = 'held', 'not found is held');
  raise notice 'sync plan errors ok';
end $$;