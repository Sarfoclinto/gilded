-- 0023 Automatic reference price (B7d). The API reads GoldBod's published price at the times a director chooses and records it as the new reference
--  price. Margins are not trusted to carry over silently: by default each branch's margin comes along as PROVISIONAL, which notifies the people who can
--  approve prices. A price that does not add up (checked against the LBMA price and exchange rate on the page) or that jumps too far is HELD for a
--  director to accept, never applied by itself.

create table gold.price_feed_settings (
  tenant_id       uuid primary key references gold.tenants (id),
  enabled         boolean not null default false,
  -- check windows in the company's local time: [{ "start": "10:30", "end": "11:30", "everyMinutes": 5 }]. A window stops being checked once a new price is captured.
  windows         jsonb not null default '[{"start":"10:30","end":"11:30","everyMinutes":5},{"start":"15:00","end":"16:00","everyMinutes":5}]',
  weekdays        smallint[] not null default '{1,2,3,4,5}',      -- ISO: 1 = Monday ... 7 = Sunday
  timezone        text not null default 'Africa/Accra',
  margin_policy   text not null default 'approve' check (margin_policy in ('approve', 'carry')),
  max_jump_pct    numeric(5,2) not null default 10 check (max_jump_pct between 1 and 50),
  updated_by      uuid not null,
  updated_at      timestamptz not null default now(),
  last_checked_at timestamptz,
  last_result     text,
  foreign key (tenant_id, updated_by) references gold.users (tenant_id, id)
);
alter table gold.price_feed_settings enable row level security;
alter table gold.price_feed_settings force row level security;
create policy tenant_isolation on gold.price_feed_settings using (tenant_id = gold.current_tenant()) with check (tenant_id = gold.current_tenant());

-- Which companies have the feed switched on. Holds company ids only, so the background worker can find them without reading any company's data.
create table gold.price_feed_registry (tenant_id uuid primary key references gold.tenants (id));

create table gold.price_feed_events (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references gold.tenants (id),
  at           timestamptz not null default clock_timestamp(),
  kind         text not null check (kind in ('applied', 'held', 'failed')),
  state        text not null default 'done' check (state in ('done', 'pending', 'accepted', 'dismissed')),
  message      text not null,
  base_price   numeric(18,2),
  published_at timestamptz,
  usd_per_ounce numeric(18,4),
  rate         numeric(18,6),
  discount_pct numeric(7,4),
  computed     numeric(18,2),
  excerpt      text,
  decided_by   uuid,
  decided_at   timestamptz
);
create index price_feed_events_recent on gold.price_feed_events (tenant_id, at desc);
alter table gold.price_feed_events enable row level security;
alter table gold.price_feed_events force row level security;
create policy tenant_isolation on gold.price_feed_events using (tenant_id = gold.current_tenant()) with check (tenant_id = gold.current_tenant());

-- ---------------------------------------------------------------- reading and saving settings
create function gold.price_feed_json() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'enabled', coalesce(s.enabled, false),
    'windows', coalesce(s.windows, '[{"start":"10:30","end":"11:30","everyMinutes":5},{"start":"15:00","end":"16:00","everyMinutes":5}]'::jsonb),
    'weekdays', coalesce(to_jsonb(s.weekdays), '[1,2,3,4,5]'::jsonb),
    'timezone', coalesce(s.timezone, 'Africa/Accra'),
    'marginPolicy', coalesce(s.margin_policy, 'approve'),
    'maxJumpPct', gold.ts(coalesce(s.max_jump_pct, 10)),
    'updatedBy', case when s.updated_by is null then null else gold.person_json(s.updated_by) end,
    'lastCheckedAt', gold.iso(s.last_checked_at), 'lastResult', s.last_result,
    'latest', (select jsonb_build_object('basePrice', gold.ts(p.base_price), 'publishedAt', gold.iso(p.published_at), 'source', p.source)
               from gold.price_snapshots p order by p.published_at desc, p.fetched_at desc limit 1),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'at', gold.iso(e.at), 'kind', e.kind, 'state', e.state, 'message', e.message, 'basePrice', gold.ts(e.base_price),
        'publishedAt', gold.iso(e.published_at), 'usdPerOunce', gold.ts(e.usd_per_ounce), 'rate', gold.ts(e.rate), 'computed', gold.ts(e.computed),
        'excerpt', e.excerpt, 'decidedBy', case when e.decided_by is null then null else gold.person_json(e.decided_by) end) order by e.at desc)
        from (select * from gold.price_feed_events where tenant_id = gold.current_tenant() order by at desc limit 20) e), '[]'::jsonb))
  from (select 1) one left join gold.price_feed_settings s on s.tenant_id = gold.current_tenant()
$$;

create function gold.set_price_feed_settings(p jsonb) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant(); v_user uuid := gold.require_actor(); w jsonb; v_wd smallint[]; v_policy text := coalesce(p->>'marginPolicy', 'approve');
  v_jump numeric := coalesce((p->>'maxJumpPct')::numeric, 10); v_tz text := coalesce(nullif(p->>'timezone', ''), 'Africa/Accra'); v_on boolean := coalesce((p->>'enabled')::boolean, false);
begin
  if jsonb_typeof(p->'windows') <> 'array' or jsonb_array_length(p->'windows') > 6 or (v_on and jsonb_array_length(p->'windows') = 0) then
    perform gold.fail(422, 'VALIDATION_FAILED', 'Give 1 to 6 check times.');
  end if;
  for w in select * from jsonb_array_elements(p->'windows') loop
    if (w->>'start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (w->>'end') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (w->>'start') >= (w->>'end') then
      perform gold.fail(422, 'VALIDATION_FAILED', 'Each check time needs a start and a later end, like 10:30 to 11:30.');
    end if;
    if coalesce((w->>'everyMinutes')::int, 0) not between 1 and 120 then perform gold.fail(422, 'VALIDATION_FAILED', 'Check every 1 to 120 minutes.'); end if;
  end loop;
  select coalesce(array_agg(distinct x::smallint order by x::smallint), '{}') into v_wd from jsonb_array_elements_text(coalesce(p->'weekdays', '[]'::jsonb)) x where x::int between 1 and 7;
  if cardinality(v_wd) = 0 then perform gold.fail(422, 'VALIDATION_FAILED', 'Choose at least one day of the week.'); end if;
  if v_policy not in ('approve', 'carry') then perform gold.fail(422, 'VALIDATION_FAILED', 'Unknown margin choice.'); end if;
  if v_jump < 1 or v_jump > 50 then perform gold.fail(422, 'VALIDATION_FAILED', 'The largest change allowed must be between 1 and 50 percent.'); end if;
  if not exists (select 1 from pg_timezone_names where name = v_tz) then perform gold.fail(422, 'VALIDATION_FAILED', 'Unknown time zone.'); end if;

  insert into gold.price_feed_settings (tenant_id, enabled, windows, weekdays, timezone, margin_policy, max_jump_pct, updated_by)
  values (v_tenant, v_on, p->'windows', v_wd, v_tz, v_policy, v_jump, v_user)
  on conflict (tenant_id) do update set enabled = excluded.enabled, windows = excluded.windows, weekdays = excluded.weekdays, timezone = excluded.timezone,
    margin_policy = excluded.margin_policy, max_jump_pct = excluded.max_jump_pct, updated_by = excluded.updated_by, updated_at = now();
  if v_on then insert into gold.price_feed_registry (tenant_id) values (v_tenant) on conflict do nothing;
  else delete from gold.price_feed_registry where tenant_id = v_tenant; end if;
  return gold.price_feed_json();
end $$;

-- ---------------------------------------------------------------- applying a price
-- Records the price and carries every branch's margin onto it: as provisional (so approvers are told) or unchanged, by the company's choice.
create function gold.feed_apply(p_base numeric, p_published timestamptz, p_raw jsonb, p_actor uuid) returns uuid language plpgsql as $$
declare v_tenant uuid := gold.current_tenant(); v_snap uuid; v_policy text;
begin
  select margin_policy into v_policy from gold.price_feed_settings where tenant_id = v_tenant;
  v_policy := coalesce(v_policy, 'approve');
  insert into gold.price_snapshots (tenant_id, source, base_price, published_at, raw, created_by)
  values (v_tenant, 'goldbod', p_base, least(p_published, now()), p_raw, p_actor) returning id into v_snap;
  insert into gold.branch_prices (tenant_id, branch_id, snapshot_id, margin, status, set_by, approved_by, approved_at, effective_from, created_at)
  select l.tenant_id, l.branch_id, v_snap, l.margin,
         case when v_policy = 'carry' then l.status else 'provisional' end, p_actor,
         case when v_policy = 'carry' then l.approved_by end, case when v_policy = 'carry' then l.approved_at end, clock_timestamp(), clock_timestamp()
  from (select distinct on (branch_id) * from gold.branch_prices order by branch_id, effective_from desc, created_at desc) l
  join gold.branches b on b.id = l.branch_id and b.is_active;
  return v_snap;
end $$;

-- What the worker needs to decide whether to look now: the settings, the newest price and when the last captured price was taken.
create function gold.price_feed_state() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'enabled', s.enabled, 'windows', s.windows, 'weekdays', to_jsonb(s.weekdays), 'timezone', s.timezone, 'maxJumpPct', gold.ts(s.max_jump_pct),
    'actor', s.updated_by, 'lastCheckedAt', gold.iso(s.last_checked_at),
    'lastCapturedAt', (select gold.iso(max(fetched_at)) from gold.price_snapshots where source = 'goldbod'),
    'latestFeedPublishedAt', (select gold.iso(max(published_at)) from gold.price_snapshots where source = 'goldbod'),
    'latestBase', (select gold.ts(base_price) from gold.price_snapshots order by published_at desc, fetched_at desc limit 1),
    'poundGrams', (select params->>'poundGrams' from gold.formula_versions where key = 'ExcelV1'),
    'referenceKarat', (select params->>'priceReferenceKarat' from gold.formula_versions where key = 'ExcelV1'))
  from gold.price_feed_settings s where s.tenant_id = gold.current_tenant()
$$;

-- p: { kind: unchanged | applied | held | failed, message, basePrice?, publishedAt?, usdPerOunce?, rate?, discountPct?, computed?, excerpt? }
create function gold.feed_record(p jsonb) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant(); v_actor uuid := gold.require_actor(); v_kind text := p->>'kind'; v_base numeric := (p->>'basePrice')::numeric;
  v_pub timestamptz := (p->>'publishedAt')::timestamptz; v_msg text := left(coalesce(p->>'message', ''), 500); v_snap uuid; v_prev text;
begin
  if v_kind not in ('unchanged', 'applied', 'held', 'failed') then perform gold.fail(422, 'VALIDATION_FAILED', 'Unknown result.'); end if;
  update gold.price_feed_settings set last_checked_at = now(), last_result = v_msg where tenant_id = v_tenant;
  -- The signed-in "actor" here is only the director whose name the automatic price is recorded under. Everyone who can approve prices,
  -- that director included, should hear about it, so notifications are sent as if nobody had acted.
  perform set_config('app.user_id', '', true);

  if v_kind = 'applied' then
    if exists (select 1 from gold.price_snapshots where source = 'goldbod' and published_at = v_pub) then
      perform set_config('app.user_id', v_actor::text, true);
      return jsonb_build_object('result', 'unchanged');
    end if;
    v_snap := gold.feed_apply(v_base, v_pub, p - 'excerpt', v_actor);
    insert into gold.price_feed_events (tenant_id, kind, state, message, base_price, published_at, usd_per_ounce, rate, discount_pct, computed)
    values (v_tenant, 'applied', 'done', v_msg, v_base, v_pub, (p->>'usdPerOunce')::numeric, (p->>'rate')::numeric, (p->>'discountPct')::numeric, (p->>'computed')::numeric);
  elsif v_kind = 'held' then
    if not exists (select 1 from gold.price_feed_events where kind = 'held' and state = 'pending' and base_price = v_base and published_at = v_pub) then
      insert into gold.price_feed_events (tenant_id, kind, state, message, base_price, published_at, usd_per_ounce, rate, discount_pct, computed, excerpt)
      values (v_tenant, 'held', 'pending', v_msg, v_base, v_pub, (p->>'usdPerOunce')::numeric, (p->>'rate')::numeric, (p->>'discountPct')::numeric, (p->>'computed')::numeric, left(p->>'excerpt', 1500));
      perform gold.notify(v_tenant, 'price_held', 'A GoldBod price needs your confirmation', v_msg, '/prices/feed', null, 'prices:approve');
    end if;
  elsif v_kind = 'failed' then
    select kind into v_prev from gold.price_feed_events where tenant_id = v_tenant order by at desc limit 1;
    if v_prev is distinct from 'failed' then
      insert into gold.price_feed_events (tenant_id, kind, state, message, excerpt) values (v_tenant, 'failed', 'done', v_msg, left(p->>'excerpt', 1500));
      perform gold.notify(v_tenant, 'price_feed_failed', 'The automatic price could not be read', v_msg || ' Set the price by hand if you need it now.', '/prices/feed', null, 'prices:approve');
    end if;
  end if;
  perform set_config('app.user_id', v_actor::text, true);
  return jsonb_build_object('result', v_kind, 'snapshotId', v_snap);
end $$;

-- A director accepts or dismisses a held price.
create function gold.feed_decide(p_event uuid, p_accept boolean) returns jsonb language plpgsql as $$
declare v_user uuid := gold.require_actor(); e gold.price_feed_events;
begin
  select * into e from gold.price_feed_events where id = p_event and kind = 'held' for update;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That price was not found.'); end if;
  if e.state <> 'pending' then perform gold.fail(409, 'ALREADY_DECIDED', 'This price was already decided.'); end if;
  if p_accept then
    if not exists (select 1 from gold.price_snapshots where source = 'goldbod' and published_at = e.published_at) then
      perform gold.feed_apply(e.base_price, e.published_at, jsonb_build_object('acceptedHeld', true, 'usdPerOunce', e.usd_per_ounce, 'rate', e.rate), v_user);
    end if;
  end if;
  update gold.price_feed_events set state = case when p_accept then 'accepted' else 'dismissed' end, decided_by = v_user, decided_at = now() where id = p_event;
  return gold.price_feed_json();
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant select, insert, update on gold.price_feed_settings to gold_app;
    grant select, insert, update on gold.price_feed_events to gold_app;
    grant select, insert, delete on gold.price_feed_registry to gold_app;
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;