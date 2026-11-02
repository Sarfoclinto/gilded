-- 0046 The Guide: the business's rules, dos and don'ts and how-tos, written by directors and read by everyone.
--   categories   group the articles (for the writer and the reader)
--   articles     a title, a kind, and content made of blocks (heading, text, list, callout, image, flow, divider); draft or published
--   reads        who has read which version; publishing a real change (version + 1) makes everyone read it again
--   settings     reminders: how often, at what time, and who (people with something unread, or everyone)
-- Content is plain data (never HTML), images are small data URLs inside the blocks, so the reader can render it without trusting it.

create table gold.guide_categories (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references gold.tenants (id),
  name       text not null check (char_length(trim(name)) between 2 and 60),
  position   int not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index guide_categories_name on gold.guide_categories (tenant_id, lower(trim(name)));

create table gold.guide_articles (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references gold.tenants (id),
  category_id  uuid,
  title        text not null check (char_length(trim(title)) between 3 and 120),
  summary      text check (summary is null or char_length(summary) <= 240),
  kind         text not null default 'rule' check (kind in ('rule', 'dos_donts', 'howto', 'info')),
  blocks       jsonb not null default '[]'::jsonb check (jsonb_typeof(blocks) = 'array'),
  status       text not null default 'draft' check (status in ('draft', 'published')),
  version      int not null default 1,
  rev          int not null default 1,      -- bumped by every save; a save made on an older rev is refused (two people editing)
  must_read    boolean not null default true,
  position     int not null default 0,
  published_at timestamptz,
  created_by   uuid,
  updated_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, category_id) references gold.guide_categories (tenant_id, id)
);
create index guide_articles_cat on gold.guide_articles (tenant_id, category_id, position);

create table gold.guide_reads (
  tenant_id  uuid not null,
  article_id uuid not null,
  user_id    uuid not null,
  version    int not null,
  read_at    timestamptz not null default now(),
  primary key (article_id, user_id),
  foreign key (tenant_id, article_id) references gold.guide_articles (tenant_id, id) on delete cascade,
  foreign key (tenant_id, user_id) references gold.users (tenant_id, id) on delete cascade
);

create table gold.guide_settings (
  tenant_id     uuid primary key references gold.tenants (id),
  frequency     text not null default 'off' check (frequency in ('off', 'daily', 'weekly', 'monthly')),
  remind_time   text not null default '08:00' check (remind_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  weekday       int not null default 1 check (weekday between 1 and 7),   -- ISO: 1 Monday .. 7 Sunday (used by weekly)
  audience      text not null default 'unread' check (audience in ('unread', 'everyone')),
  last_sent_on  date,
  updated_by    uuid,
  updated_at    timestamptz not null default now()
);
-- Which companies have reminders on, so the background worker can find them without reading any company's data.
create table gold.guide_reminder_registry (tenant_id uuid primary key references gold.tenants (id));

do $$
declare t text;
begin
  foreach t in array array['guide_categories', 'guide_articles', 'guide_reads', 'guide_settings'] loop
    execute format('alter table gold.%I enable row level security', t);
    execute format('alter table gold.%I force row level security', t);
    execute format('create policy tenant_isolation on gold.%I using (tenant_id = gold.current_tenant()) with check (tenant_id = gold.current_tenant())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- content checks
-- Blocks: heading {text} · text {text} · list {style: bullets|numbers|dos|donts, items[]} · callout {tone: info|warning|danger|success, title?, text}
--         image {src: data URL, caption?} · flow {title?, nodes[{kind: step|decision|end, text, yes?, no?}]} · divider
create function gold.guide_check_blocks(b jsonb) returns void language plpgsql immutable as $$
declare x jsonb; i jsonb; v_images int := 0;
begin
  if jsonb_typeof(b) <> 'array' then perform gold.fail(422, 'VALIDATION_FAILED', 'The content must be a list of blocks.'); end if;
  if jsonb_array_length(b) > 80 then perform gold.fail(422, 'VALIDATION_FAILED', 'Too many blocks in one article (80 at most). Split it into two.'); end if;
  if length(b::text) > 6000000 then perform gold.fail(422, 'VALIDATION_FAILED', 'This article is too large. Use fewer or smaller pictures.'); end if;
  for x in select * from jsonb_array_elements(b) loop
    if jsonb_typeof(x) <> 'object' then perform gold.fail(422, 'VALIDATION_FAILED', 'A block is not valid.'); end if;
    case x->>'type'
      when 'heading', 'text' then
        if char_length(coalesce(x->>'text', '')) > 5000 then perform gold.fail(422, 'VALIDATION_FAILED', 'A piece of text is too long (5000 characters at most).'); end if;
      when 'list' then
        if (x->>'style') not in ('bullets', 'numbers', 'dos', 'donts') or jsonb_typeof(x->'items') <> 'array' or jsonb_array_length(x->'items') > 50 then
          perform gold.fail(422, 'VALIDATION_FAILED', 'A list is not valid.'); end if;
      when 'callout' then
        if (x->>'tone') not in ('info', 'warning', 'danger', 'success') or char_length(coalesce(x->>'text', '')) > 3000 then
          perform gold.fail(422, 'VALIDATION_FAILED', 'A callout is not valid.'); end if;
      when 'image' then
        v_images := v_images + 1;
        if coalesce(x->>'src', '') !~ '^data:image/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$' then
          perform gold.fail(422, 'VALIDATION_FAILED', 'Only PNG, JPEG, WebP or GIF pictures can be added.'); end if;
        if length(x->>'src') > 2500000 then perform gold.fail(422, 'VALIDATION_FAILED', 'A picture is too large. Use a smaller one.'); end if;
      when 'flow' then
        if jsonb_typeof(x->'nodes') <> 'array' or jsonb_array_length(x->'nodes') > 40 then perform gold.fail(422, 'VALIDATION_FAILED', 'A flowchart is not valid.'); end if;
        for i in select * from jsonb_array_elements(x->'nodes') loop
          if (i->>'kind') not in ('step', 'decision', 'end') then perform gold.fail(422, 'VALIDATION_FAILED', 'A flowchart step is not valid.'); end if;
        end loop;
      when 'divider' then null;
      else perform gold.fail(422, 'VALIDATION_FAILED', 'Unknown kind of block: ' || coalesce(x->>'type', '(none)'));
    end case;
  end loop;
  if v_images > 12 then perform gold.fail(422, 'VALIDATION_FAILED', 'Too many pictures in one article (12 at most).'); end if;
end $$;

-- ---------------------------------------------------------------- reading
create function gold.guide_unread_count(p_user uuid) returns int language sql stable as $$
  select count(*)::int from gold.guide_articles a
  where a.status = 'published' and a.must_read
    and not exists (select 1 from gold.guide_reads r where r.article_id = a.id and r.user_id = p_user and r.version >= a.version)
$$;

create function gold.guide_article_row(a gold.guide_articles, p_user uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', a.id, 'categoryId', a.category_id, 'title', a.title, 'summary', a.summary, 'kind', a.kind, 'status', a.status,
    'version', a.version, 'rev', a.rev, 'mustRead', a.must_read, 'position', a.position,
    'publishedAt', gold.iso(a.published_at), 'updatedAt', gold.iso(a.updated_at),
    'read', exists (select 1 from gold.guide_reads r where r.article_id = a.id and r.user_id = p_user and r.version >= a.version),
    'readAt', (select gold.iso(r.read_at) from gold.guide_reads r where r.article_id = a.id and r.user_id = p_user))
$$;

-- What a person sees: published articles by category (no content), and how many they still have to read.
create function gold.guide_json() returns jsonb language plpgsql stable as $$
declare v_user uuid := gold.require_actor();
begin
  return jsonb_build_object(
    'unread', gold.guide_unread_count(v_user),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'position', c.position) order by c.position, c.name) from gold.guide_categories c), '[]'::jsonb),
    'articles', coalesce((select jsonb_agg(gold.guide_article_row(a, v_user) order by a.position, a.published_at desc) from gold.guide_articles a where a.status = 'published'), '[]'::jsonb));
end $$;

-- One article with its content. Drafts are for people who write (the API checks), so a reader asking for a draft gets "not found".
create function gold.guide_article_json(p_id uuid, p_include_draft boolean default false) returns jsonb language plpgsql stable as $$
declare v_user uuid := gold.require_actor(); a gold.guide_articles;
begin
  select * into a from gold.guide_articles where id = p_id and (status = 'published' or p_include_draft);
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That article was not found.'); end if;
  return gold.guide_article_row(a, v_user) || jsonb_build_object('blocks', a.blocks);
end $$;

create function gold.guide_mark_read(p_id uuid) returns jsonb language plpgsql as $$
declare v_user uuid := gold.require_actor(); a gold.guide_articles;
begin
  select * into a from gold.guide_articles where id = p_id and status = 'published';
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That article was not found.'); end if;
  insert into gold.guide_reads (tenant_id, article_id, user_id, version) values (gold.current_tenant(), a.id, v_user, a.version)
  on conflict (article_id, user_id) do update set version = excluded.version, read_at = now();
  return jsonb_build_object('unread', gold.guide_unread_count(v_user));
end $$;

-- ---------------------------------------------------------------- writing (directors; the API checks the permission)
create function gold.guide_admin_json() returns jsonb language plpgsql stable as $$
declare v_user uuid := gold.require_actor(); v_staff int;
begin
  select count(*) into v_staff from gold.users where is_active;
  return jsonb_build_object(
    'staff', v_staff,
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'position', c.position) order by c.position, c.name) from gold.guide_categories c), '[]'::jsonb),
    'articles', coalesce((select jsonb_agg(gold.guide_article_row(a, v_user) || jsonb_build_object(
        'readers', (select count(*) from gold.guide_reads r join gold.users u on u.id = r.user_id and u.is_active where r.article_id = a.id and r.version >= a.version)
      ) order by a.position, a.updated_at desc) from gold.guide_articles a), '[]'::jsonb),
    'reminders', gold.guide_reminders_json());
end $$;

create function gold.guide_save_category(p jsonb) returns jsonb language plpgsql as $$
declare v_id uuid := coalesce((p->>'id')::uuid, gen_random_uuid()); v_name text := trim(coalesce(p->>'name', '')); c gold.guide_categories;
begin
  if char_length(v_name) < 2 or char_length(v_name) > 60 then perform gold.fail(422, 'VALIDATION_FAILED', 'Give the category a name (2 to 60 letters).'); end if;
  if exists (select 1 from gold.guide_categories where lower(trim(name)) = lower(v_name) and id <> v_id) then
    perform gold.fail(409, 'ALREADY_EXISTS', 'There is already a category with that name.'); end if;
  insert into gold.guide_categories (id, tenant_id, name, position) values (v_id, gold.current_tenant(), v_name, coalesce((p->>'position')::int, (select coalesce(max(position), 0) + 1 from gold.guide_categories)))
  on conflict (id) do update set name = excluded.name, position = case when p ? 'position' then excluded.position else gold.guide_categories.position end
  returning * into c;
  perform gold.audit('guide.category_saved', 'guide_category', c.id::text, null, jsonb_build_object('name', c.name));
  return jsonb_build_object('id', c.id, 'name', c.name, 'position', c.position);
end $$;

create function gold.guide_delete_category(p_id uuid) returns jsonb language plpgsql as $$
declare c gold.guide_categories;
begin
  select * into c from gold.guide_categories where id = p_id;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That category was not found.'); end if;
  if exists (select 1 from gold.guide_articles where category_id = p_id) then
    perform gold.fail(409, 'NOT_EMPTY', 'Move or delete the articles in this category first.'); end if;
  delete from gold.guide_categories where id = p_id;
  perform gold.audit('guide.category_deleted', 'guide_category', p_id::text, jsonb_build_object('name', c.name), null);
  return jsonb_build_object('id', p_id);
end $$;

-- Create or update an article (as a draft or, when already published, in place). p: { id, categoryId, title, summary, kind, mustRead, blocks, rev? }
-- Saving does not tell anyone: publishing does. A save made on an older rev is refused so two directors do not overwrite each other.
create function gold.guide_save_article(p jsonb) returns jsonb language plpgsql as $$
declare
  v_id uuid := coalesce((p->>'id')::uuid, gen_random_uuid()); a gold.guide_articles; v_actor uuid := gold.require_actor();
  v_title text := trim(coalesce(p->>'title', '')); v_blocks jsonb := coalesce(p->'blocks', '[]'::jsonb); v_cat uuid := nullif(p->>'categoryId', '')::uuid;
  v_kind text := coalesce(p->>'kind', 'rule');
begin
  if char_length(v_title) < 3 or char_length(v_title) > 120 then perform gold.fail(422, 'VALIDATION_FAILED', 'Give the article a title (3 to 120 letters).'); end if;
  if v_kind not in ('rule', 'dos_donts', 'howto', 'info') then perform gold.fail(422, 'VALIDATION_FAILED', 'Unknown kind of article.'); end if;
  if v_cat is not null and not exists (select 1 from gold.guide_categories where id = v_cat) then perform gold.fail(404, 'NOT_FOUND', 'That category was not found.'); end if;
  perform gold.guide_check_blocks(v_blocks);
  select * into a from gold.guide_articles where id = v_id for update;
  if found then
    if p ? 'rev' and (p->>'rev')::int is distinct from a.rev then
      perform gold.fail(409, 'EDIT_CONFLICT', 'Someone else changed this article while you were editing. Reload it to see their change before saving yours.');
    end if;
    update gold.guide_articles set category_id = case when p ? 'categoryId' then v_cat else category_id end, title = v_title, summary = nullif(trim(coalesce(p->>'summary', '')), ''), kind = v_kind,
      must_read = coalesce((p->>'mustRead')::boolean, must_read), blocks = v_blocks, rev = rev + 1, updated_by = v_actor, updated_at = now()
      where id = v_id returning * into a;
  else
    insert into gold.guide_articles (id, tenant_id, category_id, title, summary, kind, must_read, blocks, position, created_by, updated_by)
    values (v_id, gold.current_tenant(), v_cat, v_title, nullif(trim(coalesce(p->>'summary', '')), ''), v_kind, coalesce((p->>'mustRead')::boolean, true), v_blocks,
      (select coalesce(max(position), 0) + 1 from gold.guide_articles), v_actor, v_actor)
    returning * into a;
  end if;
  perform gold.audit('guide.article_saved', 'guide_article', a.id::text, null, jsonb_build_object('title', a.title, 'status', a.status, 'rev', a.rev));
  return gold.guide_article_row(a, v_actor) || jsonb_build_object('blocks', a.blocks);
end $$;

-- Publish (or republish). p: { notify: bool (default true), material: bool }. "material" means the meaning changed: the version goes up and
-- everyone has to read it again. The first publication is always version 1. Everyone active (except the publisher) is told when notify.
create function gold.guide_publish(p_id uuid, p jsonb default '{}'::jsonb) returns jsonb language plpgsql as $$
declare
  a gold.guide_articles; v_actor uuid := gold.require_actor(); v_notify boolean := coalesce((p->>'notify')::boolean, true);
  v_material boolean := coalesce((p->>'material')::boolean, false); v_was text; r record; v_n int := 0;
begin
  select * into a from gold.guide_articles where id = p_id for update;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That article was not found.'); end if;
  if jsonb_array_length(a.blocks) = 0 then perform gold.fail(422, 'VALIDATION_FAILED', 'Add some content before publishing.'); end if;
  v_was := a.status;
  update gold.guide_articles set status = 'published', published_at = coalesce(case when v_was = 'published' then published_at end, now()),
    version = case when v_was = 'published' and v_material then version + 1 else version end, updated_at = now(), updated_by = v_actor
    where id = p_id returning * into a;
  perform gold.audit('guide.article_published', 'guide_article', a.id::text, null, jsonb_build_object('title', a.title, 'version', a.version, 'notified', v_notify));
  if v_notify and (v_was <> 'published' or v_material) then
    for r in select id from gold.users where is_active and id <> v_actor loop
      perform gold.notify_user(gold.current_tenant(), r.id, case when v_was = 'published' then 'guide_updated' else 'guide_new' end,
        case when v_was = 'published' then 'Rules updated: ' || a.title else 'New to read: ' || a.title end,
        case when a.must_read then 'Please read this as soon as you can.' else null end, '/guide/' || a.id);
      v_n := v_n + 1;
    end loop;
  end if;
  perform gold.publish(gold.current_tenant(), 'guide', null);
  return gold.guide_article_row(a, v_actor) || jsonb_build_object('notified', v_n);
end $$;

create function gold.guide_unpublish(p_id uuid) returns jsonb language plpgsql as $$
declare a gold.guide_articles;
begin
  update gold.guide_articles set status = 'draft', updated_at = now() where id = p_id returning * into a;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That article was not found.'); end if;
  perform gold.audit('guide.article_unpublished', 'guide_article', a.id::text, null, jsonb_build_object('title', a.title));
  perform gold.publish(gold.current_tenant(), 'guide', null);
  return gold.guide_article_row(a, gold.require_actor());
end $$;

create function gold.guide_delete_article(p_id uuid) returns jsonb language plpgsql as $$
declare a gold.guide_articles;
begin
  delete from gold.guide_articles where id = p_id returning * into a;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That article was not found.'); end if;
  perform gold.audit('guide.article_deleted', 'guide_article', p_id::text, jsonb_build_object('title', a.title), null);
  perform gold.publish(gold.current_tenant(), 'guide', null);
  return jsonb_build_object('id', p_id);
end $$;

-- Who has and has not read the current version (active people only).
create function gold.guide_readers_json(p_id uuid) returns jsonb language plpgsql stable as $$
declare a gold.guide_articles;
begin
  select * into a from gold.guide_articles where id = p_id;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That article was not found.'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('userId', u.id, 'displayName', u.display_name,
      'read', coalesce(r.version >= a.version, false), 'readAt', gold.iso(r.read_at), 'readVersion', r.version) order by (coalesce(r.version >= a.version, false)), u.display_name)
    from gold.users u left join gold.guide_reads r on r.user_id = u.id and r.article_id = p_id where u.is_active), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- reminders
create function gold.guide_reminders_json() returns jsonb language sql stable as $$
  select coalesce((select jsonb_build_object('frequency', frequency, 'time', remind_time, 'weekday', weekday, 'audience', audience) from gold.guide_settings where tenant_id = gold.current_tenant()),
    jsonb_build_object('frequency', 'off', 'time', '08:00', 'weekday', 1, 'audience', 'unread'))
$$;

create function gold.set_guide_reminders(p jsonb) returns jsonb language plpgsql as $$
declare v_tenant uuid := gold.current_tenant(); v_actor uuid := gold.require_actor(); f text := coalesce(p->>'frequency', 'off'); t text := coalesce(p->>'time', '08:00');
  d int := coalesce((p->>'weekday')::int, 1); w text := coalesce(p->>'audience', 'unread');
begin
  if f not in ('off', 'daily', 'weekly', 'monthly') then perform gold.fail(422, 'VALIDATION_FAILED', 'Choose off, daily, weekly or monthly.'); end if;
  if t !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then perform gold.fail(422, 'VALIDATION_FAILED', 'Give the time as hours and minutes, for example 08:00.'); end if;
  if d not between 1 and 7 then perform gold.fail(422, 'VALIDATION_FAILED', 'Choose a day of the week.'); end if;
  if w not in ('unread', 'everyone') then perform gold.fail(422, 'VALIDATION_FAILED', 'Choose who is reminded.'); end if;
  insert into gold.guide_settings (tenant_id, frequency, remind_time, weekday, audience, updated_by) values (v_tenant, f, t, d, w, v_actor)
  on conflict (tenant_id) do update set frequency = f, remind_time = t, weekday = d, audience = w, updated_by = v_actor, updated_at = now(),
    last_sent_on = case when gold.guide_settings.frequency = f and gold.guide_settings.remind_time = t then gold.guide_settings.last_sent_on else null end;
  if f <> 'off' then insert into gold.guide_reminder_registry (tenant_id) values (v_tenant) on conflict do nothing;
  else delete from gold.guide_reminder_registry where tenant_id = v_tenant; end if;
  perform gold.audit('guide.reminders_changed', 'guide_settings', v_tenant::text, null, jsonb_build_object('frequency', f, 'time', t, 'weekday', d, 'audience', w));
  return gold.guide_reminders_json();
end $$;

-- The worker's call, safe to repeat: sends the reminder when it is due in the company's own time (its main branch's timezone) and has not
-- been sent today. Returns how many people were reminded.
create function gold.guide_reminder_run(p_now timestamptz) returns int language plpgsql as $$
declare
  s gold.guide_settings; v_tz text; v_local timestamp; v_day date; n int := 0; r record; v_count int; v_published int;
begin
  select * into s from gold.guide_settings where tenant_id = gold.current_tenant();
  if not found or s.frequency = 'off' then return 0; end if;
  select timezone into v_tz from gold.branches order by is_main desc, created_at limit 1;
  v_local := p_now at time zone coalesce(v_tz, 'Africa/Accra'); v_day := v_local::date;
  if to_char(v_local, 'HH24:MI') < s.remind_time then return 0; end if;
  if s.last_sent_on is not null and s.last_sent_on >= v_day then return 0; end if;
  if s.frequency = 'weekly' and extract(isodow from v_day)::int <> s.weekday then return 0; end if;
  if s.frequency = 'monthly' and extract(day from v_day)::int <> 1 then return 0; end if;
  update gold.guide_settings set last_sent_on = v_day where tenant_id = s.tenant_id;
  select count(*) into v_published from gold.guide_articles where status = 'published';
  if v_published = 0 then return 0; end if;
  for r in select id from gold.users where is_active loop
    v_count := gold.guide_unread_count(r.id);
    if s.audience = 'unread' and v_count = 0 then continue; end if;
    perform gold.notify_user(s.tenant_id, r.id, 'guide_reminder', 'Time to read the business rules',
      case when v_count > 0 then format('%s still to read.', v_count) else 'A short refresh of how we work.' end, '/guide');
    n := n + 1;
  end loop;
  return n;
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant select, insert, update, delete on gold.guide_categories, gold.guide_articles, gold.guide_reads, gold.guide_settings to gold_app;
    grant select, insert, delete on gold.guide_reminder_registry to gold_app;
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;