-- 0065 (B66): share a personal picture with one named colleague.
--   * The owner picks pictures and one colleague; the colleague gets a notification and finds them under "Shared with me", where they can look
--     at them and save a copy. The colleague cannot share them on. The owner can stop sharing at any time; access ends at once.
--   * Only the sharing itself is logged ("shared N pictures with X", "stopped sharing with X"), never the pictures or when they are looked at.
--   * Deleting a picture ends every share of it.
create table gold.personal_picture_shares (
  picture_id uuid not null references gold.personal_pictures (id) on delete cascade,
  tenant_id  uuid not null references gold.tenants (id),
  owner_id   uuid not null references gold.users (id),
  to_user    uuid not null references gold.users (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  hidden_at  timestamptz,
  primary key (picture_id, to_user),
  check (owner_id <> to_user)
);
create index personal_shares_to on gold.personal_picture_shares (tenant_id, to_user, created_at desc) where revoked_at is null;
alter table gold.personal_picture_shares enable row level security;
alter table gold.personal_picture_shares force row level security;
-- the person who shared, and the person it was shared with: nobody else
create policy owner_or_recipient on gold.personal_picture_shares
  using (tenant_id = gold.current_tenant() and (owner_id = gold.current_actor() or to_user = gold.current_actor()))
  with check (tenant_id = gold.current_tenant() and owner_id = gold.current_actor());
-- the recipient may only hide a share from their own list
create policy recipient_hides on gold.personal_picture_shares for update
  using (tenant_id = gold.current_tenant() and to_user = gold.current_actor())
  with check (tenant_id = gold.current_tenant() and to_user = gold.current_actor());

-- a picture may also be read by someone it is actively shared with (read only: the owner policy still decides who can change or delete it)
create policy shared_read on gold.personal_pictures for select
  using (tenant_id = gold.current_tenant() and exists (
    select 1 from gold.personal_picture_shares s where s.picture_id = id and s.to_user = gold.current_actor() and s.revoked_at is null));

-- colleagues one can share with: everyone active in the company except oneself
create function gold.personal_colleagues() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'displayName', u.display_name) order by u.display_name), '[]'::jsonb)
  from gold.users u where u.is_active and u.id <> gold.require_actor()
$$;

-- the person's own pictures, now saying who each is shared with
create or replace function gold.personal_list(p jsonb) returns jsonb language plpgsql stable as $$
declare v_size int := least(greatest(coalesce(nullif(p->>'size', '')::int, 60), 1), 500); v_page int := greatest(coalesce(nullif(p->>'page', '')::int, 1), 1);
  v_q text := nullif(trim(coalesce(p->>'q', '')), '');
begin
  perform gold.require_actor();
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(gold.personal_json(x) || jsonb_build_object('sharedWith', coalesce((
          select jsonb_agg(gold.person_json(s.to_user) order by s.created_at) from gold.personal_picture_shares s where s.picture_id = x.id and s.revoked_at is null), '[]'::jsonb))
        order by x.created_at desc, x.id) from (
        select * from gold.personal_pictures where owner_id = gold.current_actor() and (v_q is null or caption ilike '%' || v_q || '%')
        order by created_at desc, id offset (v_page - 1) * v_size limit v_size) x), '[]'::jsonb),
    'total', (select count(*) from gold.personal_pictures where owner_id = gold.current_actor() and (v_q is null or caption ilike '%' || v_q || '%')),
    'page', v_page, 'size', v_size, 'usage', gold.personal_usage(), 'sharedCount', gold.personal_shared_count());
end $$;

-- pictures other people have shared with the caller, newest share first. p: { page, size }
create function gold.personal_shared_list(p jsonb) returns jsonb language plpgsql stable as $$
declare v_size int := least(greatest(coalesce(nullif(p->>'size', '')::int, 60), 1), 500); v_page int := greatest(coalesce(nullif(p->>'page', '')::int, 1), 1);
begin
  perform gold.require_actor();
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(gold.personal_json(x.pic) || jsonb_build_object('sharedBy', gold.person_json(x.owner_id), 'sharedAt', gold.iso(x.created_at)) order by x.created_at desc, x.picture_id) from (
        select s.picture_id, s.owner_id, s.created_at, pp as pic
        from gold.personal_picture_shares s join gold.personal_pictures pp on pp.id = s.picture_id
        where s.to_user = gold.current_actor() and s.revoked_at is null and s.hidden_at is null
        order by s.created_at desc, s.picture_id offset (v_page - 1) * v_size limit v_size) x), '[]'::jsonb),
    'total', (select count(*) from gold.personal_picture_shares s where s.to_user = gold.current_actor() and s.revoked_at is null and s.hidden_at is null),
    'page', v_page, 'size', v_size);
end $$;

-- how many pictures are shared with the caller right now (the number on the "Shared with me" tab)
create function gold.personal_shared_count() returns int language sql stable as $$
  select count(*)::int from gold.personal_picture_shares s where s.to_user = gold.current_actor() and s.revoked_at is null and s.hidden_at is null
$$;

-- share some of the caller's own pictures with one colleague. Sharing again after stopping starts a fresh share.
create function gold.personal_share(p_ids uuid[], p_to uuid) returns jsonb language plpgsql as $$
declare v_user uuid := gold.require_actor(); v_n int := 0; v_new int := 0; r record; v_name text; v_one int;
begin
  if p_to is null or p_to = v_user then perform gold.fail(422, 'VALIDATION_FAILED', 'Choose a colleague to share with.'); end if;
  select display_name into v_name from gold.users where id = p_to and is_active;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That person was not found.'); end if;
  if coalesce(array_length(p_ids, 1), 0) not between 1 and 100 then perform gold.fail(422, 'VALIDATION_FAILED', 'Choose between 1 and 100 pictures.'); end if;
  for r in select id from gold.personal_pictures where id = any (p_ids) and owner_id = v_user loop
    v_n := v_n + 1;
    insert into gold.personal_picture_shares (picture_id, tenant_id, owner_id, to_user) values (r.id, gold.current_tenant(), v_user, p_to)
    on conflict (picture_id, to_user) do update set revoked_at = null, hidden_at = null, created_at = now() where gold.personal_picture_shares.revoked_at is not null
    returning 1 into v_one;
    if found then v_new := v_new + 1; end if;
  end loop;
  if v_n = 0 then perform gold.fail(404, 'NOT_FOUND', 'Those pictures were not found.'); end if;
  if v_new > 0 then
    perform gold.audit('personal.shared', 'user', p_to::text, null, jsonb_build_object('to', p_to, 'count', v_new));
    perform gold.notify_user(gold.current_tenant(), p_to, 'personal_shared',
      format('%s shared %s with you', (select display_name from gold.users where id = v_user), case when v_new = 1 then 'a picture' else v_new || ' pictures' end),
      'Open My pictures to see it.', '/my-pictures?tab=shared');
  end if;
  return jsonb_build_object('shared', v_new, 'already', v_n - v_new);
end $$;

-- stop sharing. p_to null: stop sharing these pictures with everyone.
create function gold.personal_unshare(p_ids uuid[], p_to uuid) returns jsonb language plpgsql as $$
declare v_user uuid := gold.require_actor(); v_n int;
begin
  with u as (update gold.personal_picture_shares set revoked_at = now()
             where picture_id = any (coalesce(p_ids, '{}')) and owner_id = v_user and revoked_at is null and (p_to is null or to_user = p_to) returning to_user)
  select count(*) into v_n from u;
  if v_n > 0 then perform gold.audit('personal.unshared', 'user', coalesce(p_to::text, 'all'), null, jsonb_build_object('to', p_to, 'count', v_n)); end if;
  return jsonb_build_object('stopped', v_n);
end $$;

-- take pictures off the caller's own "Shared with me" list (the owner is not told, and can still stop sharing)
create function gold.personal_shared_hide(p_ids uuid[]) returns jsonb language plpgsql as $$
declare v_n int;
begin
  perform gold.require_actor();
  with u as (update gold.personal_picture_shares set hidden_at = now() where picture_id = any (coalesce(p_ids, '{}')) and to_user = gold.current_actor() and hidden_at is null returning 1)
  select count(*) into v_n from u;
  return jsonb_build_object('hidden', v_n);
end $$;

-- a picture's file for its owner or for someone it is actively shared with
create or replace function gold.personal_open(p_id uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('storageKey', p.storage_key, 'thumbKey', p.thumb_key, 'sha256', p.sha256, 'fileName', p.file_name)
  from gold.personal_pictures p
  where p.id = p_id and (p.owner_id = gold.current_actor()
    or exists (select 1 from gold.personal_picture_shares s where s.picture_id = p.id and s.to_user = gold.current_actor() and s.revoked_at is null))
$$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant select, insert, update on gold.personal_picture_shares to gold_app;
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;