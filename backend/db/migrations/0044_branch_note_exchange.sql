-- 0044 Changing notes for the branch's own needs (smaller notes for change, bigger notes to hand out fewer).
--   * New permission notes:exchange, given to the manager and director roles that already exist (a company can give it to any role or person).
--   * The exchange can be made without a purchase (it always could); now every exchange also writes an audit entry, with who, what came in,
--     what went out and the value. Nothing else about it changes: both sides worth the same, different notes, a drawer movement.
--   * gold.exchanges_json lists a branch's recent exchanges for the screen.

insert into gold.role_permissions (tenant_id, role_id, permission)
select r.tenant_id, r.id, 'notes:exchange' from gold.roles r where r.key in ('manager', 'director') and r.is_system
on conflict do nothing;

create or replace function gold.record_exchange(p jsonb) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant();
  v_user uuid := gold.require_actor();
  v_id uuid := (p->>'id')::uuid;
  v_day uuid := (p->>'dayId')::uuid;
  v_branch uuid := (p->>'branchId')::uuid;
  v_tx uuid := nullif(p->>'transactionId', '')::uuid;
  v_note text := nullif(trim(coalesce(p->>'note', '')), '');
  v_at timestamptz := least((p->>'capturedAt')::timestamptz, now());
  v_gave jsonb := coalesce(p->'gave', '{}'::jsonb);
  v_took jsonb := coalesce(p->'took', '{}'::jsonb);
  d gold.business_days; t gold.transactions;
begin
  if exists (select 1 from gold.drawer_movements where id = v_id) then
    return jsonb_build_object('replayed', true, 'data', gold.movement_json(v_id));
  end if;
  select * into d from gold.business_days where id = v_day and branch_id = v_branch;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That day was not found.'); end if;
  if d.status <> 'open' then
    v_day := gold.open_day_id(v_branch);
    if v_day is null then perform gold.fail(409, 'DAY_CLOSED', 'This day is closed and no day is open. Open the day, then send it again.'); end if;
    v_note := 'Made before the day closed: ' || coalesce(v_note, 'notes changed');
  end if;
  if gold.lines_total(v_gave) = 0 or gold.lines_total(v_took) = 0 then
    perform gold.fail(422, 'VALIDATION_FAILED', 'Enter the notes the customer gives back and the notes you hand out.');
  end if;
  if gold.lines_total(v_gave) <> gold.lines_total(v_took) then
    perform gold.fail(422, 'EXCHANGE_MISMATCH', 'The notes given back (' || gold.ts(gold.lines_total(v_gave)) || ') and the notes handed out (' || gold.ts(gold.lines_total(v_took)) || ') must be worth the same.');
  end if;
  if exists (select 1 from jsonb_object_keys(v_gave) k where v_took ? k) then
    perform gold.fail(422, 'EXCHANGE_SAME_NOTE', 'Hand out different notes from the ones given back.');
  end if;
  if v_tx is not null then
    select * into t from gold.transactions where id = v_tx;
    if not found or t.branch_id <> v_branch then perform gold.fail(404, 'NOT_FOUND', 'That purchase was not found at this branch.'); end if;
    if t.status = 'void' then perform gold.fail(409, 'TRANSACTION_VOID', 'That purchase was cancelled.'); end if;
    v_note := coalesce(v_note, 'Notes changed for ' || t.reference);
  end if;
  v_note := coalesce(v_note, 'Notes changed');

  insert into gold.drawer_movements (id, tenant_id, branch_id, business_day_id, kind, note, occurred_at, created_by, transaction_id)
  values (v_id, v_tenant, v_branch, v_day, 'exchange', v_note, v_at, v_user, v_tx);
  perform gold.post_cash(v_branch, v_day, v_at, v_gave, 1, 'drawer_movement', v_id, v_note);
  perform gold.post_cash(v_branch, v_day, v_at, v_took, -1, 'drawer_movement', v_id, v_note);
  perform gold.audit('drawer.notes_exchanged', 'drawer_movement', v_id::text, null,
    jsonb_build_object('branchId', v_branch, 'dayId', v_day, 'transactionId', v_tx, 'received', v_gave, 'handedOut', v_took, 'value', gold.ts(gold.lines_total(v_gave)), 'note', v_note));
  return jsonb_build_object('replayed', false, 'data', gold.movement_json(v_id));
end $$;

create function gold.exchanges_json(p_branch uuid, p_limit int default 20) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(x.j order by x.at desc), '[]'::jsonb) from (
    select m.occurred_at as at, gold.movement_json(m.id) || jsonb_build_object('branchId', m.branch_id,
             'value', gold.ts(gold.lines_total(gold.lines_json('drawer_movement', m.id)) / 2)) as j
    from gold.drawer_movements m
    where m.branch_id = p_branch and m.kind = 'exchange' and m.transaction_id is null
    order by m.occurred_at desc limit greatest(1, least(coalesce(p_limit, 20), 100))
  ) x
$$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;