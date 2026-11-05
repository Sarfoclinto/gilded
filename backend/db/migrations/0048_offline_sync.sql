-- 0048 Offline sync, server side.
--   device_keys    each device registers a public key for a signed-in person; commands made offline are signed with the private key
--                  (the API checks the signature, then runs the command as that person)
--   sync_commands  every queued command that reaches the server, once, with its result: applied / held / rejected / dismissed
--   sync_apply     runs one command (purchase, payout, drawer movement, note exchange, open day, close day) and records what happened.
--                  "Reality wins": a command is never silently lost. If it cannot be applied (the day closed meanwhile, something it
--                  depends on has not arrived yet, a rule it breaks) it is kept, with its full content, for a manager to review.
--   sync_review    the held and rejected commands; sync_resolve retries one (as the person who made it) or dismisses it with a reason.

create table gold.device_keys (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references gold.tenants (id),
  user_id    uuid not null,
  device_id  text not null check (char_length(device_id) between 8 and 80),
  public_key text not null check (char_length(public_key) between 80 and 400),   -- SPKI, base64
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (tenant_id, user_id, device_id),
  foreign key (tenant_id, user_id) references gold.users (tenant_id, id)
);

create table gold.sync_commands (
  id          uuid primary key,                       -- the command's own id (for a purchase, the purchase id): sending it twice is one command
  tenant_id   uuid not null references gold.tenants (id),
  user_id     uuid not null,
  device_id   text,
  type        text not null,
  payload     jsonb not null,
  branch_id   uuid,
  captured_at timestamptz,
  received_at timestamptz not null default now(),
  status      text not null check (status in ('applied', 'held', 'rejected', 'dismissed')),
  code        text,
  message     text,
  flags       text[] not null default '{}',
  resolved_by uuid,
  resolved_at timestamptz,
  resolution  text,
  foreign key (tenant_id, user_id) references gold.users (tenant_id, id)
);
create index sync_commands_review on gold.sync_commands (tenant_id, status, received_at);

do $$
declare t text;
begin
  foreach t in array array['device_keys', 'sync_commands'] loop
    execute format('alter table gold.%I enable row level security', t);
    execute format('alter table gold.%I force row level security', t);
    execute format('create policy tenant_isolation on gold.%I using (tenant_id = gold.current_tenant()) with check (tenant_id = gold.current_tenant())', t);
  end loop;
end $$;

-- A signed-in person registers this device's public key (replacing an older one for the same device).
create function gold.register_device_key(p jsonb) returns jsonb language plpgsql as $$
declare v_user uuid := gold.require_actor(); v_dev text := trim(coalesce(p->>'deviceId', '')); v_key text := trim(coalesce(p->>'publicKey', ''));
begin
  if char_length(v_dev) < 8 or char_length(v_dev) > 80 then perform gold.fail(422, 'VALIDATION_FAILED', 'deviceId must be 8 to 80 characters.'); end if;
  if char_length(v_key) < 80 or char_length(v_key) > 400 then perform gold.fail(422, 'VALIDATION_FAILED', 'publicKey is not valid.'); end if;
  insert into gold.device_keys (tenant_id, user_id, device_id, public_key) values (gold.current_tenant(), v_user, v_dev, v_key)
  on conflict (tenant_id, user_id, device_id) do update set public_key = excluded.public_key, revoked_at = null, created_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- The key the API checks a signature against. Null when the person never registered this device or it was revoked.
create function gold.device_key(p_user uuid, p_device text) returns text language sql stable as $$
  select public_key from gold.device_keys where user_id = p_user and device_id = p_device and revoked_at is null
$$;

-- Who made a command and what they may do now (permissions are checked by the API, at sync time, with these). Null = no such person.
create function gold.sync_author(p_user uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('active', u.is_active,
                            'permissions', coalesce((select jsonb_agg(x) from gold.effective_permissions(u.id) x), '[]'::jsonb))
  from gold.users u where u.id = p_user
$$;

-- Runs one command with whatever signed-in person is current. Errors raised by the business functions (gold.fail) pass through.
create function gold.sync_run(p_type text, p_payload jsonb) returns jsonb language plpgsql as $$
begin
  return case p_type
    when 'transaction.create' then gold.post_transaction(p_payload)
    when 'transaction.pay'    then gold.pay_transaction(p_payload)
    when 'drawer.movement'    then gold.record_movement(p_payload)
    when 'drawer.exchange'    then gold.record_exchange(p_payload)
    when 'day.open'           then gold.open_day(p_payload)
    when 'day.close'          then gold.close_day(p_payload)
    else null end;
end $$;

-- What kind of failure is it? "held": the state may be fixed and the command tried again. "rejected": the command itself is wrong.
-- "duplicate": it already happened, nothing to do.
create function gold.sync_failure_kind(p_code text) returns text language sql immutable as $$
  select case
    when p_code in ('NO_OPEN_DAY', 'DAY_CLOSED', 'DAY_ALREADY_CLOSED', 'DAY_ALREADY_OPEN', 'TRANSACTION_VOID', 'NOT_FOUND') then 'held'
    when p_code = 'ALREADY_PAID' then 'duplicate'
    else 'rejected' end
$$;

create function gold.sync_apply(p jsonb) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant();
  v_user uuid := gold.require_actor();
  v_id uuid := (p->>'id')::uuid;
  v_type text := p->>'type';
  v_payload jsonb := p->'payload';
  v_at timestamptz := nullif(p->>'capturedAt', '')::timestamptz;
  v_branch uuid := nullif(v_payload->>'branchId', '')::uuid;
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

  begin
    v_res := gold.sync_run(v_type, v_payload);
  exception when others then
    if sqlstate not like 'GV%' then raise; end if;      -- a real fault (not a business rule) is an error for the caller, nothing is recorded
    v_code := split_part(sqlerrm, '|', 1);
    v_msg := substr(sqlerrm, char_length(v_code) + 2);
    v_status := gold.sync_failure_kind(v_code);
    if v_status = 'duplicate' then v_status := 'applied'; v_flags := array['duplicate']; v_code := null; v_msg := null; end if;
  end;

  if v_status = 'applied' then
    if coalesce((v_res->>'replayed')::boolean, false) then v_flags := array_append(v_flags, 'already-recorded'); end if;
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

create function gold.sync_review_json() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'held', (select count(*) from gold.sync_commands where status = 'held'),
    'rejected', (select count(*) from gold.sync_commands where status = 'rejected'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'type', c.type, 'status', c.status, 'code', c.code, 'message', c.message, 'flags', to_jsonb(c.flags),
        'capturedAt', gold.iso(c.captured_at), 'receivedAt', gold.iso(c.received_at), 'deviceId', c.device_id,
        'branchId', c.branch_id, 'branchName', b.name,
        'by', jsonb_build_object('id', u.id, 'name', u.display_name),
        'payload', c.payload) order by c.received_at)
      from gold.sync_commands c
      join gold.users u on u.id = c.user_id
      left join gold.branches b on b.id = c.branch_id
      where c.status in ('held', 'rejected')), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'type', r.type, 'status', r.status, 'message', r.message, 'resolution', r.resolution,
                                          'resolvedAt', gold.iso(r.resolved_at), 'by', jsonb_build_object('id', u.id, 'name', u.display_name)) order by r.resolved_at desc)
      from (select * from gold.sync_commands where resolved_at is not null order by resolved_at desc limit 20) r
      join gold.users u on u.id = r.user_id), '[]'::jsonb))
$$;

-- p: { id, action: 'retry' | 'dismiss', note? }. Retry runs the saved command again as the person who made it; dismiss needs a reason.
create function gold.sync_resolve(p jsonb) returns jsonb language plpgsql as $$
declare
  v_me uuid := gold.require_actor();
  v_id uuid := (p->>'id')::uuid;
  v_act text := p->>'action';
  v_note text := nullif(trim(coalesce(p->>'note', '')), '');
  c gold.sync_commands; v_res jsonb; v_code text; v_msg text; v_kind text;
begin
  select * into c from gold.sync_commands where id = v_id for update;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That entry was not found.'); end if;
  if c.status not in ('held', 'rejected') then perform gold.fail(409, 'ALREADY_RESOLVED', 'That entry was already dealt with.'); end if;
  if v_act not in ('retry', 'dismiss') then perform gold.fail(422, 'VALIDATION_FAILED', 'action must be retry or dismiss.'); end if;

  if v_act = 'dismiss' then
    if not gold.has_text(v_note, 5) then perform gold.fail(422, 'VALIDATION_FAILED', 'Say why this entry is dismissed (at least 5 characters).'); end if;
    update gold.sync_commands set status = 'dismissed', resolved_by = v_me, resolved_at = now(), resolution = v_note where id = v_id;
    perform gold.audit('sync.dismissed', 'sync_command', v_id::text, jsonb_build_object('type', c.type, 'message', c.message), jsonb_build_object('note', v_note));
    return jsonb_build_object('id', v_id, 'status', 'dismissed');
  end if;

  perform set_config('app.user_id', c.user_id::text, true);       -- the books show who really made it
  begin
    v_res := gold.sync_run(c.type, c.payload);
    perform set_config('app.user_id', v_me::text, true);
    update gold.sync_commands set status = 'applied', code = null, message = null, flags = array_append(c.flags, 'reviewed'),
           resolved_by = v_me, resolved_at = now(), resolution = coalesce(v_note, 'Retried') where id = v_id;
    perform gold.audit('sync.retried', 'sync_command', v_id::text, jsonb_build_object('type', c.type), jsonb_build_object('status', 'applied'));
    return jsonb_build_object('id', v_id, 'status', 'applied');
  exception when others then
    perform set_config('app.user_id', v_me::text, true);
    if sqlstate not like 'GV%' then raise; end if;
    v_code := split_part(sqlerrm, '|', 1);
    v_msg := substr(sqlerrm, char_length(v_code) + 2);
    v_kind := gold.sync_failure_kind(v_code);
    if v_kind = 'duplicate' then
      update gold.sync_commands set status = 'applied', code = null, message = null, flags = array_append(c.flags, 'duplicate'), resolved_by = v_me, resolved_at = now(), resolution = 'Already recorded' where id = v_id;
      return jsonb_build_object('id', v_id, 'status', 'applied');
    end if;
    update gold.sync_commands set status = v_kind, code = v_code, message = v_msg where id = v_id;
    return jsonb_build_object('id', v_id, 'status', v_kind, 'code', v_code, 'message', v_msg);
  end;
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant select, insert, update on gold.device_keys, gold.sync_commands to gold_app;
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;