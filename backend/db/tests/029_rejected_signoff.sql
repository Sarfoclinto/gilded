-- A rejected sign-off keeps the cases alive.
do $$
declare
  t uuid := gen_random_uuid(); b uuid := gen_random_uuid(); r_role uuid := gen_random_uuid(); r_dir uuid := gen_random_uuid(); u uuid := gen_random_uuid(); mgr uuid := gen_random_uuid();
  d1 uuid := gen_random_uuid(); rec uuid := gen_random_uuid(); case_id uuid := gen_random_uuid();
begin
  insert into gold.tenants (id, slug, name) values (t, 'reject', 'Reject');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main, timezone) values (b, t, 'TKW', 'Tarkwa', true, 'Africa/Accra');
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'teller', 'Teller'), (r_dir, t, 'director', 'Director');
  insert into gold.role_permissions (tenant_id, role_id, permission) values (t, r_dir, 'discrepancies:review'), (t, r_dir, 'days:signoff');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u, t, 'ama', 'Ama', 'x', r_role), (mgr, t, 'boss', 'Boss', 'x', r_dir);
  insert into gold.user_branches (tenant_id, user_id, branch_id, is_primary) values (t, u, b, true), (t, mgr, b, true);
  insert into gold.business_days (id, tenant_id, branch_id, business_date, status, opened_at, opened_by, closed_at, closed_by, closing_confirmed, closing_confirmation_version, closing_confirmation_text, signoff_status)
  values (d1, t, b, current_date, 'closed', now() - interval '10 hours', u, now() - interval '1 hour', u, true, 'v1', 'I checked', 'pending');
  insert into gold.day_reconciliations (id, tenant_id, business_day_id, phase, asset, expected, actual, explanation, explained_by) values (rec, t, d1, 'closing', 'cash', 1000, 900, 'counted short', u);
  insert into gold.discrepancies (id, tenant_id, branch_id, business_day_id, kind, asset, reconciliation_id, expected, actual, difference, reported_explanation, opened_by, status, resolved_at, resolved_by, resolution_type, resolution_summary)
  values (case_id, t, b, d1, 'closing_variance', 'cash', rec, 1000, 900, -100, 'counted short', u, 'resolved', now(), mgr, 'explained', 'Explained as change given');

  set local role gold_app;
  perform set_config('app.user_id', mgr::text, true);
  perform gold.signoff_day(d1, 'rejected', 'Not convinced by the explanation');
  perform gold_test.assert((select status from gold.discrepancies where id = case_id) = 'under_review', 'case is open again');
  perform gold_test.assert((select count(*) from gold.discrepancy_actions where discrepancy_id = case_id and note like 'Closing rejected:%') = 1, 'reason is on the case');
  perform gold_test.assert((select count(*) from gold.notifications where user_id = u and kind = 'signoff_decided') = 1, 'closer is told');
end $$;