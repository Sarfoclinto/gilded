-- Fix: a branch that never had a margin got no price when a new reference price (manual or GoldBod) arrived, so the home screen showed
-- "price not set" even though a price existed. Now every active branch is priced against every new reference price. A branch with no margin
-- yet starts at margin 0, as provisional, so approvers are told to confirm it. New branches get the same starting price when they are created.

-- Puts every active branch onto snapshot p_snap. A branch with a margin keeps it (and, when p_keep_status, its status); one without starts at 0, provisional.
create function gold.carry_branch_prices(p_snap uuid, p_actor uuid, p_keep_status boolean) returns void language plpgsql as $$
begin
  insert into gold.branch_prices (tenant_id, branch_id, snapshot_id, margin, status, set_by, approved_by, approved_at, effective_from, created_at)
  select b.tenant_id, b.id, p_snap, coalesce(l.margin, 0),
         case when l.id is not null and p_keep_status then l.status else 'provisional' end, p_actor,
         case when l.id is not null and p_keep_status then l.approved_by end,
         case when l.id is not null and p_keep_status then l.approved_at end,
         clock_timestamp(), clock_timestamp()
  from gold.branches b
  left join lateral (select * from gold.branch_prices where branch_id = b.id order by effective_from desc, created_at desc limit 1) l on true
  where b.is_active;
end $$;

create or replace function gold.set_base_price(p_base numeric, p_published timestamptz) returns jsonb language plpgsql as $$
declare v_user uuid := gold.require_actor(); v_snap uuid;
begin
  if p_base is null or p_base <= 0 then perform gold.fail(422, 'VALIDATION_FAILED', 'The price must be above zero.'); end if;
  insert into gold.price_snapshots (tenant_id, source, base_price, published_at, created_by)
  values (gold.current_tenant(), 'manual', p_base, least(coalesce(p_published, now()), now()), v_user) returning id into v_snap;
  perform gold.carry_branch_prices(v_snap, v_user, true);
  return jsonb_build_object('snapshotId', v_snap);
end $$;

create or replace function gold.feed_apply(p_base numeric, p_published timestamptz, p_raw jsonb, p_actor uuid) returns uuid language plpgsql as $$
declare v_tenant uuid := gold.current_tenant(); v_snap uuid; v_policy text;
begin
  select margin_policy into v_policy from gold.price_feed_settings where tenant_id = v_tenant;
  v_policy := coalesce(v_policy, 'approve');
  insert into gold.price_snapshots (tenant_id, source, base_price, published_at, raw, created_by)
  values (v_tenant, 'goldbod', p_base, least(p_published, now()), p_raw, p_actor) returning id into v_snap;
  perform gold.carry_branch_prices(v_snap, p_actor, v_policy = 'carry');
  return v_snap;
end $$;

-- A new branch starts on the latest reference price with margin 0 (provisional), if a price exists at all.
create or replace function gold.create_branch(p jsonb) returns jsonb language plpgsql as $$
declare
  v_id uuid := coalesce((p->>'id')::uuid, gen_random_uuid());
  v_code text := upper(trim(coalesce(p->>'code', '')));
  v_name text := trim(coalesce(p->>'name', ''));
  v_tz text := coalesce(nullif(trim(coalesce(p->>'timezone', '')), ''), 'Africa/Accra');
  v_snap uuid;
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
  select id into v_snap from gold.price_snapshots order by published_at desc, fetched_at desc limit 1;
  if v_snap is not null then
    insert into gold.branch_prices (tenant_id, branch_id, snapshot_id, margin, status, set_by, effective_from, created_at)
    values (gold.current_tenant(), v_id, v_snap, 0, 'provisional', gold.current_actor(), clock_timestamp(), clock_timestamp());
  end if;
  perform gold.audit('branch.created', 'branch', v_id::text, null, gold.branch_admin_json(v_id));
  return jsonb_build_object('replayed', false, 'data', gold.branch_admin_json(v_id));
end $$;