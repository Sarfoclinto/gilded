-- A queued purchase is checked and worked out by the server's own rules (the same ones the normal save uses) BEFORE the database function runs.
-- When that check fails, the server now says so here ("planError") and the entry is recorded as rejected for a manager to see, with the real reason,
-- instead of the raw entry reaching the database function in a shape it does not understand.
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