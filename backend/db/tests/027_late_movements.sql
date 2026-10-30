-- A cash movement that reaches the server after its day closed.
do $$
declare
  t uuid := gen_random_uuid(); b uuid := gen_random_uuid(); r_role uuid := gen_random_uuid(); u uuid := gen_random_uuid();
  d1 uuid := gen_random_uuid(); d2 uuid := gen_random_uuid(); r jsonb; v_failed boolean := false;
begin
  insert into gold.tenants (id, slug, name) values (t, 'latemove', 'Late Move');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main, timezone) values (b, t, 'TKW', 'Tarkwa', true, 'Africa/Accra');
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'teller', 'Teller');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u, t, 'ama', 'Ama', 'x', r_role);
  insert into gold.user_branches (tenant_id, user_id, branch_id, is_primary) values (t, u, b, true);
  insert into gold.business_days (id, tenant_id, branch_id, business_date, status, opened_at, opened_by, closed_at, closed_by, closing_confirmed, closing_confirmation_version, closing_confirmation_text, signoff_status)
  values (d1, t, b, current_date, 'closed', now() - interval '10 hours', u, now() - interval '1 hour', u, true, 'v1', 'I checked', 'not_required');
  set local role gold_app;
  perform set_config('app.user_id', u::text, true);

  -- nothing open: still refused, with a message that says what to do
  begin
    perform gold.record_movement(jsonb_build_object('id', gen_random_uuid(), 'dayId', d1, 'branchId', b, 'kind', 'topup', 'note', 'float', 'lines', jsonb_build_object('100', 5), 'capturedAt', now() - interval '2 hours'));
  exception when others then v_failed := true; end;
  perform gold_test.assert(v_failed, 'refused while no day is open');

  reset role;
  insert into gold.business_days (id, tenant_id, branch_id, business_date, session_no, status, opened_at, opened_by, opening_source) values (d2, t, b, current_date, 2, 'open', now() - interval '30 minutes', u, 'carried');
  set local role gold_app;
  perform set_config('app.user_id', u::text, true);
  r := gold.record_movement(jsonb_build_object('id', gen_random_uuid(), 'dayId', d1, 'branchId', b, 'kind', 'topup', 'note', 'float', 'lines', jsonb_build_object('100', 5), 'capturedAt', now() - interval '2 hours'));
  perform gold_test.assert((r->'data'->>'dayId')::uuid = d2, 'recorded in the open day: ' || r::text);
  perform gold_test.assert((r->'data'->>'note') like 'Made before the day closed:%', 'says so');
end $$;