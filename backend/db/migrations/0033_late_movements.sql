-- 0033 A cash movement saved before the day closed but sent after: it goes into the day that is open now instead of being refused and lost.

create or replace function gold.record_movement(p jsonb) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant();
  v_user uuid := gold.require_actor();
  v_id uuid := (p->>'id')::uuid;
  v_day uuid := (p->>'dayId')::uuid;
  v_branch uuid := (p->>'branchId')::uuid;
  v_kind text := p->>'kind';
  v_note text := trim(coalesce(p->>'note', ''));
  v_at timestamptz := least((p->>'capturedAt')::timestamptz, now());
  d gold.business_days;
begin
  if exists (select 1 from gold.drawer_movements where id = v_id) then
    return jsonb_build_object('replayed', true, 'data', gold.movement_json(v_id));
  end if;
  select * into d from gold.business_days where id = v_day and branch_id = v_branch;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That day was not found.'); end if;
  if d.status <> 'open' then
    -- Saved on a device while the day was open, reaching us after it closed. The cash really moved, so it is recorded in the day
    -- that is open now (never in the sealed one), and says so. With no day open it still has nowhere to go.
    v_day := gold.open_day_id(v_branch);
    if v_day is null then perform gold.fail(409, 'DAY_CLOSED', 'This day is closed and no day is open. Open the day, then send it again.'); end if;
    v_note := 'Made before the day closed: ' || v_note;
  end if;
  if v_kind not in ('topup', 'withdrawal') then perform gold.fail(422, 'VALIDATION_FAILED', 'kind must be topup or withdrawal.'); end if;
  if not gold.has_text(v_note, 1) then perform gold.fail(422, 'VALIDATION_FAILED', 'Write a note saying what the money is for.'); end if;
  if gold.lines_total(p->'lines') = 0 then perform gold.fail(422, 'VALIDATION_FAILED', 'Enter at least one note.'); end if;

  insert into gold.drawer_movements (id, tenant_id, branch_id, business_day_id, kind, note, occurred_at, created_by)
  values (v_id, v_tenant, v_branch, v_day, v_kind, v_note, v_at, v_user);
  perform gold.post_cash(v_branch, v_day, v_at, p->'lines', case when v_kind = 'topup' then 1 else -1 end, 'drawer_movement', v_id, v_note);
  return jsonb_build_object('replayed', false, 'data', gold.movement_json(v_id));
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;