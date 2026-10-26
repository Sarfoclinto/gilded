-- 0015 Transfers: goods or cash moving between branches, with a permanent trail.
--
--   draft -> released (goods/cash leave the origin) -> received | received_with_discrepancy
--   draft -> cancelled (with a reason). A released transfer cannot be cancelled: it is received, and anything that did not arrive
--   becomes a discrepancy case. Goods received stay on the receiving branch's books as stock (a later sale or refining step uses them).
--
-- Every function takes the caller's branch scope (the branches they may act in) and refuses anything outside it.
-- Value of goods: an item's share of what its purchase was booked at, so the origin's ledger goes down by exactly what it went up by.
-- When the receiver reports a different weight, the booked value is scaled by the top weight (the receiver's report is the evidence;
-- a manager settles the difference from the discrepancy case).

-- ---------------------------------------------------------------- failed mobile money, shown beside the other between-branch figures
create or replace view gold.v_interbranch_position with (security_invoker = true) as
select tenant_id, sender_branch_id, receiver_branch_id,
       sum(cash) as cash_sent, sum(momo) as mobile_money_paid_on_behalf, sum(goods) as goods_value_sent,
       sum(momo_failed) as mobile_money_failed_covered_by_cash
from (
  select tenant_id, origin_branch_id as sender_branch_id, destination_branch_id as receiver_branch_id,
         coalesce(received_cash, 0) as cash, 0::numeric as momo, 0::numeric as goods, 0::numeric as momo_failed
  from gold.transfers where kind = 'cash' and status in ('received', 'received_with_discrepancy')
  union all
  select tenant_id, origin_branch_id, destination_branch_id, 0, 0, coalesce(received_value, 0), 0
  from gold.transfers where kind = 'goods' and status in ('received', 'received_with_discrepancy')
  union all
  select p.tenant_id, p.paid_by_branch_id, t.branch_id, 0, p.amount, 0, 0
  from gold.transaction_payments p join gold.transactions t on t.id = p.transaction_id
  where p.method = 'mobile_money' and p.status = 'confirmed' and p.paid_by_branch_id <> t.branch_id
  union all
  select r.tenant_id, r.paid_by_branch_id, d.branch_id, 0, r.amount, 0, 0
  from gold.debt_repayments r join gold.debts d on d.id = r.debt_id
  where r.method = 'mobile_money' and r.paid_by_branch_id <> d.branch_id
  union all
  -- The branch that was to send the money did not: the purchase branch paid another way. Kumasi still has what it was to hand over.
  select p.tenant_id, p.paid_by_branch_id, t.branch_id, 0, 0, 0, p.amount
  from gold.transaction_payments p join gold.transactions t on t.id = p.transaction_id
  where p.method = 'mobile_money' and p.status = 'failed' and p.paid_by_branch_id <> t.branch_id
) x
group by tenant_id, sender_branch_id, receiver_branch_id;

-- ---------------------------------------------------------------- helpers
create function gold.in_scope(p_branch uuid, p_scope uuid[]) returns void language plpgsql as $$
begin
  if p_branch is null or not (p_branch = any(coalesce(p_scope, '{}'))) then
    perform gold.fail(403, 'FORBIDDEN', 'You do not work at that branch.');
  end if;
end $$;

create function gold.transfer_event(p_transfer uuid, p_type text, p_data jsonb default '{}') returns void language sql as $$
  insert into gold.transfer_events (tenant_id, transfer_id, event_type, actor_user_id, occurred_at, data)
  values (gold.current_tenant(), p_transfer, p_type, gold.current_actor(), now(), coalesce(p_data, '{}'))
$$;

-- What an item is worth when it leaves: its share of the purchase's booked value.
create function gold.item_booked_value(p_item uuid) returns numeric language sql stable as $$
  select round(i.amount * coalesce(t.payable / nullif((select sum(amount) from gold.transaction_items where transaction_id = t.id), 0), 1), 2)
  from gold.transaction_items i join gold.transactions t on t.id = i.transaction_id where i.id = p_item
$$;

create function gold.transfer_json(p_id uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', t.id, 'reference', t.reference, 'kind', t.kind, 'status', t.status,
    'originBranchId', t.origin_branch_id, 'originBranchName', ob.name,
    'destinationBranchId', t.destination_branch_id, 'destinationBranchName', db.name,
    'purpose', t.purpose, 'purposeNote', t.purpose_note, 'method', t.method,
    'collector', case when t.collector_type is null then null else jsonb_build_object(
        'type', t.collector_type, 'userId', t.collector_user_id,
        'name', coalesce(t.collector_name, (select display_name from gold.users where id = t.collector_user_id)),
        'phone', t.collector_phone, 'idType', t.collector_id_type, 'idNumber', t.collector_id_number,
        'relationship', t.collector_relationship, 'collectedAt', gold.iso(t.collected_at)) end,
    'expectedArrivalAt', gold.iso(t.expected_arrival_at),
    'release', case when t.released_at is null then null else jsonb_build_object(
        'by', gold.person_json(t.released_by), 'at', gold.iso(t.released_at), 'note', t.release_note) end,
    'declared', case when t.released_at is null then null else jsonb_build_object(
        'top', gold.ts(t.declared_top), 'down', gold.ts(t.declared_down), 'value', gold.ts(t.declared_value),
        'cash', gold.ts(t.declared_cash), 'cashLines', gold.lines_json('transfer_release', t.id)) end,
    'receipt', case when t.received_at is null then null else jsonb_build_object(
        'by', gold.person_json(t.received_by), 'at', gold.iso(t.received_at), 'note', t.receipt_note,
        'top', gold.ts(t.received_top), 'down', gold.ts(t.received_down), 'value', gold.ts(t.received_value),
        'cash', gold.ts(t.received_cash), 'cashLines', gold.lines_json('transfer_receipt', t.id)) end,
    'cancellation', case when t.cancelled_at is null then null else jsonb_build_object(
        'by', gold.person_json(t.cancelled_by), 'at', gold.iso(t.cancelled_at), 'reason', t.cancel_reason) end,
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'lineNo', l.line_no, 'itemId', l.transaction_item_id,
        'description', coalesce(l.description, nullif(i.label, ''), 'Item ' || i.line_no),
        'reference', tx.reference, 'customerName', tx.customer_name,
        'releasedTop', gold.ts(l.released_top), 'releasedDown', gold.ts(l.released_down), 'releasedValue', gold.ts(l.released_value),
        'receivedTop', gold.ts(l.received_top), 'receivedDown', gold.ts(l.received_down), 'receivedValue', gold.ts(l.received_value),
        'outcome', l.outcome) order by l.line_no)
      from gold.transfer_goods_lines l
      left join gold.transaction_items i on i.id = l.transaction_item_id
      left join gold.transactions tx on tx.id = i.transaction_id
      where l.transfer_id = t.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'direction', p.direction, 'amount', gold.ts(p.amount), 'method', p.method, 'purpose', p.purpose,
        'externalRef', p.external_ref, 'paidAt', gold.iso(p.paid_at), 'recordedBy', gold.person_json(p.recorded_by), 'note', p.note,
        'lines', gold.lines_json('transfer_payment', p.id)) order by p.paid_at, p.created_at)
      from gold.transfer_payments p where p.transfer_id = t.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'type', e.event_type, 'by', gold.person_json(e.actor_user_id), 'at', gold.iso(e.occurred_at), 'data', e.data) order by e.id)
      from gold.transfer_events e where e.transfer_id = t.id), '[]'::jsonb),
    'discrepancies', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'status', d.status, 'asset', d.asset, 'lineId', d.transfer_line_id,
        'expected', gold.ts(d.expected), 'actual', gold.ts(d.actual), 'difference', gold.ts(d.difference), 'explanation', d.reported_explanation)
        order by d.opened_at) from gold.discrepancies d where d.transfer_id = t.id), '[]'::jsonb),
    'createdBy', gold.person_json(t.created_by), 'createdAt', gold.iso(t.created_at))
  from gold.transfers t
  join gold.branches ob on ob.id = t.origin_branch_id
  join gold.branches db on db.id = t.destination_branch_id
  where t.id = p_id
$$;

-- Rows for the lists (no timeline). direction: outgoing = this branch sends, incoming = this branch receives, all.
create function gold.transfers_json(p_branch uuid, p_status text, p_direction text, p_limit int default 100) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(row order by created desc), '[]'::jsonb) from (
    select t.created_at as created, jsonb_build_object(
      'id', t.id, 'reference', t.reference, 'kind', t.kind, 'status', t.status,
      'originBranchId', t.origin_branch_id, 'originBranchName', ob.name,
      'destinationBranchId', t.destination_branch_id, 'destinationBranchName', db.name,
      'purpose', t.purpose, 'method', t.method,
      'collectorName', coalesce(t.collector_name, (select display_name from gold.users where id = t.collector_user_id)),
      'lineCount', (select count(*) from gold.transfer_goods_lines l where l.transfer_id = t.id),
      'declaredValue', gold.ts(case when t.kind = 'cash' then t.declared_cash else t.declared_value end),
      'receivedValue', gold.ts(case when t.kind = 'cash' then t.received_cash else t.received_value end),
      'hasDiscrepancy', t.status = 'received_with_discrepancy',
      'releasedAt', gold.iso(t.released_at), 'receivedAt', gold.iso(t.received_at), 'createdAt', gold.iso(t.created_at)) as row
    from gold.transfers t
    join gold.branches ob on ob.id = t.origin_branch_id
    join gold.branches db on db.id = t.destination_branch_id
    where (p_status is null or t.status = p_status)
      and case coalesce(p_direction, 'all')
            when 'outgoing' then t.origin_branch_id = p_branch
            when 'incoming' then t.destination_branch_id = p_branch
            else t.origin_branch_id = p_branch or t.destination_branch_id = p_branch end
    order by t.created_at desc limit p_limit
  ) x
$$;

-- Gold a branch holds that can still be put on a transfer: on hand there and not already on an open transfer.
create function gold.transferable_items_json(p_branch uuid) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'itemId', i.id, 'transactionId', t.id, 'reference', t.reference, 'customerName', t.customer_name,
      'label', coalesce(nullif(i.label, ''), 'Item ' || i.line_no), 'top', gold.ts(i.top), 'down', gold.ts(i.down),
      'value', gold.ts(gold.item_booked_value(i.id)), 'purchasedAt', gold.iso(t.captured_at))
    order by t.captured_at desc, i.line_no), '[]'::jsonb)
  from gold.transaction_items i join gold.transactions t on t.id = i.transaction_id
  where i.location_branch_id = p_branch and i.location_state = 'on_hand'
    and not exists (select 1 from gold.transfer_goods_lines l join gold.transfers x on x.id = l.transfer_id
                    where l.transaction_item_id = i.id and x.status in ('draft', 'released'))
$$;

-- Active staff, so a sender can pick who carries a transfer without being allowed to manage users.
create function gold.staff_json() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'displayName', display_name) order by display_name), '[]'::jsonb)
  from gold.users where is_active
$$;

-- ---------------------------------------------------------------- draft
create function gold.transfer_add_item(p_transfer uuid, p_item uuid) returns void language plpgsql as $$
declare t gold.transfers; i gold.transaction_items; n smallint;
begin
  select * into i from gold.transaction_items where id = p_item;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That piece of gold was not found.'); end if;
  select * into t from gold.transfers where id = p_transfer;
  if i.location_branch_id <> t.origin_branch_id or i.location_state <> 'on_hand' then
    perform gold.fail(409, 'ITEM_NOT_AVAILABLE', 'That gold is not on hand at the sending branch.');
  end if;
  if exists (select 1 from gold.transfer_goods_lines l join gold.transfers x on x.id = l.transfer_id
             where l.transaction_item_id = p_item and x.status in ('draft', 'released')) then
    perform gold.fail(409, 'ITEM_ALREADY_ON_TRANSFER', 'That gold is already on another transfer.');
  end if;
  select coalesce(max(line_no), 0) + 1 into n from gold.transfer_goods_lines where transfer_id = p_transfer;
  insert into gold.transfer_goods_lines (tenant_id, transfer_id, line_no, transaction_item_id, released_top, released_down, released_value)
  values (t.tenant_id, p_transfer, n, p_item, i.top, i.down, gold.item_booked_value(p_item));
  perform gold.transfer_event(p_transfer, 'goods_added', jsonb_build_object('itemId', p_item, 'top', gold.ts(i.top), 'down', gold.ts(i.down)));
end $$;

create function gold.transfer_set_collector_row(p_transfer uuid, c jsonb) returns void language plpgsql as $$
declare v_type text := c->>'type'; v_user uuid := nullif(c->>'userId', '')::uuid; v_name text := nullif(trim(coalesce(c->>'name', '')), '');
        old gold.transfers;
begin
  if v_type not in ('staff', 'external') then perform gold.fail(422, 'VALIDATION_FAILED', 'Say whether the collector is staff or someone outside.'); end if;
  if v_type = 'staff' then
    perform 1 from gold.users where id = v_user and is_active;
    if not found then perform gold.fail(422, 'VALIDATION_FAILED', 'Pick the staff member who will carry it.'); end if;
    v_name := null;
  else
    v_user := null;
    if not gold.has_text(v_name, 1) then perform gold.fail(422, 'VALIDATION_FAILED', 'Write the collector''s name.'); end if;
  end if;
  select * into old from gold.transfers where id = p_transfer;
  update gold.transfers set collector_type = v_type, collector_user_id = v_user, collector_name = v_name,
    collector_phone = nullif(trim(coalesce(c->>'phone', '')), ''), collector_id_type = nullif(trim(coalesce(c->>'idType', '')), ''),
    collector_id_number = nullif(trim(coalesce(c->>'idNumber', '')), ''), collector_relationship = nullif(trim(coalesce(c->>'relationship', '')), '')
  where id = p_transfer;
  perform gold.transfer_event(p_transfer, 'collector_set', jsonb_build_object(
    'type', v_type, 'userId', v_user, 'name', v_name, 'phone', c->>'phone', 'idType', c->>'idType', 'idNumber', c->>'idNumber',
    'previous', case when old.collector_type is null then null else jsonb_build_object('type', old.collector_type, 'userId', old.collector_user_id, 'name', old.collector_name) end));
end $$;

create function gold.create_transfer(p jsonb, p_scope uuid[]) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant(); v_user uuid := gold.require_actor(); v_id uuid := (p->>'id')::uuid;
  v_origin uuid := (p->>'originBranchId')::uuid; v_dest uuid := (p->>'destinationBranchId')::uuid;
  v_kind text := coalesce(p->>'kind', 'goods'); b gold.branches; v_local date; v_n int; v_ref text; x jsonb; v_item text;
begin
  if exists (select 1 from gold.transfers where id = v_id) then return jsonb_build_object('replayed', true, 'data', gold.transfer_json(v_id)); end if;
  perform gold.in_scope(v_origin, p_scope);
  if v_kind not in ('goods', 'cash') then perform gold.fail(422, 'VALIDATION_FAILED', 'kind must be goods or cash.'); end if;
  if v_origin = v_dest then perform gold.fail(422, 'VALIDATION_FAILED', 'The sending and receiving branch must be different.'); end if;
  perform 1 from gold.branches where id = v_dest and is_active;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'The receiving branch was not found.'); end if;
  select * into b from gold.branches where id = v_origin and is_active;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'The sending branch was not found.'); end if;

  v_local := (now() at time zone b.timezone)::date;
  v_n := gold.next_document_number(v_tenant, 'transfer', v_origin, v_local);
  v_ref := 'TRF-' || b.code || '-' || to_char(v_local, 'YYYYMMDD') || '-' || lpad(v_n::text, 4, '0');
  insert into gold.transfers (id, tenant_id, reference, kind, origin_branch_id, destination_branch_id, purpose, purpose_note, method,
                              expected_arrival_at, created_by)
  values (v_id, v_tenant, v_ref, v_kind, v_origin, v_dest, coalesce(p->>'purpose', 'other'), nullif(trim(coalesce(p->>'purposeNote', '')), ''),
          coalesce(p->>'method', 'other'), nullif(p->>'expectedArrivalAt', '')::timestamptz, v_user);
  perform gold.transfer_event(v_id, 'created', jsonb_build_object('kind', v_kind, 'from', v_origin, 'to', v_dest, 'purpose', p->>'purpose'));
  if v_kind = 'goods' then
    for v_item in select jsonb_array_elements_text(coalesce(p->'itemIds', '[]'::jsonb)) loop perform gold.transfer_add_item(v_id, v_item::uuid); end loop;
  end if;
  if p->'collector' is not null and jsonb_typeof(p->'collector') = 'object' then perform gold.transfer_set_collector_row(v_id, p->'collector'); end if;
  return jsonb_build_object('replayed', false, 'data', gold.transfer_json(v_id));
end $$;

-- Loads a transfer for an action at one end of it, checking the caller works there.
create function gold.transfer_for(p_id uuid, p_end text, p_scope uuid[]) returns gold.transfers language plpgsql as $$
declare t gold.transfers;
begin
  select * into t from gold.transfers where id = p_id for update;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That transfer was not found.'); end if;
  if p_end = 'origin' then perform gold.in_scope(t.origin_branch_id, p_scope);
  elsif p_end = 'destination' then perform gold.in_scope(t.destination_branch_id, p_scope);
  elsif not (t.origin_branch_id = any(coalesce(p_scope, '{}')) or t.destination_branch_id = any(coalesce(p_scope, '{}'))) then
    perform gold.fail(404, 'NOT_FOUND', 'That transfer was not found.');
  end if;
  return t;
end $$;

create function gold.transfer_edit(p_id uuid, p jsonb, p_scope uuid[]) returns jsonb language plpgsql as $$
declare t gold.transfers; v_item text; v_line gold.transfer_goods_lines;
begin
  t := gold.transfer_for(p_id, 'origin', p_scope);
  if t.status not in ('draft') and not (t.status = 'released' and p ? 'collector' and not (p ? 'addItemIds' or p ? 'removeLineIds')) then
    perform gold.fail(409, 'TRANSFER_LOCKED', 'Only a draft can have its goods changed; a released transfer can only change its collector.');
  end if;
  if p ? 'addItemIds' then
    if t.kind <> 'goods' then perform gold.fail(422, 'VALIDATION_FAILED', 'Cash transfers have no goods.'); end if;
    for v_item in select jsonb_array_elements_text(p->'addItemIds') loop perform gold.transfer_add_item(p_id, v_item::uuid); end loop;
  end if;
  if p ? 'removeLineIds' then
    for v_item in select jsonb_array_elements_text(p->'removeLineIds') loop
      select * into v_line from gold.transfer_goods_lines where id = v_item::uuid and transfer_id = p_id;
      if found then
        delete from gold.transfer_goods_lines where id = v_line.id;
        perform gold.transfer_event(p_id, 'goods_removed', jsonb_build_object('itemId', v_line.transaction_item_id, 'lineNo', v_line.line_no));
      end if;
    end loop;
  end if;
  if p ? 'collector' then perform gold.transfer_set_collector_row(p_id, p->'collector'); end if;
  update gold.transfers set purpose = coalesce(p->>'purpose', purpose), purpose_note = coalesce(nullif(trim(coalesce(p->>'purposeNote', '')), ''), purpose_note),
    method = coalesce(p->>'method', method), expected_arrival_at = coalesce(nullif(p->>'expectedArrivalAt', '')::timestamptz, expected_arrival_at)
  where id = p_id and status = 'draft';
  return gold.transfer_json(p_id);
end $$;

create function gold.cancel_transfer(p_id uuid, p_reason text, p_scope uuid[]) returns jsonb language plpgsql as $$
declare t gold.transfers;
begin
  t := gold.transfer_for(p_id, 'origin', p_scope);
  if t.status <> 'draft' then perform gold.fail(409, 'TRANSFER_LOCKED', 'Only a draft can be cancelled. Once it is released it must be received.'); end if;
  if not gold.has_text(p_reason, 5) then perform gold.fail(422, 'VALIDATION_FAILED', 'Write the reason (at least a few words).'); end if;
  update gold.transfers set status = 'cancelled', cancelled_at = now(), cancelled_by = gold.require_actor(), cancel_reason = trim(p_reason) where id = p_id;
  perform gold.transfer_event(p_id, 'cancelled', jsonb_build_object('reason', trim(p_reason)));
  return gold.transfer_json(p_id);
end $$;

create function gold.transfer_note(p_id uuid, p_text text, p_scope uuid[]) returns jsonb language plpgsql as $$
begin
  perform gold.transfer_for(p_id, 'either', p_scope);
  if not gold.has_text(p_text, 1) then perform gold.fail(422, 'VALIDATION_FAILED', 'Write the note.'); end if;
  perform gold.transfer_event(p_id, 'note_added', jsonb_build_object('text', trim(p_text)));
  return gold.transfer_json(p_id);
end $$;

-- ---------------------------------------------------------------- release
create function gold.release_transfer(p_id uuid, p jsonb, p_scope uuid[]) returns jsonb language plpgsql as $$
declare
  t gold.transfers; v_user uuid := gold.require_actor(); v_day uuid; v_at timestamptz := now(); v_top numeric; v_down numeric; v_value numeric; v_cash numeric;
begin
  t := gold.transfer_for(p_id, 'origin', p_scope);
  if t.status <> 'draft' then perform gold.fail(409, 'ALREADY_RELEASED', 'This transfer is not a draft any more.'); end if;
  if t.collector_type is null then perform gold.fail(422, 'COLLECTOR_REQUIRED', 'Say who is carrying it before it is released.'); end if;
  v_day := gold.open_day_id(t.origin_branch_id);
  if v_day is null then perform gold.fail(409, 'DAY_NOT_OPEN', 'Open the day at the sending branch first.'); end if;

  if t.kind = 'goods' then
    select sum(released_top), sum(released_down), sum(released_value) into v_top, v_down, v_value from gold.transfer_goods_lines where transfer_id = p_id;
    if v_top is null then perform gold.fail(422, 'NO_GOODS', 'Add at least one piece of gold.'); end if;
    update gold.transaction_items set location_state = 'in_transit'
      where id in (select transaction_item_id from gold.transfer_goods_lines where transfer_id = p_id and transaction_item_id is not null);
    perform gold.post_goods(t.origin_branch_id, v_day, v_at, -v_top, -v_down, -v_value, 'transfer_release', p_id, 'Sent on ' || t.reference);
    update gold.transfers set status = 'released', released_by = v_user, released_at = v_at, release_note = nullif(trim(coalesce(p->>'note', '')), ''),
      collected_at = coalesce(nullif(p->>'collectedAt', '')::timestamptz, v_at), declared_top = v_top, declared_down = v_down, declared_value = v_value
    where id = p_id;
  else
    v_cash := gold.lines_total(p->'lines');
    if v_cash <= 0 then perform gold.fail(422, 'VALIDATION_FAILED', 'Enter the notes being sent.'); end if;
    perform gold.post_cash(t.origin_branch_id, v_day, v_at, p->'lines', -1, 'transfer_release', p_id, 'Cash sent on ' || t.reference);
    update gold.transfers set status = 'released', released_by = v_user, released_at = v_at, release_note = nullif(trim(coalesce(p->>'note', '')), ''),
      collected_at = coalesce(nullif(p->>'collectedAt', '')::timestamptz, v_at), declared_cash = v_cash
    where id = p_id;
  end if;
  perform gold.transfer_event(p_id, 'released', jsonb_build_object('kind', t.kind, 'note', p->>'note'));
  return gold.transfer_json(p_id);
end $$;

-- ---------------------------------------------------------------- money that changed hands because of the transfer
create function gold.record_transfer_payment(p_id uuid, p jsonb, p_scope uuid[]) returns jsonb language plpgsql as $$
declare
  t gold.transfers; v_user uuid := gold.require_actor(); v_branch uuid := (p->>'branchId')::uuid; v_dir text := p->>'direction';
  v_method text := coalesce(p->>'method', 'cash'); v_amount numeric := (p->>'amount')::numeric; v_pay uuid := coalesce((p->>'id')::uuid, gen_random_uuid());
  v_day uuid;
begin
  t := gold.transfer_for(p_id, 'either', p_scope);
  if exists (select 1 from gold.transfer_payments where id = v_pay) then return gold.transfer_json(p_id); end if;
  if t.status not in ('released', 'received', 'received_with_discrepancy') then
    perform gold.fail(409, 'TRANSFER_NOT_RELEASED', 'Payments are recorded after the transfer is released.');
  end if;
  if v_branch is distinct from t.origin_branch_id and v_branch is distinct from t.destination_branch_id then
    perform gold.fail(422, 'VALIDATION_FAILED', 'Say which end of the transfer made the payment.');
  end if;
  perform gold.in_scope(v_branch, p_scope);
  if v_dir not in ('paid_to_collector', 'received_from_collector') then perform gold.fail(422, 'VALIDATION_FAILED', 'direction must be paid_to_collector or received_from_collector.'); end if;
  if v_method not in ('cash', 'mobile_money', 'bank', 'other') then perform gold.fail(422, 'VALIDATION_FAILED', 'Unknown payment method.'); end if;
  if v_amount is null or v_amount <= 0 then perform gold.fail(422, 'VALIDATION_FAILED', 'The amount must be above zero.'); end if;
  if not gold.has_text(p->>'purpose', 1) then perform gold.fail(422, 'VALIDATION_FAILED', 'Write what the money is for.'); end if;

  insert into gold.transfer_payments (id, tenant_id, transfer_id, direction, amount, method, purpose, external_ref, paid_at, recorded_by, note)
  values (v_pay, gold.current_tenant(), p_id, v_dir, v_amount, v_method, trim(p->>'purpose'), nullif(trim(coalesce(p->>'externalRef', '')), ''), now(), v_user,
          nullif(trim(coalesce(p->>'note', '')), ''));
  if v_method = 'cash' then
    if gold.lines_total(p->'lines') <> v_amount then perform gold.fail(422, 'PAYOUT_MISMATCH', 'The notes do not add up to the amount.'); end if;
    v_day := gold.open_day_id(v_branch);
    if v_day is null then perform gold.fail(409, 'DAY_NOT_OPEN', 'Open the day at that branch first.'); end if;
    perform gold.post_cash(v_branch, v_day, now(), p->'lines', case when v_dir = 'paid_to_collector' then -1 else 1 end, 'transfer_payment', v_pay,
                           trim(p->>'purpose') || ' (' || t.reference || ')');
  end if;
  perform gold.transfer_event(p_id, 'payment_recorded', jsonb_build_object('direction', v_dir, 'amount', gold.ts(v_amount), 'method', v_method, 'branchId', v_branch));
  return gold.transfer_json(p_id);
end $$;

-- ---------------------------------------------------------------- receipt
create function gold.receive_transfer(p_id uuid, p jsonb, p_scope uuid[]) returns jsonb language plpgsql as $$
declare
  t gold.transfers; v_user uuid := gold.require_actor(); v_day uuid; v_at timestamptz := now(); r record; l gold.transfer_goods_lines;
  v_out text; v_top numeric; v_down numeric; v_val numeric; v_rt numeric := 0; v_rd numeric := 0; v_rv numeric := 0; v_bad boolean := false;
  v_note text; v_asset text; v_exp numeric; v_act numeric; v_cash numeric; v_seen uuid[] := '{}'; v_case uuid;
begin
  t := gold.transfer_for(p_id, 'destination', p_scope);
  if t.status <> 'released' then perform gold.fail(409, 'NOT_IN_TRANSIT', 'This transfer is not waiting to be received.'); end if;
  v_day := gold.open_day_id(t.destination_branch_id);
  if v_day is null then perform gold.fail(409, 'DAY_NOT_OPEN', 'Open the day at the receiving branch first.'); end if;

  if t.kind = 'goods' then
    for r in select value as c from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) loop
      select * into l from gold.transfer_goods_lines where id = (r.c->>'lineId')::uuid and transfer_id = p_id for update;
      if not found then perform gold.fail(422, 'VALIDATION_FAILED', 'A line in the receipt does not belong to this transfer.'); end if;
      if l.id = any(v_seen) then perform gold.fail(422, 'VALIDATION_FAILED', 'A line was confirmed twice.'); end if;
      v_seen := v_seen || l.id;
      v_out := r.c->>'outcome'; v_note := nullif(trim(coalesce(r.c->>'note', '')), '');
      if v_out = 'matched' then
        v_top := l.released_top; v_down := l.released_down; v_val := l.released_value;
      elsif v_out = 'differs' then
        v_top := (r.c->>'top')::numeric; v_down := (r.c->>'down')::numeric;
        if v_top is null or v_down is null or v_top < 0 or v_down < 0 then perform gold.fail(422, 'VALIDATION_FAILED', 'Enter the weights you found for the line that differs.'); end if;
        if v_top = l.released_top and v_down = l.released_down then v_out := 'matched'; v_val := l.released_value;
        else
          v_val := case when l.released_top > 0 then round(l.released_value * v_top / l.released_top, 2) else 0 end;
          if not gold.has_text(v_note, 3) then perform gold.fail(422, 'EXPLANATION_REQUIRED', 'Say what you found for a line that differs.'); end if;
        end if;
      elsif v_out = 'missing' then
        v_top := null; v_down := null; v_val := null;
        if not gold.has_text(v_note, 3) then perform gold.fail(422, 'EXPLANATION_REQUIRED', 'Say what happened to a line that did not arrive.'); end if;
      else
        perform gold.fail(422, 'VALIDATION_FAILED', 'Each line must be matched, differs or missing.');
      end if;
      update gold.transfer_goods_lines set outcome = v_out, received_top = v_top, received_down = v_down, received_value = v_val where id = l.id;
      if v_out <> 'missing' then
        v_rt := v_rt + v_top; v_rd := v_rd + v_down; v_rv := v_rv + v_val;
        if l.transaction_item_id is not null then
          update gold.transaction_items set location_branch_id = t.destination_branch_id, location_state = 'on_hand' where id = l.transaction_item_id;
        end if;
      end if;
      if v_out <> 'matched' then
        v_bad := true;
        v_asset := case when v_out = 'missing' then 'goods_value' when v_top is distinct from l.released_top then 'goods_top' else 'goods_down' end;
        v_exp := case v_asset when 'goods_value' then l.released_value when 'goods_top' then l.released_top else l.released_down end;
        v_act := case v_asset when 'goods_value' then 0 when 'goods_top' then v_top else v_down end;
        insert into gold.discrepancies (tenant_id, branch_id, business_day_id, kind, asset, transfer_id, transfer_line_id, expected, actual, difference,
                                        reported_explanation, opened_by)
        values (t.tenant_id, t.destination_branch_id, v_day, 'transfer_receipt', v_asset, p_id, l.id, v_exp, v_act, v_act - v_exp, v_note, v_user);
        perform gold.transfer_event(p_id, 'discrepancy_flagged', jsonb_build_object('lineId', l.id, 'outcome', v_out, 'note', v_note));
      end if;
    end loop;
    if (select count(*) from gold.transfer_goods_lines where transfer_id = p_id and outcome = 'pending') > 0 then
      perform gold.fail(422, 'LINES_MISSING', 'Confirm every line: matched, differs or missing.');
    end if;
    if v_rt <> 0 or v_rd <> 0 or v_rv <> 0 then
      perform gold.post_goods(t.destination_branch_id, v_day, v_at, v_rt, v_rd, v_rv, 'transfer_receipt', p_id, 'Received on ' || t.reference);
    end if;
    update gold.transfers set status = case when v_bad then 'received_with_discrepancy' else 'received' end, received_by = v_user, received_at = v_at,
      received_top = v_rt, received_down = v_rd, received_value = v_rv, receipt_note = nullif(trim(coalesce(p->>'note', '')), '')
    where id = p_id;
  else
    v_cash := gold.lines_total(p->'lines');
    if p->'lines' is null then perform gold.fail(422, 'VALIDATION_FAILED', 'Enter the notes you counted (an empty envelope is {}).'); end if;
    if v_cash > 0 then perform gold.post_cash(t.destination_branch_id, v_day, v_at, p->'lines', 1, 'transfer_receipt', p_id, 'Cash received on ' || t.reference); end if;
    v_bad := v_cash <> t.declared_cash;
    if v_bad then
      if not gold.has_text(p->>'note', 3) then perform gold.fail(422, 'EXPLANATION_REQUIRED', 'The count differs from what was sent. Say what you found.'); end if;
      insert into gold.discrepancies (tenant_id, branch_id, business_day_id, kind, asset, transfer_id, expected, actual, difference, reported_explanation, opened_by)
      values (t.tenant_id, t.destination_branch_id, v_day, 'transfer_receipt', 'cash', p_id, t.declared_cash, v_cash, v_cash - t.declared_cash,
              trim(p->>'note'), v_user);
      perform gold.transfer_event(p_id, 'discrepancy_flagged', jsonb_build_object('expected', gold.ts(t.declared_cash), 'actual', gold.ts(v_cash), 'note', p->>'note'));
    end if;
    update gold.transfers set status = case when v_bad then 'received_with_discrepancy' else 'received' end, received_by = v_user, received_at = v_at,
      received_cash = v_cash, receipt_note = nullif(trim(coalesce(p->>'note', '')), '')
    where id = p_id;
  end if;
  perform gold.transfer_event(p_id, 'received', jsonb_build_object('discrepancy', v_bad));
  return gold.transfer_json(p_id);
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant select on gold.v_interbranch_position to gold_app;
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;