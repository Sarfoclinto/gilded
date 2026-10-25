-- 0010 Sign-in support.
-- 1. Before a person is signed in nobody knows which company they belong to, yet every table is locked to one company.
--    The sign-in step names the company's short name (`SET LOCAL app.login_company`), and that one tenant row (only its row) becomes
--    readable. From then on the request works inside its company like any other.
-- 2. Refresh-token rotation, reuse detection and logout live in the database so they are atomic and testable.
-- 3. Effective permissions and branches are computed in one place.

create policy tenant_login on gold.tenants for select
  using (slug = nullif(current_setting('app.login_company', true), '')::citext);

create index if not exists refresh_tokens_family on gold.refresh_tokens (family_id);

-- Role permissions, plus personal grants, minus personal denials. Denials always win.
create function gold.effective_permissions(p_user uuid) returns setof text
language sql stable as $$
  select p.permission
  from (
    select rp.permission
    from gold.users u
    join gold.role_permissions rp on rp.role_id = u.role_id and rp.tenant_id = u.tenant_id
    where u.id = p_user
    union
    select o.permission from gold.user_permission_overrides o where o.user_id = p_user and o.effect = 'allow'
  ) p
  where not exists (
    select 1 from gold.user_permission_overrides d
    where d.user_id = p_user and d.effect = 'deny' and d.permission = p.permission
  )
  order by 1
$$;

-- Branches the person works in. `branches:all` (directors) means every active branch of the company.
create function gold.user_branch_ids(p_user uuid) returns setof uuid
language sql stable as $$
  select b.id
  from gold.branches b
  where b.is_active
    and (
      exists (select 1 from gold.effective_permissions(p_user) p where p = 'branches:all')
      or exists (select 1 from gold.user_branches ub where ub.user_id = p_user and ub.branch_id = b.id)
    )
  order by b.is_main desc, b.name
$$;

-- Exchange a refresh token for the next one. Outcomes:
--   ok       the old token is retired and the new one stored;
--   unknown  no such token;       revoked  signed out, or the account was switched off;
--   expired  past its life;       race     the same token was used a moment ago (two tabs): nothing is revoked, the caller retries;
--   reused   a retired token came back later: someone may have copied it, so the whole login (family) is revoked.
create function gold.rotate_refresh_token(
  p_old bytea, p_new bytea, p_expires timestamptz, p_user_agent text, p_ip inet, p_grace interval default interval '10 seconds')
returns table (o_outcome text, o_user_id uuid, o_family_id uuid)
language plpgsql as $$
declare
  t gold.refresh_tokens;
  active boolean;
  new_id uuid := gen_random_uuid();
begin
  select * into t from gold.refresh_tokens where token_hash = p_old for update;
  if not found then
    return query select 'unknown'::text, null::uuid, null::uuid;
    return;
  end if;

  if t.revoked_at is not null then
    if t.replaced_by is null then
      return query select 'revoked'::text, t.user_id, t.family_id;
    elsif now() - t.revoked_at <= p_grace then
      return query select 'race'::text, t.user_id, t.family_id;
    else
      update gold.refresh_tokens set revoked_at = now() where family_id = t.family_id and revoked_at is null;
      return query select 'reused'::text, t.user_id, t.family_id;
    end if;
    return;
  end if;

  select u.is_active into active from gold.users u where u.id = t.user_id;
  if not coalesce(active, false) then
    update gold.refresh_tokens set revoked_at = now() where family_id = t.family_id and revoked_at is null;
    return query select 'revoked'::text, t.user_id, t.family_id;
    return;
  end if;

  if t.expires_at <= now() then
    return query select 'expired'::text, t.user_id, t.family_id;
    return;
  end if;

  insert into gold.refresh_tokens (id, tenant_id, user_id, family_id, token_hash, expires_at, user_agent, ip)
  values (new_id, t.tenant_id, t.user_id, t.family_id, p_new, p_expires, p_user_agent, p_ip);
  update gold.refresh_tokens set revoked_at = now(), replaced_by = new_id where id = t.id;
  return query select 'ok'::text, t.user_id, t.family_id;
end $$;

-- Sign out: revoke the whole login (family) the token belongs to. Quietly does nothing for an unknown token.
create function gold.revoke_refresh_family(p_hash bytea) returns void
language sql as $$
  update gold.refresh_tokens set revoked_at = now()
  where revoked_at is null and family_id = (select family_id from gold.refresh_tokens where token_hash = p_hash)
$$;

grant execute on function gold.effective_permissions(uuid), gold.user_branch_ids(uuid),
  gold.rotate_refresh_token(bytea, bytea, timestamptz, text, inet, interval), gold.revoke_refresh_family(bytea) to gold_app;