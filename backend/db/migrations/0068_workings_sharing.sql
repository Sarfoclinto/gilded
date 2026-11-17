-- 0068 (B68): share a Workings sheet with one named colleague, read-only.
--   * Same rules as sharing a picture (0065): the owner picks one colleague; the colleague is notified, can open the sheet read-only and save a
--     copy of their own, and cannot share it on. The owner can stop sharing at any time; access ends at once. Deleting a sheet ends its shares.
--   * A shared sheet always shows the owner's latest version (it is the same sheet, not a copy).
--   * Only "shared" and "stopped sharing" are logged, never the contents or when it is opened.
create table gold.working_shares (
  working_id uuid not null references gold.workings (id) on delete cascade,
  tenant_id  uuid not null references gold.tenants (id),
  owner_id   uuid not null references gold.users (id),
  to_user    uuid not null references gold.users (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  hidden_at  timestamptz,
  primary key (working_id, to_user),
  check (owner_id <> to_user)
);
create index working_shares_to on gold.working_shares (tenant_id, to_user, created_at desc) where revoked_at is null;
alter table gold.working_shares enable row level security;
alter table gold.working_shares force row level security;
create policy owner_or_recipient on gold.working_shares
  using (tenant_id = gold.current_tenant() and (owner_id = gold.current_actor() or to_user = gold.current_actor()))
  with check (tenant_id = gold.current_tenant() and owner_id = gold.current_actor());
create policy recipient_hides on gold.working_shares for update
  using (tenant_id = gold.current_tenant() and to_user = gold.current_actor())
  with check (tenant_id = gold.current_tenant() and to_user = gold.current_actor());

-- read access for someone it is actively shared with (the owner policy still decides who may change or delete it)
create policy shared_read on gold.workings for select
  using (tenant_id = gold.current_tenant() and exists (
    select 1 from gold.working_shares s where s.working_id = id and s.to_user = gold.current_actor() and s.revoked_at is null));

-- the owner's list now says who each sheet is shared with
create or replace function gold.workings_list(p jsonb) returns jsonb language plpgsql stable as $$
declare v_q text := nullif(trim(coalesce(p->>'q', '')), '');
begin
  perform gold.require_actor();
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(gold.working_json(w, false) || jsonb_build_object('sharedWith', coalesce((
          select jsonb_agg(gold.person_json(s.to_user) order by s.created_at) from gold.working_shares s where s.working_id = w.id and s.revoked_at is null), '[]'::jsonb))
        order by w.updated_at desc, w.id) from gold.workings w
        where w.owner_id = gold.current_actor() and (v_q is null or w.name ilike '%' || v_q || '%')), '[]'::jsonb),
    'usage', gold.workings_usage(),
    'sharedCount', (select count(*) from gold.working_shares s where s.to_user = gold.current_actor() and s.revoked_at is null and s.hidden_at is null));
end $$;

-- one sheet, for its owner or for someone it is shared with; says whose it is and whether the caller may change it
create or replace function gold.working_get(p_id uuid) returns jsonb language sql stable as $$
  select gold.working_json(w, true) || jsonb_build_object(
           'mine', w.owner_id = gold.current_actor(),
           'owner', gold.person_json(w.owner_id),
           'sharedWith', case when w.owner_id = gold.current_actor() then coalesce((
              select jsonb_agg(gold.person_json(s.to_user) order by s.created_at) from gold.working_shares s where s.working_id = w.id and s.revoked_at is null), '[]'::jsonb) else '[]'::jsonb end)
  from gold.workings w
  where w.id = p_id and (w.owner_id = gold.current_actor()
    or exists (select 1 from gold.working_shares s where s.working_id = w.id and s.to_user = gold.current_actor() and s.revoked_at is null))
$$;

-- sheets colleagues have shared with the caller, newest share first
create function gold.workings_shared_list() returns jsonb language plpgsql stable as $$
begin
  perform gold.require_actor();
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(gold.working_json(w, false) || jsonb_build_object('sharedBy', gold.person_json(s.owner_id), 'sharedAt', gold.iso(s.created_at)) order by s.created_at desc, w.id)
    from gold.working_shares s join gold.workings w on w.id = s.working_id
    where s.to_user = gold.current_actor() and s.revoked_at is null and s.hidden_at is null), '[]'::jsonb));
end $$;

create function gold.working_share(p_id uuid, p_to uuid) returns jsonb language plpgsql as $$
declare v_user uuid := gold.require_actor(); w gold.workings; v_one int;
begin
  if p_to is null or p_to = v_user then perform gold.fail(422, 'VALIDATION_FAILED', 'Choose a colleague to share with.'); end if;
  perform 1 from gold.users where id = p_to and is_active;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That person was not found.'); end if;
  select * into w from gold.workings where id = p_id and owner_id = v_user;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That sheet was not found.'); end if;
  insert into gold.working_shares (working_id, tenant_id, owner_id, to_user) values (w.id, gold.current_tenant(), v_user, p_to)
  on conflict (working_id, to_user) do update set revoked_at = null, hidden_at = null, created_at = now() where gold.working_shares.revoked_at is not null
  returning 1 into v_one;
  if found then
    perform gold.audit('working.shared', 'user', p_to::text, null, jsonb_build_object('to', p_to));
    perform gold.notify_user(gold.current_tenant(), p_to, 'working_shared',
      format('%s shared a sheet with you', (select display_name from gold.users where id = v_user)), 'Open Workings to see it.', '/workings?tab=shared');
    return jsonb_build_object('shared', true);
  end if;
  return jsonb_build_object('shared', false);
end $$;

-- stop sharing a sheet, with one colleague or (p_to null) with everyone
create function gold.working_unshare(p_id uuid, p_to uuid) returns jsonb language plpgsql as $$
declare v_user uuid := gold.require_actor(); v_n int;
begin
  with u as (update gold.working_shares set revoked_at = now()
             where working_id = p_id and owner_id = v_user and revoked_at is null and (p_to is null or to_user = p_to) returning 1)
  select count(*) into v_n from u;
  if v_n > 0 then perform gold.audit('working.unshared', 'user', coalesce(p_to::text, 'all'), null, jsonb_build_object('to', p_to, 'count', v_n)); end if;
  return jsonb_build_object('stopped', v_n);
end $$;

create function gold.working_shared_hide(p_id uuid) returns jsonb language plpgsql as $$
declare v_n int;
begin
  perform gold.require_actor();
  with u as (update gold.working_shares set hidden_at = now() where working_id = p_id and to_user = gold.current_actor() and hidden_at is null returning 1)
  select count(*) into v_n from u;
  return jsonb_build_object('hidden', v_n);
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant select, insert, update on gold.working_shares to gold_app;
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;