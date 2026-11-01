-- The blind count setting: off by default, a director can switch it on, it must be true or false, and it is on the audit trail.
do $$
declare
  t uuid := gen_random_uuid(); r_role uuid := gen_random_uuid(); u1 uuid := gen_random_uuid(); r jsonb;
begin
  insert into gold.tenants (id, slug, name) values (t, 'blind', 'Blind');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'director', 'Director');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u1, t, 'dir', 'Dir', 'x', r_role);
  set local role gold_app;
  perform set_config('app.user_id', u1::text, true);
  perform gold_test.assert((gold.settings_json()->>'count.blind')::boolean = false, 'off by default');
  perform gold_test.assert(gold_test.code_of($q$select gold.set_settings('{"count.blind":"yes"}'::jsonb)$q$) = 'VALIDATION_FAILED', 'must be true or false');
  r := gold.set_settings('{"count.blind":true}'::jsonb);
  perform gold_test.assert((r->>'count.blind')::boolean, 'switched on');
  perform gold_test.assert((gold.setting('count.blind'))::text = 'true', 'readable by the rest of the system');
  perform gold_test.assert(exists (select 1 from gold.audit_events where action = 'settings.changed'), 'the change is on the audit trail');
  raise notice 'blind count setting ok';
end $$;