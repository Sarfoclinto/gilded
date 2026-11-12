-- 0053 (B51): opening and closing the day with no connection - the server half. See docs/OFFLINE-DAYS-DESIGN.md.
--   A branch cut off for days opens and closes on its own computers; those entries arrive later through the signed offline sync.
--   A count made by a person at the drawer is a fact, so for entries that arrive that way:
--     * the count is never refused because a reason is missing: the person could not see the server's books. It is recorded, the books are
--       corrected to it as always, and every figure that does not match becomes a difference for a manager (closing: sign-off pending);
--     * if the same date was already opened by someone online, the first to arrive is the day; the other opening is kept as a count against
--       it and everything made under its id joins that day;
--     * if the day was already closed, the offline closing is kept as a second count against the closed day; nothing is reopened;
--     * entries that were waiting for a day (another computer's cash movement, the next day's opening) are tried again by the server itself
--       when an opening or a closing goes in. A manager only sees what still cannot be applied.
--   Opening and closing ONLINE keep their strict rule: a count that differs needs a written reason, exactly as before.

alter table gold.business_days
  add column closed_offline boolean not null default false,
  add column found_at_sync  boolean not null default false,   -- a difference nobody could explain at the time: it was found when the count arrived
  add column opening_basis  jsonb,                             -- what the device's books said when the person counted (offline entries)
  add column closing_basis  jsonb;

-- A day id made offline that turned out to be the same day as one already open: everything sent under alias_id belongs to day_id.
create table gold.day_aliases (
  alias_id    uuid primary key,
  tenant_id   uuid not null,
  day_id      uuid not null,
  created_at  timestamptz not null default now(),
  foreign key (tenant_id, day_id) references gold.business_days (tenant_id, id)
);
-- A count that arrived for a day that was already opened / already closed by someone else. Kept exactly as it was made.
create table gold.day_counts (
  id          uuid primary key,                -- the command's id: sending it twice is one count
  tenant_id   uuid not null,
  branch_id   uuid not null,
  day_id      uuid not null,
  kind        text not null check (kind in ('second_open', 'second_close')),
  declared    jsonb not null,
  basis       jsonb,
  explanations jsonb,
  differs     boolean not null,
  counted_by  uuid,
  counted_at  timestamptz,
  received_at timestamptz not null default now(),
  foreign key (tenant_id, day_id) references gold.business_days (tenant_id, id)
);
create index day_counts_day on gold.day_counts (day_id);
do $$
declare t text;
begin
  foreach t in array array['day_aliases', 'day_counts'] loop
    execute format('alter table gold.%I enable row level security', t);
    execute format('alter table gold.%I force row level security', t);
    execute format('create policy tenant_isolation on gold.%I using (tenant_id = gold.current_tenant()) with check (tenant_id = gold.current_tenant())', t);
  end loop;
end $$;

-- True while an entry that came through the offline sync is being applied (set by gold.sync_run, for this transaction only).
create function gold.offline_entry() returns boolean language sql stable as $$
  select coalesce(current_setting('gold.offline_entry', true), '') = 'true'
$$;

create function gold.resolve_day(p_day uuid) returns uuid language sql stable as $$
  select coalesce((select day_id from gold.day_aliases where alias_id = p_day), p_day)
$$;

-- Runs one command. Marks it as an offline entry for the day functions, and follows a merged day id to the real day.
create or replace function gold.sync_run(p_type text, p_payload jsonb) returns jsonb language plpgsql as $$
declare
  v jsonb := p_payload; v_prev text := coalesce(current_setting('gold.offline_entry', true), ''); v_day uuid; r jsonb;
begin
  if v ? 'dayId' then
    begin v_day := (v->>'dayId')::uuid; exception when others then v_day := null; end;
    if v_day is not null and exists (select 1 from gold.day_aliases where alias_id = v_day) then
      v := jsonb_set(v, '{dayId}', to_jsonb(gold.resolve_day(v_day)::text));
    end if;
  end if;
  perform set_config('gold.offline_entry', 'true', true);
  begin
    r := case p_type
      when 'transaction.create' then gold.post_transaction(v)
      when 'transaction.pay'    then gold.pay_transaction(v)
      when 'drawer.movement'    then gold.record_movement(v)
      when 'drawer.exchange'    then gold.record_exchange(v)
      when 'day.open'           then gold.open_day(v)
      when 'day.close'          then gold.close_day(v)
      else null end;
  exception when others then
    perform set_config('gold.offline_entry', v_prev, true);
    raise;
  end;
  perform set_config('gold.offline_entry', v_prev, true);
  return r;
end $$;

-- Tries the waiting ("held") entries of a branch again, oldest first, each as the person who made it. Called when an opening or a closing
-- goes in, because that is what most held entries wait for. Several passes, since one entry going in can free the next.
create function gold.sync_retry_held(p_branch uuid) returns int language plpgsql as $$
declare
  v_me text := coalesce(current_setting('app.user_id', true), '');
  v_prev text := coalesce(current_setting('gold.offline_entry', true), '');
  c record; r gold.sync_commands; n int := 0; v_progress boolean; v_pass int := 0; v_code text; v_msg text; v_kind text;
begin
  if coalesce(current_setting('gold.in_retry', true), '') = 'true' then return 0; end if;   -- already running further up: its next pass picks things up
  if not exists (select 1 from gold.sync_commands where branch_id = p_branch and status = 'held') then return 0; end if;
  perform set_config('gold.in_retry', 'true', true);
  loop
    v_progress := false; v_pass := v_pass + 1;
    for c in select id from gold.sync_commands where branch_id = p_branch and status = 'held' order by captured_at nulls last, received_at, id loop
      select * into r from gold.sync_commands where id = c.id and status = 'held' for update;
      continue when not found;
      perform set_config('app.user_id', r.user_id::text, true);       -- the books show who really made it
      begin
        perform gold.sync_run(r.type, r.payload);
        update gold.sync_commands set status = 'applied', code = null, message = null, flags = array_append(r.flags, 'auto-retried'),
               resolved_at = now(), resolution = 'Applied by the server once what it was waiting for arrived' where id = r.id;
        v_progress := true; n := n + 1;
      exception when others then
        if sqlstate not like 'GV%' then raise; end if;
        v_code := split_part(sqlerrm, '|', 1);
        v_msg := substr(sqlerrm, char_length(v_code) + 2);
        v_kind := gold.sync_failure_kind(v_code);
        if v_kind = 'duplicate' then
          update gold.sync_commands set status = 'applied', code = null, message = null, flags = array_append(r.flags, 'duplicate'),
                 resolved_at = now(), resolution = 'Already recorded' where id = r.id;
          v_progress := true; n := n + 1;
        else
          update gold.sync_commands set status = v_kind, code = v_code, message = v_msg where id = r.id;
        end if;
      end;
    end loop;
    exit when not v_progress or v_pass >= 6;
  end loop;
  perform set_config('app.user_id', v_me, true);
  perform set_config('gold.offline_entry', v_prev, true);
  perform set_config('gold.in_retry', '', true);
  return n;
end $$;

-- An opening that arrived for a date someone else already opened. The day that is open stays the day; this count is kept against it.
create function gold.day_second_open(p_day uuid, p jsonb) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant(); v_user uuid := gold.require_actor();
  v_id uuid := (p->>'id')::uuid; d gold.business_days;
  v_lines jsonb := coalesce(p->'lines', '{}'::jsonb); v_open jsonb; v_a numeric; v_b numeric; v_differs boolean;
begin
  select * into d from gold.business_days where id = p_day;
  select coalesce(cash_lines, '{}'::jsonb) into v_open from gold.day_balances where business_day_id = p_day and kind = 'opening_declared';
  v_a := gold.lines_total(coalesce(v_open, '{}'::jsonb)); v_b := gold.lines_total(v_lines);
  v_differs := coalesce(p->>'source', 'counted') = 'counted' and v_a <> v_b;
  insert into gold.day_aliases (alias_id, tenant_id, day_id) values (v_id, v_tenant, p_day);
  insert into gold.day_counts (id, tenant_id, branch_id, day_id, kind, declared, basis, differs, counted_by, counted_at)
  values (v_id, v_tenant, d.branch_id, p_day, 'second_open', jsonb_build_object('cash', v_lines), p->'basis', v_differs, v_user,
          least((p->>'capturedAt')::timestamptz, now()));
  if v_differs then
    insert into gold.discrepancies (tenant_id, branch_id, business_day_id, kind, asset, expected, actual, difference, reported_explanation, opened_by)
    values (v_tenant, d.branch_id, p_day, 'other', 'cash', v_a, v_b, v_b - v_a,
            'A second opening count for this day, made with no connection, differs from the count the day was opened with.', v_user);
  end if;
  perform gold.notify(v_tenant, 'offline_day_merged', format('%s was opened twice for %s', (select name from gold.branches where id = d.branch_id), d.business_date),
    format('The day was opened online and also on a computer with no connection. The day that reached the server first is kept; the other count (GHS %s, against GHS %s) is recorded with it%s.',
           gold.ts(v_b), gold.ts(v_a), case when v_differs then ' and a difference was opened' else '' end),
    '/drawer/history', array[d.branch_id], 'discrepancies:review');
  perform gold.audit('day.merged', 'day', p_day::text, null, jsonb_build_object('aliasId', v_id, 'count', v_lines, 'differs', v_differs));
  perform gold.sync_retry_held(d.branch_id);     -- entries made under the other id can go in now
  return jsonb_build_object('replayed', false, 'merged', true, 'data', gold.day_json(p_day));
end $$;

-- A closing that arrived for a day that is already closed. Nothing is reopened; the count is kept and compared with the one the day closed on.
create function gold.day_second_close(p_day uuid, p jsonb) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant(); v_user uuid := gold.require_actor();
  v_id uuid := (p->>'id')::uuid; d gold.business_days; b gold.day_balances;
  v_lines jsonb := coalesce(p#>'{declared,cash}', '{}'::jsonb);
  v_assets text[] := array['cash','goods_top','goods_down','goods_value','debt','payable','custody_top'];
  v_a text; v_exp numeric; v_act numeric; v_diff text[] := '{}';
begin
  select * into d from gold.business_days where id = p_day;
  select * into b from gold.day_balances where business_day_id = p_day and kind = 'closing_declared';
  foreach v_a in array v_assets loop
    v_exp := case v_a when 'cash' then b.cash_value when 'goods_top' then b.goods_top when 'goods_down' then b.goods_down
             when 'goods_value' then b.goods_value when 'debt' then b.debt_value when 'payable' then b.payable_value else b.custody_top end;
    v_act := case v_a when 'cash' then gold.lines_total(v_lines) when 'goods_top' then gold.declared(p, 'goodsTop') when 'goods_down' then gold.declared(p, 'goodsDown')
             when 'goods_value' then gold.declared(p, 'goodsValue') when 'debt' then gold.declared(p, 'debt') when 'payable' then gold.declared(p, 'payable')
             else gold.declared(p, 'custodyTop') end;
    if v_act is distinct from v_exp then
      v_diff := v_diff || v_a;
      insert into gold.discrepancies (tenant_id, branch_id, business_day_id, kind, asset, expected, actual, difference, reported_explanation, opened_by)
      values (v_tenant, d.branch_id, p_day, 'other', v_a, coalesce(v_exp, 0), v_act, v_act - coalesce(v_exp, 0),
              coalesce(nullif(trim(coalesce(p->'explanations'->>v_a, '')), '') || ' ', '') ||
              '(A second closing count for this day, made with no connection, differs from the count the day was closed on.)', v_user);
    end if;
  end loop;
  insert into gold.day_counts (id, tenant_id, branch_id, day_id, kind, declared, basis, explanations, differs, counted_by, counted_at)
  values (v_id, v_tenant, d.branch_id, p_day, 'second_close', p->'declared', p->'basis', p->'explanations', cardinality(v_diff) > 0, v_user,
          least((p->>'capturedAt')::timestamptz, now()));
  perform gold.notify(v_tenant, 'offline_day_merged', format('%s was closed twice for %s', (select name from gold.branches where id = d.branch_id), d.business_date),
    case when cardinality(v_diff) > 0
      then format('A closing made with no connection arrived after the day was already closed. It differs on: %s. Both counts are kept and differences were opened.', array_to_string(v_diff, ', '))
      else 'A closing made with no connection arrived after the day was already closed. Both counts agree; the second is kept with the day.' end,
    '/drawer/history', array[d.branch_id], 'discrepancies:review');
  perform gold.audit('day.second_close', 'day', p_day::text, null, jsonb_build_object('commandId', v_id, 'differs', to_jsonb(v_diff)));
  perform gold.sync_retry_held(d.branch_id);
  return jsonb_build_object('replayed', false, 'lateCount', true, 'data', gold.day_json(p_day));
end $$;

create or replace function gold.open_day(p jsonb) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant();
  v_user uuid := gold.require_actor();
  v_id uuid := (p->>'id')::uuid;
  v_branch uuid := (p->>'branchId')::uuid;
  v_date date := (p->>'businessDate')::date;
  v_at timestamptz := least((p->>'capturedAt')::timestamptz, now());
  v_source text := coalesce(p->>'source', 'counted');
  v_lines jsonb := coalesce(p->'lines', '{}'::jsonb);
  v_expl text := nullif(trim(coalesce(p->>'explanation', '')), '');
  bal record; r record;
  v_seq bigint; v_history boolean; v_prev uuid; v_cont boolean := false;
  v_detail jsonb := '{}'::jsonb; v_pos jsonb := '{}'::jsonb; v_neg jsonb := '{}'::jsonb; v_declared numeric;
  v_loose boolean := gold.denominations_loose(v_branch);
  v_open gold.business_days; v_found boolean := false; v_rec uuid;
begin
  if exists (select 1 from gold.business_days where id = v_id) then
    return jsonb_build_object('replayed', true, 'data', gold.day_json(v_id));
  end if;
  -- this opening was already merged into another day (see day_second_open): sending it again changes nothing
  if exists (select 1 from gold.day_aliases where alias_id = v_id) then
    return jsonb_build_object('replayed', true, 'merged', true, 'data', gold.day_json(gold.resolve_day(v_id)));
  end if;
  perform 1 from gold.branches where id = v_branch and is_active for update;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'Branch was not found.'); end if;
  if v_source not in ('counted', 'carried') then perform gold.fail(422, 'VALIDATION_FAILED', 'source must be counted or carried.'); end if;
  select * into v_open from gold.business_days where branch_id = v_branch and status = 'open' limit 1;
  if found then
    -- Opened offline at the branch while someone else opened the same date online: the first to arrive is the day.
    -- This one is kept as a count against it, and everything made under its id joins that day.
    if gold.offline_entry() and v_open.business_date = v_date and coalesce(p->>'afterClose', 'false') <> 'true' then
      return gold.day_second_open(v_open.id, p);
    end if;
    perform gold.fail(409, 'DAY_ALREADY_OPEN', 'A day is already open for this branch.');
  end if;
  if exists (select 1 from gold.business_days where branch_id = v_branch and business_date = v_date) then
    -- A customer arrives after the day was closed: a second session on the same date is allowed, never a changed past.
    -- The first session's count stays exactly as it was signed; this one starts from the closing books, and says why.
    if exists (select 1 from gold.business_days where branch_id = v_branch and business_date = v_date and status <> 'closed') then
      perform gold.fail(409, 'DAY_ALREADY_OPEN', 'This branch already has a day for that date.');
    end if;
    if coalesce(p->>'afterClose', 'false') <> 'true' then
      perform gold.fail(409, 'DAY_ALREADY_CLOSED', 'Today was already closed. If a customer came in after closing, open it again and say why.');
    end if;
    if not gold.has_text(v_expl, 5) then
      perform gold.fail(422, 'VALIDATION_FAILED', 'Say why the day is opened again (at least 5 characters).');
    end if;
    v_source := 'carried';
    v_cont := true;
  end if;

  select * into bal from gold.branch_balance(v_branch);
  select max(seq) into v_seq from gold.ledger_entries where branch_id = v_branch;
  -- A branch that only has opening gold and debts is still at its first count: what matters is whether its drawer has a past.
  v_history := exists (select 1 from gold.business_days where branch_id = v_branch) or exists (select 1 from gold.ledger_entries where branch_id = v_branch and asset = 'cash');
  if v_source = 'carried' then
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_lines from jsonb_each(bal.cash_lines) where (value #>> '{}')::int > 0;
  end if;
  v_declared := gold.lines_total(v_lines);
  select id into v_prev from gold.business_days where branch_id = v_branch order by business_date desc, opened_at desc limit 1;

  insert into gold.business_days (id, tenant_id, branch_id, business_date, session_no, previous_day_id, opened_at, opened_by, opened_offline, opening_source)
  values (v_id, v_tenant, v_branch, v_date, (select coalesce(max(session_no), 0) + 1 from gold.business_days where branch_id = v_branch and business_date = v_date),
          v_prev, v_at, v_user, (now() - v_at) > interval '2 minutes' or gold.offline_entry(), v_source);
  if v_cont then
    update gold.business_days set continuation_reason = trim(v_expl) where id = v_id;
    perform gold.notify(v_tenant, 'after_close_session', 'The day was opened again after closing', trim(v_expl), '/drawer/history', array[v_branch], 'discrepancies:review');
  end if;

  insert into gold.day_balances (tenant_id, business_day_id, kind, cash_lines, cash_value, goods_top, goods_down, goods_value, debt_value,
                                 payable_value, custody_top, ledger_seq, captured_by)
  values (v_tenant, v_id, 'opening_expected', bal.cash_lines, bal.cash_value, bal.goods_top, bal.goods_down, bal.goods_value, bal.debt_value,
          bal.payable_value, bal.custody_top, v_seq, v_user);

  if not v_history then
    perform gold.post_cash(v_branch, v_id, v_at, v_lines, 1, 'go_live_balance', v_id, 'First count of the drawer');
  else
    for r in
      select coalesce(e.k, d.k) as denom, coalesce(d.n, 0) - coalesce(e.n, 0) as delta
      from (select key::int as k, value::int as n from jsonb_each_text(bal.cash_lines)) e
      full join (select key::int as k, value::int as n from jsonb_each_text(v_lines)) d on d.k = e.k
      where coalesce(d.n, 0) <> coalesce(e.n, 0)
    loop
      v_detail := v_detail || jsonb_build_object(r.denom::text, r.delta);
      if r.delta > 0 then v_pos := v_pos || jsonb_build_object(r.denom::text, r.delta);
      else v_neg := v_neg || jsonb_build_object(r.denom::text, -r.delta); end if;
    end loop;

    if v_detail <> '{}'::jsonb then
      if (not v_loose or v_declared <> bal.cash_value) and (v_expl is null or not gold.has_text(v_expl, 5)) then
        if gold.offline_entry() then
          -- Counted with no connection: the person could not see these books, so the count is recorded and a manager looks at it.
          v_expl := 'Found when the offline count reached the server.';
          v_found := true;
        else
          perform gold.fail(422, 'EXPLANATION_REQUIRED',
            'The count differs from what the books say the drawer holds. Write why (at least 5 characters).');
        end if;
      end if;
      perform gold.post_cash(v_branch, v_id, v_at, v_pos, 1, 'opening_adjustment', v_id, coalesce(v_expl, 'Notes recounted at opening; the total matched.'));
      perform gold.post_cash(v_branch, v_id, v_at, v_neg, -1, 'opening_adjustment', v_id, coalesce(v_expl, 'Notes recounted at opening; the total matched.'));
      insert into gold.day_reconciliations (tenant_id, business_day_id, phase, asset, expected, actual, detail, explanation, explained_by)
      values (v_tenant, v_id, 'opening', 'cash', bal.cash_value, v_declared, v_detail, v_expl, v_user)
      returning id into v_rec;
      if v_found then
        if v_declared <> bal.cash_value then
          insert into gold.discrepancies (tenant_id, branch_id, business_day_id, kind, asset, reconciliation_id, expected, actual, difference, reported_explanation, opened_by)
          values (v_tenant, v_branch, v_id, 'opening_variance', 'cash', v_rec, bal.cash_value, v_declared, v_declared - bal.cash_value, v_expl, v_user);
        end if;
        perform gold.notify(v_tenant, 'offline_count', format('An offline opening count at %s did not match the books', (select name from gold.branches where id = v_branch)),
          format('The day of %s was opened with no connection. The books said GHS %s, the count was GHS %s. The count is recorded; please look at it.', v_date, gold.ts(bal.cash_value), gold.ts(v_declared)),
          '/drawer/history', array[v_branch], 'discrepancies:review');
      end if;
    end if;
  end if;

  insert into gold.day_balances (tenant_id, business_day_id, kind, cash_lines, cash_value, goods_top, goods_down, goods_value, debt_value,
                                 payable_value, custody_top, captured_by)
  values (v_tenant, v_id, 'opening_declared', v_lines, v_declared, bal.goods_top, bal.goods_down, bal.goods_value, bal.debt_value,
          bal.payable_value, bal.custody_top, v_user);

  update gold.business_days set opening_basis = p->'basis', found_at_sync = v_found where id = v_id and (p ? 'basis' or v_found);
  -- entries from other computers that were waiting for this day can go in now
  perform gold.sync_retry_held(v_branch);
  return jsonb_build_object('replayed', false, 'found', v_found, 'data', gold.day_json(v_id));
end $$;

create or replace function gold.close_day(p jsonb) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant();
  v_user uuid := gold.require_actor();
  v_id uuid := (p->>'id')::uuid;
  v_day uuid := (p->>'dayId')::uuid;
  v_branch uuid := (p->>'branchId')::uuid;
  v_at timestamptz := least((p->>'capturedAt')::timestamptz, now());
  v_lines jsonb := coalesce(p#>'{declared,cash}', '{}'::jsonb);
  v_ver text := nullif(trim(coalesce(p#>>'{confirmation,version}', '')), '');
  v_txt text := nullif(trim(coalesce(p#>>'{confirmation,text}', '')), '');
  d gold.business_days; bal record; r record;
  v_seq bigint; v_declared numeric; v_detail jsonb := '{}'::jsonb; v_pos jsonb := '{}'::jsonb; v_neg jsonb := '{}'::jsonb;
  v_assets text[] := array['cash','goods_top','goods_down','goods_value','debt','payable','custody_top'];
  v_a text; v_exp numeric; v_act numeric; v_expl text; v_missing text[] := '{}'; v_needs boolean; v_any boolean := false;
  v_goods_memo text[] := '{}'; v_rec uuid;
  v_loose boolean := gold.denominations_loose(v_branch);
  d_top numeric; d_down numeric; d_gval numeric; d_debt numeric; d_pay numeric; d_cus numeric;
  v_found boolean := false;
begin
  v_day := gold.resolve_day(v_day);   -- a day opened offline may have been merged into the one that reached the server first
  if exists (select 1 from gold.business_days where closing_command_id = v_id) then
    return jsonb_build_object('replayed', true, 'data', gold.day_json(v_day));
  end if;
  if exists (select 1 from gold.day_counts where id = v_id) then
    return jsonb_build_object('replayed', true, 'lateCount', true, 'data', gold.day_json(v_day));
  end if;
  select * into d from gold.business_days where id = v_day and branch_id = v_branch for update;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That day was not found.'); end if;
  if d.status <> 'open' then
    -- Closed offline at the branch, but the day was already closed (online, or by another computer): nothing is reopened.
    -- The count is kept as a second count against the closed day.
    if gold.offline_entry() then return gold.day_second_close(v_day, p); end if;
    perform gold.fail(409, 'DAY_ALREADY_CLOSED', 'This day is already closed.');
  end if;
  if coalesce(p#>>'{confirmation,accepted}', 'false') <> 'true' or v_ver is null or v_txt is null then
    perform gold.fail(422, 'CONFIRMATION_REQUIRED', 'Tick the confirmation that you physically verified everything reported.');
  end if;
  perform 1 from gold.branches where id = v_branch for update;   -- one closing at a time per branch

  select * into bal from gold.branch_balance(v_branch);
  select max(seq) into v_seq from gold.ledger_entries where branch_id = v_branch;

  v_declared := gold.lines_total(v_lines);
  d_top := gold.declared(p, 'goodsTop'); d_down := gold.declared(p, 'goodsDown'); d_gval := gold.declared(p, 'goodsValue');
  d_debt := gold.declared(p, 'debt'); d_pay := gold.declared(p, 'payable'); d_cus := gold.declared(p, 'custodyTop');

  -- cash by note: what to add and what to take away so the ledger matches the count
  for r in
    select coalesce(e.k, c.k) as denom, coalesce(c.n, 0) - coalesce(e.n, 0) as delta
    from (select key::int as k, value::int as n from jsonb_each_text(bal.cash_lines)) e
    full join (select key::int as k, value::int as n from jsonb_each_text(v_lines)) c on c.k = e.k
    where coalesce(c.n, 0) <> coalesce(e.n, 0)
  loop
    v_detail := v_detail || jsonb_build_object(r.denom::text, r.delta);
    if r.delta > 0 then v_pos := v_pos || jsonb_build_object(r.denom::text, r.delta);
    else v_neg := v_neg || jsonb_build_object(r.denom::text, -r.delta); end if;
  end loop;

  -- every figure that differs needs its own written reason
  foreach v_a in array v_assets loop
    v_exp := case v_a when 'cash' then bal.cash_value when 'goods_top' then bal.goods_top when 'goods_down' then bal.goods_down
             when 'goods_value' then bal.goods_value when 'debt' then bal.debt_value when 'payable' then bal.payable_value else bal.custody_top end;
    v_act := case v_a when 'cash' then v_declared when 'goods_top' then d_top when 'goods_down' then d_down
             when 'goods_value' then d_gval when 'debt' then d_debt when 'payable' then d_pay else d_cus end;
    v_needs := case when v_a = 'cash' then (case when v_loose then v_declared <> bal.cash_value else v_detail <> '{}'::jsonb end) else v_act <> v_exp end;
    v_expl := nullif(trim(coalesce(p->'explanations'->>v_a, '')), '');
    if v_needs and (v_expl is null or not gold.has_text(v_expl, 5)) then v_missing := v_missing || v_a; end if;
  end loop;
  if cardinality(v_missing) > 0 then
    if gold.offline_entry() then
      -- Counted with no connection: the person could not see these books. The count is recorded as it is; each figure that does not
      -- match becomes a difference for a manager, and the closing waits for sign-off like any closing with differences.
      if jsonb_typeof(p->'explanations') is distinct from 'object' then p := jsonb_set(p, '{explanations}', '{}'::jsonb, true); end if;
      foreach v_a in array v_missing loop
        p := jsonb_set(p, array['explanations', v_a], to_jsonb('Found when the offline count reached the server.'::text), true);
      end loop;
      v_found := true;
    else
      perform gold.fail(422, 'EXPLANATION_REQUIRED', 'Write why (at least 5 characters) for: ' || array_to_string(v_missing, ', ') || '.');
    end if;
  end if;

  -- snapshots: what the books said, and what was reported
  insert into gold.day_balances (tenant_id, business_day_id, kind, cash_lines, cash_value, goods_top, goods_down, goods_value, debt_value,
                                 payable_value, custody_top, ledger_seq, captured_by)
  values (v_tenant, v_day, 'closing_expected', bal.cash_lines, bal.cash_value, bal.goods_top, bal.goods_down, bal.goods_value, bal.debt_value,
          bal.payable_value, bal.custody_top, v_seq, v_user);
  insert into gold.day_balances (tenant_id, business_day_id, kind, cash_lines, cash_value, goods_top, goods_down, goods_value, debt_value,
                                 payable_value, custody_top, captured_by)
  values (v_tenant, v_day, 'closing_declared', v_lines, v_declared, d_top, d_down, d_gval, d_debt, d_pay, d_cus, v_user);

  -- adjustments, so the ledger now agrees with what was reported
  if v_detail <> '{}'::jsonb then
    perform gold.post_cash(v_branch, v_day, v_at, v_pos, 1, 'closing_adjustment', v_day, coalesce(p->'explanations'->>'cash', 'Notes recounted at closing; the total matched.'));
    perform gold.post_cash(v_branch, v_day, v_at, v_neg, -1, 'closing_adjustment', v_day, coalesce(p->'explanations'->>'cash', 'Notes recounted at closing; the total matched.'));
  end if;
  if (d_top, d_down, d_gval) is distinct from (bal.goods_top, bal.goods_down, bal.goods_value) then
    foreach v_a in array array['goods_top','goods_down','goods_value'] loop
      if p->'explanations'->>v_a is not null then v_goods_memo := v_goods_memo || (v_a || ': ' || trim(p->'explanations'->>v_a)); end if;
    end loop;
    perform gold.post_goods(v_branch, v_day, v_at, d_top - bal.goods_top, d_down - bal.goods_down, d_gval - bal.goods_value,
                            'closing_adjustment', v_day, array_to_string(v_goods_memo, '; '));
  end if;
  if d_debt <> bal.debt_value then
    perform gold.post_value('debt', v_branch, v_day, v_at, d_debt - bal.debt_value, 'closing_adjustment', v_day, p->'explanations'->>'debt');
  end if;
  if d_pay <> bal.payable_value then
    perform gold.post_value('payable', v_branch, v_day, v_at, d_pay - bal.payable_value, 'closing_adjustment', v_day, p->'explanations'->>'payable');
  end if;
  if d_cus <> bal.custody_top then
    perform gold.post_custody(v_branch, v_day, v_at, d_cus - bal.custody_top, 'closing_adjustment', v_day, p->'explanations'->>'custody_top');
  end if;

  -- one reconciliation row per figure; a case for review for each real difference
  foreach v_a in array v_assets loop
    v_exp := case v_a when 'cash' then bal.cash_value when 'goods_top' then bal.goods_top when 'goods_down' then bal.goods_down
             when 'goods_value' then bal.goods_value when 'debt' then bal.debt_value when 'payable' then bal.payable_value else bal.custody_top end;
    v_act := case v_a when 'cash' then v_declared when 'goods_top' then d_top when 'goods_down' then d_down
             when 'goods_value' then d_gval when 'debt' then d_debt when 'payable' then d_pay else d_cus end;
    v_needs := case when v_a = 'cash' then (case when v_loose then v_declared <> bal.cash_value else v_detail <> '{}'::jsonb end) else v_act <> v_exp end;
    v_expl := case when v_needs then trim(p->'explanations'->>v_a) else null end;
    v_any := v_any or v_needs;
    insert into gold.day_reconciliations (tenant_id, business_day_id, phase, asset, expected, actual, detail, explanation, explained_by)
    values (v_tenant, v_day, 'closing', v_a, v_exp, v_act, case when v_a = 'cash' and (v_needs or v_detail <> '{}'::jsonb) then v_detail else null end, v_expl,
            case when v_needs then v_user end)
    returning id into v_rec;
    if v_act <> v_exp then
      insert into gold.discrepancies (tenant_id, branch_id, business_day_id, kind, asset, reconciliation_id, expected, actual, difference,
                                      reported_explanation, opened_by)
      values (v_tenant, v_branch, v_day, 'closing_variance', v_a, v_rec, v_exp, v_act, v_act - v_exp, v_expl, v_user);
    end if;
  end loop;

  update gold.business_days
     set status = 'closed', closed_at = greatest(v_at, opened_at), closed_by = v_user, closing_confirmed = true,
         closing_confirmation_version = v_ver, closing_confirmation_text = v_txt, closing_command_id = v_id,
         signoff_status = case when v_any then 'pending' else 'not_required' end,
         closed_offline = gold.offline_entry(), closing_basis = p->'basis', found_at_sync = found_at_sync or v_found
   where id = v_day;
  if v_found then
    perform gold.notify(v_tenant, 'offline_count', format('An offline closing count at %s did not match the books', (select name from gold.branches where id = v_branch)),
      format('The day of %s was closed with no connection. These figures differed from the books when it arrived: %s. The count is recorded; please review and sign off.',
             d.business_date, array_to_string(v_missing, ', ')),
      '/drawer/history', array[v_branch], 'discrepancies:review');
  end if;
  -- entries that were waiting (a later day's opening, for one) can go in now
  perform gold.sync_retry_held(v_branch);

  return jsonb_build_object('replayed', false, 'found', v_found, 'data', gold.day_json(v_day));
end $$;

create or replace function gold.day_json(p_day uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', d.id, 'branchId', d.branch_id, 'businessDate', d.business_date, 'status', d.status,
    'opening', jsonb_build_object(
        'lines', coalesce((select cash_lines from gold.day_balances where business_day_id = d.id and kind = 'opening_declared'), '{}'::jsonb),
        'source', d.opening_source),
    'openedAt', gold.iso(d.opened_at), 'openedBy', gold.person_json(d.opened_by),
    'closing', case when d.status <> 'closed' then null else jsonb_build_object(
        'closedAt', gold.iso(d.closed_at), 'closedBy', gold.person_json(d.closed_by),
        'confirmation', jsonb_build_object('version', d.closing_confirmation_version, 'text', d.closing_confirmation_text),
        'figures', coalesce((select jsonb_agg(jsonb_build_object(
              'asset', r.asset, 'expected', gold.ts(r.expected), 'actual', gold.ts(r.actual), 'difference', gold.ts(r.difference),
              'outcome', r.outcome, 'explanation', r.explanation, 'detail', r.detail)
              order by array_position(array['cash','goods_top','goods_down','goods_value','debt','payable','custody_top'], r.asset))
            from gold.day_reconciliations r where r.business_day_id = d.id and r.phase = 'closing'), '[]'::jsonb),
        'cash', jsonb_build_object(
            'expected', coalesce((select cash_lines from gold.day_balances where business_day_id = d.id and kind = 'closing_expected'), '{}'::jsonb),
            'counted',  coalesce((select cash_lines from gold.day_balances where business_day_id = d.id and kind = 'closing_declared'), '{}'::jsonb)),
        'signoff', jsonb_build_object('status', d.signoff_status, 'by', case when d.signoff_by is null then null else gold.person_json(d.signoff_by) end,
                                      'at', case when d.signoff_at is null then null else gold.iso(d.signoff_at) end, 'note', d.signoff_note)) end,
    'flags', to_jsonb(array_remove(array[
        case when d.opened_offline then 'OFFLINE_ENTRY' end,
        case when d.closed_offline then 'OFFLINE_CLOSE' end,
        case when d.found_at_sync then 'FOUND_AT_SYNC' end,
        case when exists (select 1 from gold.day_counts k where k.day_id = d.id) then 'SECOND_COUNT' end,
        case when exists (select 1 from gold.day_reconciliations r where r.business_day_id = d.id and r.phase = 'opening' and r.detail is not null)
             then 'OPENING_DIFFERS' end,
        case when d.signoff_status <> 'not_required' then 'CLOSING_DIFFERS' end], null)))
  from gold.business_days d where d.id = p_day
$$;

create or replace function gold.sync_apply(p jsonb) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant();
  v_user uuid := gold.require_actor();
  v_id uuid := (p->>'id')::uuid;
  v_type text := p->>'type';
  v_payload jsonb := p->'payload';
  v_at timestamptz := nullif(p->>'capturedAt', '')::timestamptz;
  v_branch uuid := nullif(v_payload->>'branchId', '')::uuid;
  v_plan jsonb := p->'planError';
  v_row gold.sync_commands;
  v_res jsonb; v_code text; v_msg text; v_status text := 'applied'; v_flags text[] := '{}'; v_late numeric;
begin
  select * into v_row from gold.sync_commands where id = v_id;
  if found then
    return jsonb_build_object('id', v_id, 'status', v_row.status, 'code', v_row.code, 'message', v_row.message, 'flags', to_jsonb(v_row.flags), 'replayed', true);
  end if;
  if v_type not in ('transaction.create', 'transaction.pay', 'drawer.movement', 'drawer.exchange', 'day.open', 'day.close') then
    perform gold.fail(422, 'VALIDATION_FAILED', 'Unknown command type.');
  end if;
  if v_payload is null or jsonb_typeof(v_payload) <> 'object' then perform gold.fail(422, 'VALIDATION_FAILED', 'The command has no content.'); end if;

  if v_plan is not null and jsonb_typeof(v_plan) = 'object' then
    -- the server already found it invalid; nothing is run
    v_code := coalesce(nullif(v_plan->>'code', ''), 'VALIDATION_FAILED');
    v_msg := coalesce(nullif(v_plan->>'message', ''), 'The entry is not valid.');
    v_status := gold.sync_failure_kind(v_code);
    if v_status = 'duplicate' then v_status := 'rejected'; end if;
  else
    begin
      v_res := gold.sync_run(v_type, v_payload);
    exception when others then
      if sqlstate not like 'GV%' then raise; end if;      -- a real fault (not a business rule) is an error for the caller, nothing is recorded
      v_code := split_part(sqlerrm, '|', 1);
      v_msg := substr(sqlerrm, char_length(v_code) + 2);
      v_status := gold.sync_failure_kind(v_code);
      if v_status = 'duplicate' then v_status := 'applied'; v_flags := array['duplicate']; v_code := null; v_msg := null; end if;
    end;
  end if;

  if v_status = 'applied' then
    if coalesce((v_res->>'replayed')::boolean, false) then v_flags := array_append(v_flags, 'already-recorded'); end if;
    if coalesce((v_res->>'found')::boolean, false) then v_flags := array_append(v_flags, 'found-at-sync'); end if;
    if coalesce((v_res->>'merged')::boolean, false) then v_flags := array_append(v_flags, 'merged-into-open-day'); end if;
    if coalesce((v_res->>'lateCount')::boolean, false) then v_flags := array_append(v_flags, 'second-count'); end if;
    if v_at is not null then
      v_late := extract(epoch from (now() - v_at));
      if v_late > 120 then v_flags := array_append(v_flags, 'offline'); end if;
      if v_late > 86400 then v_flags := array_append(v_flags, 'very-late'); end if;
    end if;
  end if;

  insert into gold.sync_commands (id, tenant_id, user_id, device_id, type, payload, branch_id, captured_at, status, code, message, flags)
  values (v_id, v_tenant, v_user, nullif(p->>'deviceId', ''), v_type, v_payload, v_branch, v_at, v_status, v_code, v_msg, v_flags);

  if v_status in ('held', 'rejected') then
    perform gold.notify(v_tenant, 'sync_review', 'An offline entry needs review', v_type || ': ' || coalesce(v_msg, 'could not be applied'), '/sync/review',
                        case when v_branch is null then null else array[v_branch] end, 'discrepancies:review');
  end if;
  return jsonb_build_object('id', v_id, 'status', v_status, 'code', v_code, 'message', v_msg, 'flags', to_jsonb(v_flags), 'replayed', false);
end $$;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant select, insert on gold.day_aliases, gold.day_counts to gold_app;
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;