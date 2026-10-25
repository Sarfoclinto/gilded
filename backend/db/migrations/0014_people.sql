-- 0014 People: users, customers and branches can be managed from the application.
-- Rules enforced here (the API also checks who may ask):
--   * nobody is deleted: users are switched off, so everything they did stays attributable;
--   * you cannot change your own role, branches, access or switch yourself off, and the company can never be left without
--     anyone who can manage users;
--   * changing someone's access signs them out (their refresh tokens are revoked), so the change is real at once;
--   * a user created or reset by an administrator must choose their own password at the next sign-in;
--   * customers can be edited and duplicates merged; purchases, debts and held gold follow the merge, the record of what the
--     customer was called at the time of each purchase stays as it was.

alter table gold.users add column must_change_password boolean not null default false;

-- ---------------------------------------------------------------- helpers
create function gold.audit(p_action text, p_entity_type text, p_entity_id text, p_before jsonb, p_after jsonb) returns void
language sql as $$
  insert into gold.audit_events (tenant_id, actor_user_id, action, entity_type, entity_id, before, after)
  values (gold.current_tenant(), gold.current_actor(), p_action, p_entity_type, p_entity_id, p_before, p_after)
$$;

-- Active people (other than p_except) who can do p_permission today.
create function gold.other_holders(p_permission text, p_except uuid) returns int language sql stable as $$
  select count(*)::int from gold.users u
  where u.is_active and u.id <> p_except
    and exists (select 1 from gold.effective_permissions(u.id) e where e = p_permission)
$$;

-- A list of branch ids from JSON, each checked to exist and be active.
create function gold.valid_branch_ids(p jsonb) returns uuid[] language plpgsql stable as $$
declare ids uuid[]; n int;
begin
  select coalesce(array_agg(distinct x::uuid), '{}') into ids from jsonb_array_elements_text(coalesce(p, '[]'::jsonb)) x;
  select count(*) into n from gold.branches where id = any(ids) and is_active;
  if n <> cardinality(ids) then perform gold.fail(422, 'VALIDATION_FAILED', 'One of the chosen branches does not exist or is switched off.'); end if;
  return ids;
end $$;

-- ---------------------------------------------------------------- users
create function gold.user_admin_json(p_id uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', u.id, 'username', u.username::text, 'displayName', u.display_name, 'email', u.email::text, 'phone', u.phone,
    'role', jsonb_build_object('key', r.key, 'name', r.name),
    'branchIds', coalesce((select jsonb_agg(ub.branch_id order by ub.is_primary desc, ub.branch_id) from gold.user_branches ub where ub.user_id = u.id), '[]'::jsonb),
    'isActive', u.is_active, 'mustChangePassword', u.must_change_password,
    'lastLoginAt', case when u.last_login_at is null then null else gold.iso(u.last_login_at) end,
    'createdAt', gold.iso(u.created_at),
    'overrides', coalesce((select jsonb_agg(jsonb_build_object('permission', o.permission, 'effect', o.effect) order by o.permission)
                           from gold.user_permission_overrides o where o.user_id = u.id), '[]'::jsonb),
    'permissions', coalesce((select jsonb_agg(e.perm) from gold.effective_permissions(u.id) as e(perm)), '[]'::jsonb))
  from gold.users u join gold.roles r on r.id = u.role_id and r.tenant_id = u.tenant_id
  where u.id = p_id
$$;

create function gold.users_admin_json() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(gold.user_admin_json(id) order by is_active desc, lower(display_name)), '[]'::jsonb) from gold.users
$$;

create function gold.roles_json() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', r.key, 'name', r.name, 'isSystem', r.is_system,
    'permissions', coalesce((select jsonb_agg(rp.permission order by rp.permission) from gold.role_permissions rp where rp.role_id = r.id), '[]'::jsonb))
    order by r.name), '[]'::jsonb)
  from gold.roles r
$$;

create function gold.create_user(p jsonb) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant();
  v_id uuid := (p->>'id')::uuid;
  v_username text := lower(trim(coalesce(p->>'username', '')));
  v_name text := trim(coalesce(p->>'displayName', ''));
  v_role uuid; v_branches uuid[]; o jsonb; i int := 0; b uuid; v_all boolean;
begin
  perform gold.require_actor();
  if exists (select 1 from gold.users where id = v_id) then
    return jsonb_build_object('replayed', true, 'data', gold.user_admin_json(v_id));
  end if;
  if v_username !~ '^[a-z0-9][a-z0-9._-]{2,39}$' then
    perform gold.fail(422, 'VALIDATION_FAILED', 'The username must be 3 to 40 letters, digits, dots, dashes or underscores.');
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 80 then perform gold.fail(422, 'VALIDATION_FAILED', 'Enter the person''s name.'); end if;
  if coalesce(p->>'passwordHash', '') = '' then perform gold.fail(422, 'VALIDATION_FAILED', 'A temporary password is needed.'); end if;
  if exists (select 1 from gold.users where username = v_username::citext) then
    perform gold.fail(409, 'USERNAME_TAKEN', 'That username is already used.');
  end if;
  select id into v_role from gold.roles where key = p->>'roleKey';
  if v_role is null then perform gold.fail(422, 'VALIDATION_FAILED', 'Choose a role.'); end if;
  v_branches := gold.valid_branch_ids(p->'branchIds');

  insert into gold.users (id, tenant_id, username, display_name, email, phone, password_hash, role_id, must_change_password)
  values (v_id, v_tenant, v_username, v_name, nullif(trim(coalesce(p->>'email', '')), ''), nullif(trim(coalesce(p->>'phone', '')), ''),
          p->>'passwordHash', v_role, true);
  foreach b in array v_branches loop
    i := i + 1;
    insert into gold.user_branches (tenant_id, user_id, branch_id, is_primary) values (v_tenant, v_id, b, i = 1);
  end loop;
  for o in select * from jsonb_array_elements(coalesce(p->'overrides', '[]'::jsonb)) loop
    insert into gold.user_permission_overrides (tenant_id, user_id, permission, effect) values (v_tenant, v_id, o->>'permission', o->>'effect')
    on conflict (user_id, permission) do update set effect = excluded.effect;
  end loop;

  select exists (select 1 from gold.effective_permissions(v_id) e where e = 'branches:all') into v_all;
  if cardinality(v_branches) = 0 and not v_all then
    perform gold.fail(422, 'BRANCH_REQUIRED', 'Choose at least one branch for this person.');
  end if;
  perform gold.audit('user.created', 'user', v_id::text, null, gold.user_admin_json(v_id));
  return jsonb_build_object('replayed', false, 'data', gold.user_admin_json(v_id));
end $$;

create function gold.update_user(p_id uuid, p jsonb) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant();
  v_me uuid := gold.require_actor();
  u gold.users; v_before jsonb; v_role uuid; v_branches uuid[]; o jsonb; i int := 0; b uuid;
  v_access boolean := (p ? 'roleKey') or (p ? 'branchIds') or (p ? 'overrides') or (p ? 'isActive');
  v_signout boolean := false;
begin
  select * into u from gold.users where id = p_id for update;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'User was not found.'); end if;
  if p_id = v_me and v_access then
    perform gold.fail(409, 'CANNOT_CHANGE_OWN_ACCESS', 'Ask another director to change your own role, branches or access.');
  end if;
  v_before := gold.user_admin_json(p_id);

  if p ? 'displayName' then
    if char_length(trim(p->>'displayName')) < 2 or char_length(trim(p->>'displayName')) > 80 then
      perform gold.fail(422, 'VALIDATION_FAILED', 'Enter the person''s name.');
    end if;
    update gold.users set display_name = trim(p->>'displayName') where id = p_id;
  end if;
  if p ? 'email' then update gold.users set email = nullif(trim(coalesce(p->>'email', '')), '') where id = p_id; end if;
  if p ? 'phone' then update gold.users set phone = nullif(trim(coalesce(p->>'phone', '')), '') where id = p_id; end if;

  if p ? 'roleKey' then
    select id into v_role from gold.roles where key = p->>'roleKey';
    if v_role is null then perform gold.fail(422, 'VALIDATION_FAILED', 'Choose a role.'); end if;
    if v_role <> u.role_id then update gold.users set role_id = v_role where id = p_id; v_signout := true; end if;
  end if;
  if p ? 'isActive' and (p->>'isActive')::boolean <> u.is_active then
    update gold.users set is_active = (p->>'isActive')::boolean, failed_login_count = 0, locked_until = null where id = p_id;
    v_signout := true;
  end if;
  if p ? 'branchIds' then
    v_branches := gold.valid_branch_ids(p->'branchIds');
    delete from gold.user_branches where user_id = p_id;
    foreach b in array v_branches loop
      i := i + 1;
      insert into gold.user_branches (tenant_id, user_id, branch_id, is_primary) values (v_tenant, p_id, b, i = 1);
    end loop;
    v_signout := true;
  end if;
  if p ? 'overrides' then
    delete from gold.user_permission_overrides where user_id = p_id;
    for o in select * from jsonb_array_elements(coalesce(p->'overrides', '[]'::jsonb)) loop
      insert into gold.user_permission_overrides (tenant_id, user_id, permission, effect) values (v_tenant, p_id, o->>'permission', o->>'effect')
      on conflict (user_id, permission) do update set effect = excluded.effect;
    end loop;
    v_signout := true;
  end if;

  if v_access then
    if not exists (select 1 from gold.effective_permissions(p_id) e where e = 'branches:all')
       and not exists (select 1 from gold.user_branches where user_id = p_id) then
      perform gold.fail(422, 'BRANCH_REQUIRED', 'Choose at least one branch for this person.');
    end if;
    -- The company must always keep someone who can manage users (checked after the change, so the whole change is undone if not).
    if gold.other_holders('users:manage', p_id) = 0
       and not (exists (select 1 from gold.users x where x.id = p_id and x.is_active)
                and exists (select 1 from gold.effective_permissions(p_id) e where e = 'users:manage')) then
      perform gold.fail(409, 'LAST_DIRECTOR', 'The company must keep at least one active person who can manage users.');
    end if;
  end if;
  if v_signout then
    update gold.refresh_tokens set revoked_at = now() where user_id = p_id and revoked_at is null;
  end if;
  perform gold.audit('user.updated', 'user', p_id::text, v_before, gold.user_admin_json(p_id));
  return gold.user_admin_json(p_id);
end $$;

-- An administrator sets a temporary password. The person must choose their own at the next sign-in.
create function gold.reset_user_password(p_id uuid, p_hash text) returns jsonb language plpgsql as $$
begin
  if p_id = gold.require_actor() then perform gold.fail(409, 'USE_CHANGE_PASSWORD', 'Use "change my password" for your own account.'); end if;
  if coalesce(p_hash, '') = '' then perform gold.fail(422, 'VALIDATION_FAILED', 'A temporary password is needed.'); end if;
  update gold.users set password_hash = p_hash, must_change_password = true, failed_login_count = 0, locked_until = null where id = p_id;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'User was not found.'); end if;
  update gold.refresh_tokens set revoked_at = now() where user_id = p_id and revoked_at is null;
  perform gold.audit('user.password_reset', 'user', p_id::text, null, null);
  return gold.user_admin_json(p_id);
end $$;

create function gold.my_password_hash() returns text language sql stable as $$
  select password_hash from gold.users where id = gold.current_actor()
$$;

create function gold.my_security_json() returns jsonb language sql stable as $$
  select jsonb_build_object('mustChangePassword', must_change_password) from gold.users where id = gold.current_actor()
$$;

create function gold.change_my_password(p_hash text) returns void language plpgsql as $$
declare v_me uuid := gold.require_actor();
begin
  update gold.users set password_hash = p_hash, must_change_password = false where id = v_me;
  perform gold.audit('user.password_changed', 'user', v_me::text, null, null);
end $$;

-- ---------------------------------------------------------------- customers
create function gold.customer_row_json(c gold.customers) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'phone', c.phone, 'notes', c.notes, 'createdAt', gold.iso(c.created_at),
    'purchases', (select count(*) from gold.transactions t where t.customer_id = c.id),
    'lastPurchaseAt', (select case when max(t.captured_at) is null then null else gold.iso(max(t.captured_at)) end from gold.transactions t where t.customer_id = c.id),
    'owesUs', gold.ts(coalesce((select sum(d.outstanding) from gold.v_debts_outstanding d where d.customer_id = c.id and d.status = 'open' and d.direction = 'receivable'), 0)),
    'weOwe', gold.ts(coalesce((select sum(d.outstanding) from gold.v_debts_outstanding d where d.customer_id = c.id and d.status = 'open' and d.direction = 'payable'), 0)))
$$;

create function gold.customers_page_json(p_q text, p_limit int, p_offset int) returns jsonb language sql stable as $$
  with f as (
    select * from gold.customers c
    where p_q is null or lower(c.name) like '%' || lower(p_q) || '%' or c.phone like '%' || p_q || '%'
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'items', coalesce((select jsonb_agg(gold.customer_row_json(x) order by lower(x.name), x.id)
                       from (select * from f order by lower(name), id limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb))
$$;

create function gold.customer_detail_json(p_id uuid) returns jsonb language plpgsql stable as $$
declare c gold.customers;
begin
  select * into c from gold.customers where id = p_id;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'Customer was not found.'); end if;
  return gold.customer_row_json(c) || jsonb_build_object(
    'transactions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'reference', t.reference, 'branchId', t.branch_id, 'branchName', b.name, 'payable', gold.ts(t.payable),
        'capturedAt', gold.iso(t.captured_at), 'customerName', t.customer_name) order by t.captured_at desc)
      from (select * from gold.transactions where customer_id = p_id order by captured_at desc limit 20) t
      join gold.branches b on b.id = t.branch_id), '[]'::jsonb),
    'debts', coalesce((select jsonb_agg(gold.debt_json(d.id) order by d.issued_at desc) from gold.debts d where d.customer_id = p_id), '[]'::jsonb),
    'held', coalesce((select jsonb_agg(gold.collateral_json(h.id) order by h.received_at desc) from gold.collateral_holdings h where h.customer_id = p_id), '[]'::jsonb));
end $$;

create function gold.create_customer(p jsonb) returns jsonb language plpgsql as $$
declare
  v_id uuid := coalesce((p->>'id')::uuid, gen_random_uuid());
  v_name text := trim(coalesce(p->>'name', ''));
  v_phone text := nullif(regexp_replace(coalesce(p->>'phone', ''), '\s', '', 'g'), '');
begin
  perform gold.require_actor();
  if exists (select 1 from gold.customers where id = v_id) then
    return jsonb_build_object('replayed', true, 'data', gold.customer_detail_json(v_id));
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then perform gold.fail(422, 'VALIDATION_FAILED', 'Enter the customer''s name.'); end if;
  if v_phone is null or char_length(v_phone) < 6 then perform gold.fail(422, 'VALIDATION_FAILED', 'Enter the customer''s phone number.'); end if;
  if exists (select 1 from gold.customers where lower(name) = lower(v_name) and phone = v_phone) then
    perform gold.fail(409, 'DUPLICATE_CUSTOMER', 'A customer with this name and phone number already exists.');
  end if;
  insert into gold.customers (id, tenant_id, name, phone, notes, created_by)
  values (v_id, gold.current_tenant(), v_name, v_phone, nullif(trim(coalesce(p->>'notes', '')), ''), gold.current_actor());
  perform gold.audit('customer.created', 'customer', v_id::text, null, gold.customer_detail_json(v_id));
  return jsonb_build_object('replayed', false, 'data', gold.customer_detail_json(v_id));
end $$;

create function gold.update_customer(p_id uuid, p jsonb) returns jsonb language plpgsql as $$
declare c gold.customers; v_before jsonb; v_name text; v_phone text;
begin
  perform gold.require_actor();
  select * into c from gold.customers where id = p_id for update;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'Customer was not found.'); end if;
  v_before := gold.customer_row_json(c);
  v_name := case when p ? 'name' then trim(coalesce(p->>'name', '')) else c.name end;
  v_phone := case when p ? 'phone' then nullif(regexp_replace(coalesce(p->>'phone', ''), '\s', '', 'g'), '') else c.phone end;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then perform gold.fail(422, 'VALIDATION_FAILED', 'Enter the customer''s name.'); end if;
  if v_phone is null or char_length(v_phone) < 6 then perform gold.fail(422, 'VALIDATION_FAILED', 'Enter the customer''s phone number.'); end if;
  if exists (select 1 from gold.customers where id <> p_id and lower(name) = lower(v_name) and phone = v_phone) then
    perform gold.fail(409, 'DUPLICATE_CUSTOMER', 'Another customer has this name and phone number. Merge them instead.');
  end if;
  update gold.customers set name = v_name, phone = v_phone,
         notes = case when p ? 'notes' then nullif(trim(coalesce(p->>'notes', '')), '') else notes end
  where id = p_id;
  -- Names on debts follow the customer. Receipts keep the name used on the day.
  update gold.debts set party_name = v_name where customer_id = p_id and party_type = 'customer';
  perform gold.audit('customer.updated', 'customer', p_id::text, v_before, gold.customer_row_json((select x from gold.customers x where x.id = p_id)));
  return gold.customer_detail_json(p_id);
end $$;

-- Two records for one person: everything moves to p_keep and p_remove disappears (kept in the audit trail).
create function gold.merge_customers(p_keep uuid, p_remove uuid) returns jsonb language plpgsql as $$
declare k gold.customers; r gold.customers; v_before jsonb;
begin
  perform gold.require_actor();
  if p_keep = p_remove then perform gold.fail(422, 'VALIDATION_FAILED', 'Choose two different customers.'); end if;
  select * into k from gold.customers where id = p_keep for update;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'Customer was not found.'); end if;
  select * into r from gold.customers where id = p_remove for update;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'Customer was not found.'); end if;
  v_before := jsonb_build_object('kept', gold.customer_row_json(k), 'removed', gold.customer_row_json(r));
  update gold.transactions set customer_id = p_keep where customer_id = p_remove;
  update gold.debts set customer_id = p_keep, party_name = k.name where customer_id = p_remove;
  update gold.collateral_holdings set customer_id = p_keep where customer_id = p_remove;
  update gold.customers set notes = nullif(concat_ws(E'\n', k.notes, r.notes), '') where id = p_keep;
  delete from gold.customers where id = p_remove;
  perform gold.audit('customer.merged', 'customer', p_keep::text, v_before, gold.customer_row_json((select x from gold.customers x where x.id = p_keep)));
  return gold.customer_detail_json(p_keep);
end $$;

-- ---------------------------------------------------------------- branches
create function gold.branch_admin_json(p_id uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('id', b.id, 'name', b.name, 'code', b.code, 'isMain', b.is_main, 'timezone', b.timezone, 'isActive', b.is_active,
                            'dayOpen', exists (select 1 from gold.business_days d where d.branch_id = b.id and d.status = 'open'))
  from gold.branches b where b.id = p_id
$$;

create function gold.branches_admin_json() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(gold.branch_admin_json(id) order by is_main desc, is_active desc, name), '[]'::jsonb) from gold.branches
$$;

create function gold.create_branch(p jsonb) returns jsonb language plpgsql as $$
declare
  v_id uuid := coalesce((p->>'id')::uuid, gen_random_uuid());
  v_code text := upper(trim(coalesce(p->>'code', '')));
  v_name text := trim(coalesce(p->>'name', ''));
  v_tz text := coalesce(nullif(trim(coalesce(p->>'timezone', '')), ''), 'Africa/Accra');
begin
  perform gold.require_actor();
  if exists (select 1 from gold.branches where id = v_id) then
    return jsonb_build_object('replayed', true, 'data', gold.branch_admin_json(v_id));
  end if;
  if v_code !~ '^[A-Z0-9]{2,6}$' then perform gold.fail(422, 'VALIDATION_FAILED', 'The branch code must be 2 to 6 letters or digits.'); end if;
  if char_length(v_name) < 2 or char_length(v_name) > 80 then perform gold.fail(422, 'VALIDATION_FAILED', 'Enter the branch name.'); end if;
  if not exists (select 1 from pg_timezone_names where name = v_tz) then perform gold.fail(422, 'VALIDATION_FAILED', 'That time zone is not known.'); end if;
  if exists (select 1 from gold.branches where code = v_code) then perform gold.fail(409, 'CODE_TAKEN', 'That branch code is already used.'); end if;
  insert into gold.branches (id, tenant_id, code, name, is_main, timezone) values (v_id, gold.current_tenant(), v_code, v_name, false, v_tz);
  perform gold.audit('branch.created', 'branch', v_id::text, null, gold.branch_admin_json(v_id));
  return jsonb_build_object('replayed', false, 'data', gold.branch_admin_json(v_id));
end $$;

-- The code is part of every document number, so it never changes.
create function gold.update_branch(p_id uuid, p jsonb) returns jsonb language plpgsql as $$
declare b gold.branches; v_before jsonb; v_tz text;
begin
  perform gold.require_actor();
  select * into b from gold.branches where id = p_id for update;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'Branch was not found.'); end if;
  v_before := gold.branch_admin_json(p_id);
  if p ? 'name' then
    if char_length(trim(coalesce(p->>'name', ''))) < 2 or char_length(trim(p->>'name')) > 80 then perform gold.fail(422, 'VALIDATION_FAILED', 'Enter the branch name.'); end if;
    update gold.branches set name = trim(p->>'name') where id = p_id;
  end if;
  if p ? 'timezone' then
    v_tz := trim(coalesce(p->>'timezone', ''));
    if not exists (select 1 from pg_timezone_names where name = v_tz) then perform gold.fail(422, 'VALIDATION_FAILED', 'That time zone is not known.'); end if;
    update gold.branches set timezone = v_tz where id = p_id;
  end if;
  if p ? 'isActive' and (p->>'isActive')::boolean <> b.is_active then
    if not (p->>'isActive')::boolean then
      if b.is_main then perform gold.fail(409, 'MAIN_BRANCH', 'The main branch cannot be switched off.'); end if;
      if exists (select 1 from gold.business_days d where d.branch_id = p_id and d.status = 'open') then
        perform gold.fail(409, 'DAY_OPEN', 'Close the branch''s day before switching it off.');
      end if;
    end if;
    update gold.branches set is_active = (p->>'isActive')::boolean where id = p_id;
  end if;
  perform gold.audit('branch.updated', 'branch', p_id::text, v_before, gold.branch_admin_json(p_id));
  return gold.branch_admin_json(p_id);
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;