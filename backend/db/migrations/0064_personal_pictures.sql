-- 0064 (B65): "My pictures", a private camera for every user.
--   * Pictures a person takes for themselves, kept apart from the company's photos (gold.attachments). Nothing in the Photos library, the
--     missing-photo list, the ID-view log or the removal tools can reach them, because they are a different table.
--   * Only the owner can read or change a picture: row-level security checks the signed-in user, so no role or permission unlocks it.
--     The one exception is the clean-up of people who left (see gold.personal_pictures_purge), which only ever sees inactive owners' rows.
--   * Deleting is real: the row goes (the files are removed by the server straight after). No audit line is written for taking, viewing or
--     deleting a picture. (Sharing, in the next step, writes only "shared with" and "stopped sharing" lines.)
--   * Company settings: personalPictures.enabled, .maxPerUser, .maxMb, .purgeDays (days after a person is deactivated).
create or replace function gold.setting_defaults() returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'payout.twoStep', false,
    'payout.sameUserMayPay', true,
    'payout.blindCheck', false,
    'count.blind', false,
    'customers.autoCreate', true,
    'offline.maxDays', 7,
    'drawer.looseBranches', '[]'::jsonb,
    'market.worldChart', true,
    'photos.cameraOnly', false,
    'personalPictures.enabled', true,
    'personalPictures.maxPerUser', 300,
    'personalPictures.maxMb', 300,
    'personalPictures.purgeDays', 90,
    'allowance.perPerson', 100,
    'receipt.printer', false,
    'receipt.paper', '80',
    'receipt.businessName', '',
    'receipt.tagline', '',
    'receipt.address', '',
    'receipt.phone', '',
    'receipt.footer', '')
$$;

create table gold.personal_pictures (
  id          uuid primary key,
  tenant_id   uuid not null references gold.tenants (id),
  owner_id    uuid not null references gold.users (id),
  caption     text,
  file_name   text,
  size_bytes  int  not null check (size_bytes > 0),
  width       int,
  height      int,
  taken_at    timestamptz,
  sha256      text not null,
  storage_key text not null,
  thumb_key   text,
  created_at  timestamptz not null default now()
);
create index personal_pictures_owner on gold.personal_pictures (tenant_id, owner_id, created_at desc);
alter table gold.personal_pictures enable row level security;
alter table gold.personal_pictures force row level security;
-- the owner, and nobody else; the purge flag only opens rows whose owner has been deactivated
create policy owner_only on gold.personal_pictures
  using (tenant_id = gold.current_tenant() and (
           owner_id = gold.current_actor()
           or (coalesce(current_setting('app.personal_purge', true), '') = 'on' and exists (select 1 from gold.users u where u.id = owner_id and not u.is_active))))
  with check (tenant_id = gold.current_tenant() and owner_id = gold.current_actor());

-- companies that have personal pictures, so the clean-up worker knows where to look (it has no signed-in user)
create table gold.personal_purge_registry (tenant_id uuid primary key references gold.tenants (id));

create function gold.personal_json(p gold.personal_pictures) returns jsonb language sql stable as $$
  select jsonb_build_object('id', p.id, 'caption', p.caption, 'fileName', p.file_name, 'size', p.size_bytes, 'width', p.width, 'height', p.height,
    'takenAt', gold.iso(coalesce(p.taken_at, p.created_at)), 'createdAt', gold.iso(p.created_at))
$$;

-- the person's own use against the company's limits
create function gold.personal_usage() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'enabled', coalesce((gold.setting('personalPictures.enabled'))::boolean, true),
    'count', (select count(*) from gold.personal_pictures where owner_id = gold.current_actor()),
    'bytes', (select coalesce(sum(size_bytes), 0) from gold.personal_pictures where owner_id = gold.current_actor()),
    'maxCount', greatest(coalesce((gold.setting('personalPictures.maxPerUser'))::int, 300), 1),
    'maxMb', greatest(coalesce((gold.setting('personalPictures.maxMb'))::int, 300), 1))
$$;

-- keep a picture. p: { id, fileName, size, sha256, storageKey, thumbKey, width, height, takenAt }. Sending the same id again changes nothing.
create function gold.personal_add(p jsonb) returns jsonb language plpgsql as $$
declare v_user uuid := gold.require_actor(); v_id uuid := (p->>'id')::uuid; a gold.personal_pictures; u jsonb := gold.personal_usage(); v_size int := (p->>'size')::int;
begin
  select * into a from gold.personal_pictures where id = v_id and owner_id = v_user;
  if found then return jsonb_build_object('replayed', true, 'data', gold.personal_json(a)); end if;
  if not (u->>'enabled')::boolean then perform gold.fail(403, 'PERSONAL_OFF', 'Personal pictures are switched off for this company.'); end if;
  if (u->>'count')::int >= (u->>'maxCount')::int then
    perform gold.fail(422, 'PERSONAL_FULL', format('You have reached the limit of %s pictures. Delete some to take more.', u->>'maxCount'));
  end if;
  if (u->>'bytes')::bigint + v_size > (u->>'maxMb')::bigint * 1024 * 1024 then
    perform gold.fail(422, 'PERSONAL_FULL', format('Your pictures are using all of your %s MB. Delete some to take more.', u->>'maxMb'));
  end if;
  begin
    insert into gold.personal_pictures (id, tenant_id, owner_id, file_name, size_bytes, width, height, taken_at, sha256, storage_key, thumb_key)
    values (v_id, gold.current_tenant(), v_user, nullif(p->>'fileName', ''), v_size, nullif(p->>'width', '')::int, nullif(p->>'height', '')::int,
            least(coalesce(nullif(p->>'takenAt', '')::timestamptz, now()), now()), p->>'sha256', p->>'storageKey', nullif(p->>'thumbKey', ''))
    returning * into a;
  exception when unique_violation then
    perform gold.fail(409, 'ID_IN_USE', 'That picture id is already used.');   -- someone else's id: say nothing more
  end;
  insert into gold.personal_purge_registry (tenant_id) values (gold.current_tenant()) on conflict do nothing;
  return jsonb_build_object('replayed', false, 'data', gold.personal_json(a));
end $$;

-- the person's own pictures, newest first. p: { q (caption search), page, size }
create function gold.personal_list(p jsonb) returns jsonb language plpgsql stable as $$
declare v_size int := least(greatest(coalesce(nullif(p->>'size', '')::int, 60), 1), 500); v_page int := greatest(coalesce(nullif(p->>'page', '')::int, 1), 1);
  v_q text := nullif(trim(coalesce(p->>'q', '')), '');
begin
  perform gold.require_actor();
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(gold.personal_json(x) order by x.created_at desc, x.id) from (
        select * from gold.personal_pictures where owner_id = gold.current_actor() and (v_q is null or caption ilike '%' || v_q || '%')
        order by created_at desc, id offset (v_page - 1) * v_size limit v_size) x), '[]'::jsonb),
    'total', (select count(*) from gold.personal_pictures where owner_id = gold.current_actor() and (v_q is null or caption ilike '%' || v_q || '%')),
    'page', v_page, 'size', v_size, 'usage', gold.personal_usage());
end $$;

create function gold.personal_set_caption(p_id uuid, p_caption text) returns jsonb language plpgsql as $$
declare a gold.personal_pictures;
begin
  perform gold.require_actor();
  update gold.personal_pictures set caption = left(nullif(trim(coalesce(p_caption, '')), ''), 200) where id = p_id and owner_id = gold.current_actor() returning * into a;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That picture was not found.'); end if;
  return gold.personal_json(a);
end $$;

-- delete the person's own pictures for good; returns the files the server must now remove: [{ storageKey, thumbKey }]
create function gold.personal_delete(p_ids uuid[]) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform gold.require_actor();
  with d as (delete from gold.personal_pictures where id = any (coalesce(p_ids, '{}')) and owner_id = gold.current_actor() returning storage_key, thumb_key)
  select coalesce(jsonb_agg(jsonb_build_object('storageKey', storage_key, 'thumbKey', thumb_key)), '[]'::jsonb) into r from d;
  return r;
end $$;

-- where a picture's file is, for its owner only; null when it is not theirs (or is gone)
create function gold.personal_open(p_id uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('storageKey', p.storage_key, 'thumbKey', p.thumb_key, 'sha256', p.sha256, 'fileName', p.file_name)
  from gold.personal_pictures p where p.id = p_id and p.owner_id = gold.current_actor()
$$;

-- the clean-up for one company: pictures of people deactivated more than purgeDays ago. Returns the files to remove.
create function gold.personal_pictures_purge() returns jsonb language plpgsql as $$
declare v_days int := greatest(coalesce((gold.setting('personalPictures.purgeDays'))::int, 90), 1); r jsonb;
begin
  perform set_config('app.personal_purge', 'on', true);
  with d as (
    delete from gold.personal_pictures p
    where exists (select 1 from gold.users u where u.id = p.owner_id and not u.is_active and u.updated_at < now() - make_interval(days => v_days))
    returning storage_key, thumb_key)
  select coalesce(jsonb_agg(jsonb_build_object('storageKey', storage_key, 'thumbKey', thumb_key)), '[]'::jsonb) into r from d;
  perform set_config('app.personal_purge', 'off', true);
  return r;
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant select, insert, update, delete on gold.personal_pictures to gold_app;
    grant select, insert on gold.personal_purge_registry to gold_app;
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;