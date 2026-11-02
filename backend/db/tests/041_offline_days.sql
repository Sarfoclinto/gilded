-- Setting offline.maxDays: 7 by default, a Director can change it.
do $$
declare
  t uuid := gen_random_uuid(); b uuid := gen_random_uuid(); r_role uuid := gen_random_uuid(); u1 uuid := gen_random_uuid();
begin
  insert into gold.tenants (id, slug, name) values (t, 'offdays', 'Offline days');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main, timezone) values (b, t, 'TKW', 'Tarkwa', true, 'Africa/Accra');
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'director', 'Director');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u1, t, 'dir', 'Dir', 'x', r_role);
  set local role gold_app;
  perform set_config('app.user_id', u1::text, true);
  perform gold_test.assert((gold.settings_json()->>'offline.maxDays')::int = 7, 'seven days by default');
  perform gold.set_settings('{"offline.maxDays":3}'::jsonb);
  perform gold_test.assert((gold.settings_json()->>'offline.maxDays')::int = 3, 'changed to three');
  perform gold_test.assert((gold.settings_json()->>'customers.autoCreate')::boolean, 'other defaults intact');
end $$;