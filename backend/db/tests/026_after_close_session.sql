-- A customer arrives after the day was closed.
do $$
declare
  t uuid := gen_random_uuid(); b uuid := gen_random_uuid(); r_role uuid := gen_random_uuid(); r_dir uuid := gen_random_uuid(); u uuid := gen_random_uuid(); mgr uuid := gen_random_uuid();
  d1 uuid := gen_random_uuid(); d2 uuid := gen_random_uuid(); r jsonb; v_failed boolean;
begin
  insert into gold.tenants (id, slug, name) values (t, 'afterclose', 'After Close');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main, timezone) values (b, t, 'TKW', 'Tarkwa', true, 'Africa/Accra');
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'teller', 'Teller'), (r_dir, t, 'director', 'Director');
  insert into gold.role_permissions (tenant_id, role_id, permission) values (t, r_dir, 'discrepancies:review');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u, t, 'ama', 'Ama', 'x', r_role), (mgr, t, 'boss', 'Boss', 'x', r_dir);
  insert into gold.user_branches (tenant_id, user_id, branch_id, is_primary) values (t, u, b, true), (t, mgr, b, true);
  insert into gold.business_days (id, tenant_id, branch_id, business_date, status, opened_at, opened_by, closed_at, closed_by, closing_confirmed, closing_confirmation_version, closing_confirmation_text, signoff_status)
  values (d1, t, b, current_date, 'closed', now() - interval '10 hours', u, now() - interval '1 hour', u, true, 'v1', 'I checked', 'not_required');

  set local role gold_app;
  perform set_config('app.user_id', u::text, true);

  -- without saying so, or without a reason, it is refused
  v_failed := false;
  begin perform gold.open_day(jsonb_build_object('id', gen_random_uuid(), 'branchId', b, 'businessDate', current_date, 'capturedAt', now()));
  exception when others then v_failed := true; end;
  perform gold_test.assert(v_failed, 'refused when not asked for as an after-close session');
  v_failed := false;
  begin perform gold.open_day(jsonb_build_object('id', gen_random_uuid(), 'branchId', b, 'businessDate', current_date, 'capturedAt', now(), 'afterClose', true));
  exception when others then v_failed := true; end;
  perform gold_test.assert(v_failed, 'refused without a reason');

  r := gold.open_day(jsonb_build_object('id', d2, 'branchId', b, 'businessDate', current_date, 'capturedAt', now(), 'afterClose', true, 'explanation', 'Customer arrived as we were leaving'));
  perform gold_test.assert((select status from gold.business_days where id = d2) = 'open', 'second session is open');
  perform gold_test.assert((select continuation_reason from gold.business_days where id = d2) like 'Customer arrived%', 'reason is kept');
  perform gold_test.assert((select status from gold.business_days where id = d1) = 'closed', 'the first session stays closed');
  perform gold_test.assert((select count(*) from gold.notifications where kind = 'after_close_session' and user_id = mgr) = 1, 'reviewers are told');
  perform gold_test.assert((gold.day_state(b)->'day'->>'id')::uuid = d2, 'current day is the later session');

  -- never two at once
  v_failed := false;
  begin perform gold.open_day(jsonb_build_object('id', gen_random_uuid(), 'branchId', b, 'businessDate', current_date, 'capturedAt', now(), 'afterClose', true, 'explanation', 'Another try here'));
  exception when others then v_failed := true; end;
  perform gold_test.assert(v_failed, 'cannot open while one is open');
end $$;