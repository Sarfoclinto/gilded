-- 0042 Price feed: three gaps found walking through "the price feed fails or jumps".
--   1. A held price that a director dismissed (or accepted) was held and announced again at the next look, every few minutes until the
--      window ended. Now the same price (same figure, same publication time) is held only once.
--   2. A failure that goes on was announced once and then never again. It is now repeated every 3 hours while it continues.
--   3. If a check window ends and nothing at all happened in it (no new price, no failure, nothing held), directors are told so
--      ("No new GoldBod price between 10:30 and 11:30"), once per window. The worker calls gold.feed_missed_check each cycle.

alter table gold.price_feed_events drop constraint price_feed_events_kind_check;
alter table gold.price_feed_events add constraint price_feed_events_kind_check check (kind in ('applied', 'held', 'failed', 'missed'));

create or replace function gold.feed_record(p jsonb) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant(); v_actor uuid := gold.require_actor(); v_kind text := p->>'kind'; v_base numeric := (p->>'basePrice')::numeric;
  v_pub timestamptz := (p->>'publishedAt')::timestamptz; v_msg text := left(coalesce(p->>'message', ''), 500); v_snap uuid; v_prev text; v_prev_at timestamptz;
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
    -- Once a price has been held, it is the director's to decide: whatever the answer was (still waiting, accepted, dismissed), the same
    -- price is not held and announced again at the next look.
    if not exists (select 1 from gold.price_feed_events where kind = 'held' and base_price = v_base and published_at is not distinct from v_pub) then
      insert into gold.price_feed_events (tenant_id, kind, state, message, base_price, published_at, usd_per_ounce, rate, discount_pct, computed, excerpt)
      values (v_tenant, 'held', 'pending', v_msg, v_base, v_pub, (p->>'usdPerOunce')::numeric, (p->>'rate')::numeric, (p->>'discountPct')::numeric, (p->>'computed')::numeric, left(p->>'excerpt', 1500));
      perform gold.notify(v_tenant, 'price_held', 'A GoldBod price needs your confirmation', v_msg, '/prices/feed', null, 'prices:approve');
    end if;
  elsif v_kind = 'failed' then
    select kind, at into v_prev, v_prev_at from gold.price_feed_events where tenant_id = v_tenant order by at desc limit 1;
    -- Told once when it starts failing, and again if it is still failing three hours later.
    if v_prev is distinct from 'failed' or v_prev_at < now() - interval '3 hours' then
      insert into gold.price_feed_events (tenant_id, kind, state, message, excerpt) values (v_tenant, 'failed', 'done', v_msg, left(p->>'excerpt', 1500));
      perform gold.notify(v_tenant, 'price_feed_failed', 'The automatic price could not be read', v_msg || ' Set the price by hand if you need it now.', '/prices/feed', null, 'prices:approve');
    end if;
  end if;
  perform set_config('app.user_id', v_actor::text, true);
  return jsonb_build_object('result', v_kind, 'snapshotId', v_snap);
end $$;

-- Called by the worker with the current time. Looks at the most recent check window that has ended (on a chosen weekday) and, if nothing was
-- recorded since it began, records a 'missed' event and tells the people who can approve prices. Safe to call every few seconds.
create function gold.feed_missed_check(p_now timestamptz) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant(); v_actor uuid := gold.require_actor(); s gold.price_feed_settings; w jsonb;
  v_local timestamp; v_start timestamp; v_end timestamp; v_best_start timestamp; v_best_end timestamp; v_msg text;
  v_start_ts timestamptz; v_end_ts timestamptz;
begin
  select * into s from gold.price_feed_settings where tenant_id = v_tenant and enabled;
  if not found then return jsonb_build_object('result', 'off'); end if;
  v_local := p_now at time zone s.timezone;
  if not (extract(isodow from v_local)::smallint = any(s.weekdays)) then return jsonb_build_object('result', 'not a price day'); end if;
  for w in select * from jsonb_array_elements(s.windows) loop
    v_start := date_trunc('day', v_local) + (w->>'start')::time;
    v_end := date_trunc('day', v_local) + (w->>'end')::time;
    if v_end <= v_local and (v_best_end is null or v_end > v_best_end) then v_best_start := v_start; v_best_end := v_end; end if;
  end loop;
  if v_best_end is null then return jsonb_build_object('result', 'no window has ended'); end if;
  v_start_ts := v_best_start at time zone s.timezone;
  v_end_ts := v_best_end at time zone s.timezone;
  -- anything recorded since the window began means someone has already been told, or a price arrived
  if exists (select 1 from gold.price_feed_events where tenant_id = v_tenant and at >= v_start_ts) then return jsonb_build_object('result', 'something happened'); end if;
  if exists (select 1 from gold.price_snapshots where source = 'goldbod' and fetched_at >= v_start_ts) then return jsonb_build_object('result', 'price captured'); end if;
  v_msg := format('No new GoldBod price was found between %s and %s. Branches are still using the last price. Check the website, or set the price by hand.',
                  to_char(v_best_start, 'HH24:MI'), to_char(v_best_end, 'HH24:MI'));
  insert into gold.price_feed_events (tenant_id, at, kind, state, message) values (v_tenant, p_now, 'missed', 'done', v_msg);
  perform set_config('app.user_id', '', true);
  perform gold.notify(v_tenant, 'price_feed_missed', 'No new GoldBod price this time', v_msg, '/prices/feed', null, 'prices:approve');
  perform set_config('app.user_id', v_actor::text, true);
  return jsonb_build_object('result', 'missed');
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;