-- Custom roles: create, change, delete, and the rules around them.
do $$
declare
  t uuid := gen_random_uuid(); b1 uuid := gen_random_uuid(); r_dir uuid := gen_random_uuid(); r_tel uuid := gen_random_uuid();
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); rid uuid := gen_random_uuid(); r jsonb;
begin
  insert into gold.tenants (id, slug, name) values (t, 'rol', 'Role Gold');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main, timezone) values (b1, t, 'TKW', 'Tarkwa', true, 'Africa/Accra');
  insert into gold.roles (id, tenant_id, key, name, is_system) values (r_dir, t, 'director', 'Director', true), (r_tel, t, 'teller', 'Teller', true);
  insert into gold.role_permissions (tenant_id, role_id, permission) values (t, r_dir, 'users:manage'), (t, r_dir, 'branches:all'), (t, r_tel, 'days:read');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u1, t, 'ama', 'Ama', 'x', r_dir), (u2, t, 'kojo', 'Kojo', 'x', r_tel);

  set local role gold_app;
  perform set_config('app.user_id', u1::text, true);

  r := gold.create_role(jsonb_build_object('id', rid, 'name', 'Shift Lead', 'description', 'Runs a shift', 'permissions', '["days:read","days:manage","days:read"]'::jsonb));
  perform gold_test.assert((r->>'replayed')::boolean = false and r->'data'->>'key' = 'shift-lead' and r->'data'->>'isSystem' = 'false', 'created: ' || r::text);
  perform gold_test.assert(jsonb_array_length(r->'data'->'permissions') = 2, 'duplicate permissions collapse');
  r := gold.create_role(jsonb_build_object('id', rid, 'name', 'Shift Lead', 'permissions', '["days:read"]'::jsonb));
  perform gold_test.assert((r->>'replayed')::boolean, 'same id replays');
  begin perform gold.create_role(jsonb_build_object('id', gen_random_uuid(), 'name', 'shift lead', 'permissions', '["days:read"]'::jsonb)); perform gold_test.assert(false, 'duplicate name');
  exception when others then perform gold_test.assert(sqlerrm like '%ROLE_EXISTS%', 'name taken: ' || sqlerrm); end;
  begin perform gold.create_role(jsonb_build_object('id', gen_random_uuid(), 'name', 'Empty', 'permissions', '[]'::jsonb)); perform gold_test.assert(false, 'needs a permission');
  exception when others then perform gold_test.assert(sqlerrm like '%VALIDATION_FAILED%', 'at least one: ' || sqlerrm); end;
  begin perform gold.create_role(jsonb_build_object('id', gen_random_uuid(), 'name', 'Odd', 'permissions', '["Not A Permission"]'::jsonb)); perform gold_test.assert(false, 'format');
  exception when others then perform gold_test.assert(sqlerrm like '%VALIDATION_FAILED%', 'bad permission: ' || sqlerrm); end;
  r := gold.create_role(jsonb_build_object('id', gen_random_uuid(), 'name', 'Shift-Lead!', 'permissions', '["days:read"]'::jsonb));
  perform gold_test.assert(r->'data'->>'key' = 'shift-lead-2', 'key made unique: ' || (r->'data'->>'key'));

  -- change
  r := gold.update_role('shift-lead', '{"name":"Shift Leader","permissions":["days:read","transactions:read"]}'::jsonb);
  perform gold_test.assert(r->>'name' = 'Shift Leader' and jsonb_array_length(r->'permissions') = 2 and r->>'key' = 'shift-lead', 'updated, key stays');
  begin perform gold.update_role('teller', '{"name":"X"}'::jsonb); perform gold_test.assert(false, 'system role');
  exception when others then perform gold_test.assert(sqlerrm like '%SYSTEM_ROLE%', 'standard roles fixed: ' || sqlerrm); end;
  begin perform gold.update_role('nope', '{"name":"X"}'::jsonb); perform gold_test.assert(false, 'missing');
  exception when others then perform gold_test.assert(sqlerrm like '%NOT_FOUND%', 'unknown role: ' || sqlerrm); end;

  -- holders are signed out when what a role allows changes; the company keeps a user manager
  update gold.users set role_id = (select id from gold.roles where key = 'shift-lead') where id = u2;
  r := gold.roles_json();
  perform gold_test.assert((select (x->>'activeMembers')::int from jsonb_array_elements(r) x where x->>'key' = 'shift-lead') = 1, 'member count: ' || r::text);
  begin perform gold.delete_role('shift-lead'); perform gold_test.assert(false, 'in use');
  exception when others then perform gold_test.assert(sqlerrm like '%ROLE_IN_USE%', 'cannot delete while held: ' || sqlerrm); end;
  update gold.users set role_id = r_tel where id = u2;
  perform gold.delete_role('shift-lead');
  perform gold_test.assert(not exists (select 1 from gold.roles where key = 'shift-lead'), 'deleted once empty');
  begin perform gold.delete_role('director'); perform gold_test.assert(false, 'system');
  exception when others then perform gold_test.assert(sqlerrm like '%SYSTEM_ROLE%', 'standard roles cannot be deleted'); end;

  -- the last person who can manage users cannot lose it through a role change
  perform gold.create_role(jsonb_build_object('id', gen_random_uuid(), 'name', 'Admins', 'permissions', '["users:manage","branches:all"]'::jsonb));
  update gold.users set role_id = (select id from gold.roles where key = 'admins') where id = u1;
  begin perform gold.update_role('admins', '{"permissions":["days:read"]}'::jsonb); perform gold_test.assert(false, 'last director');
  exception when others then perform gold_test.assert(sqlerrm like '%LAST_DIRECTOR%', 'last user manager protected: ' || sqlerrm); end;
  perform gold_test.assert(gold.user_managers() = 1, 'the failed change was undone by the caller rolling back');
  -- audit
  perform gold_test.assert((select count(*) from gold.audit_events where action like 'role.%') >= 4, 'role changes are audited');
end $$;