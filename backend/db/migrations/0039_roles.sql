-- 0030 Roles: a company can define its own roles, change what they allow, and see who holds them.
-- Rules enforced here (the API also checks who may ask and that every permission is one the system knows):
--   * the three standard roles (director, manager, teller) are fixed: they can be copied, not changed or deleted;
--   * a custom role cannot be deleted while anyone holds it: move them to another role first;
--   * changing what a role allows signs its holders out, so the change is real at once;
--   * the company must always keep at least one active person who can manage users (checked after the change; the whole change is undone if not);
--   * every change is written to the audit trail with before and after.

alter table gold.roles add column description text;

-- The list now also says how many people hold each role and who they are (so the screen can show, assess and reassign).
create or replace function gold.roles_json() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', r.key, 'name', r.name, 'isSystem', r.is_system, 'description', r.description,
    'permissions', coalesce((select jsonb_agg(rp.permission order by rp.permission) from gold.role_permissions rp where rp.role_id = r.id), '[]'::jsonb),
    'activeMembers', (select count(*) from gold.users u where u.role_id = r.id and u.is_active),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.display_name, 'username', u.username::text, 'isActive', u.is_active)
                                          order by u.is_active desc, u.display_name) from gold.users u where u.role_id = r.id), '[]'::jsonb))
    order by r.is_system desc, r.name), '[]'::jsonb)
  from gold.roles r
$$;

create function gold.role_json(p_key text) returns jsonb language sql stable as $$
  select r from jsonb_array_elements(gold.roles_json()) r where r->>'key' = p_key
$$;

-- Active people who can manage users right now.
create function gold.user_managers() returns int language sql stable as $$
  select count(*)::int from gold.users u where u.is_active and exists (select 1 from gold.effective_permissions(u.id) e where e = 'users:manage')
$$;

create function gold.clean_permissions(p jsonb) returns text[] language plpgsql immutable as $$
declare v text[]; x text;
begin
  if p is null or jsonb_typeof(p) <> 'array' then perform gold.fail(422, 'VALIDATION_FAILED', 'Choose what this role allows.'); end if;
  select coalesce(array_agg(distinct e), '{}') into v from jsonb_array_elements_text(p) e;
  if cardinality(v) = 0 then perform gold.fail(422, 'VALIDATION_FAILED', 'Choose at least one thing this role allows.'); end if;
  foreach x in array v loop
    if x !~ '^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$' then perform gold.fail(422, 'VALIDATION_FAILED', format('"%s" is not a permission.', x)); end if;
  end loop;
  return v;
end $$;

create function gold.create_role(p jsonb) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant();
  v_id uuid := (p->>'id')::uuid;
  v_name text := trim(coalesce(p->>'name', ''));
  v_perms text[]; v_key text; v_base text; n int := 1;
begin
  perform gold.require_actor();
  if exists (select 1 from gold.roles where id = v_id) then
    return jsonb_build_object('replayed', true, 'data', gold.role_json((select key from gold.roles where id = v_id)));
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 40 then perform gold.fail(422, 'VALIDATION_FAILED', 'Give the role a name of 2 to 40 characters.'); end if;
  if exists (select 1 from gold.roles where lower(name) = lower(v_name)) then perform gold.fail(409, 'ROLE_EXISTS', 'A role with that name already exists.'); end if;
  v_perms := gold.clean_permissions(p->'permissions');
  v_base := trim(both '-' from lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g')));
  if v_base = '' then v_base := 'role'; end if;
  v_key := v_base;
  while exists (select 1 from gold.roles where key = v_key) loop n := n + 1; v_key := v_base || '-' || n; end loop;
  insert into gold.roles (id, tenant_id, key, name, is_system, description) values (v_id, v_tenant, v_key, v_name, false, nullif(trim(coalesce(p->>'description', '')), ''));
  insert into gold.role_permissions (tenant_id, role_id, permission) select v_tenant, v_id, x from unnest(v_perms) x;
  perform gold.audit('role.created', 'role', v_key, null, gold.role_json(v_key));
  return jsonb_build_object('replayed', false, 'data', gold.role_json(v_key));
end $$;

create function gold.update_role(p_key text, p jsonb) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant();
  r gold.roles; v_before jsonb; v_perms text[];
begin
  perform gold.require_actor();
  select * into r from gold.roles where key = p_key for update;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'Role was not found.'); end if;
  if r.is_system then perform gold.fail(409, 'SYSTEM_ROLE', 'The standard roles cannot be changed. Make a copy and change that.'); end if;
  v_before := gold.role_json(p_key);
  if p ? 'name' then
    if char_length(trim(p->>'name')) < 2 or char_length(trim(p->>'name')) > 40 then perform gold.fail(422, 'VALIDATION_FAILED', 'Give the role a name of 2 to 40 characters.'); end if;
    if exists (select 1 from gold.roles where lower(name) = lower(trim(p->>'name')) and id <> r.id) then perform gold.fail(409, 'ROLE_EXISTS', 'A role with that name already exists.'); end if;
    update gold.roles set name = trim(p->>'name') where id = r.id;
  end if;
  if p ? 'description' then update gold.roles set description = nullif(trim(coalesce(p->>'description', '')), '') where id = r.id; end if;
  if p ? 'permissions' then
    v_perms := gold.clean_permissions(p->'permissions');
    delete from gold.role_permissions where role_id = r.id;
    insert into gold.role_permissions (tenant_id, role_id, permission) select v_tenant, r.id, x from unnest(v_perms) x;
    update gold.refresh_tokens set revoked_at = now() where user_id in (select id from gold.users where role_id = r.id) and revoked_at is null;
    if gold.user_managers() = 0 then
      perform gold.fail(409, 'LAST_DIRECTOR', 'The company must keep at least one active person who can manage users.');
    end if;
  end if;
  perform gold.audit('role.updated', 'role', p_key, v_before, gold.role_json(p_key));
  return gold.role_json(p_key);
end $$;

create function gold.delete_role(p_key text) returns void language plpgsql as $$
declare r gold.roles; v_before jsonb; n int;
begin
  perform gold.require_actor();
  select * into r from gold.roles where key = p_key for update;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'Role was not found.'); end if;
  if r.is_system then perform gold.fail(409, 'SYSTEM_ROLE', 'The standard roles cannot be deleted.'); end if;
  select count(*) into n from gold.users where role_id = r.id;
  if n > 0 then perform gold.fail(409, 'ROLE_IN_USE', format('%s %s still hold this role. Move them to another role first.', n, case when n = 1 then 'person' else 'people' end)); end if;
  v_before := gold.role_json(p_key);
  delete from gold.roles where id = r.id;
  perform gold.audit('role.deleted', 'role', p_key, v_before, null);
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;