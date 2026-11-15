-- 0061 (B61): photos for the closing day (the scaled gold in the branch) and for gold left as security for a loan.
--   * A picture can now be attached to a business day (slot closing, opening or other) and to a held-gold record (slot collateral or other).
--     Who may see or add: people at that branch. Nothing is ever required: a day closes and a loan is given with no photo.
--   * The day and the held gold say how many pictures they have, so the screens can tell a reviewer plainly that there is none.
create or replace function gold.attachment_visible(a gold.attachments, p_scope uuid[]) returns boolean language sql stable as $$
  select case a.entity_type
    when 'transfer' then exists (select 1 from gold.transfers t where t.id = a.entity_id and (t.origin_branch_id = any (coalesce(p_scope, '{}')) or t.destination_branch_id = any (coalesce(p_scope, '{}'))))
    when 'day' then exists (select 1 from gold.business_days d where d.id = a.entity_id and d.branch_id = any (coalesce(p_scope, '{}')))
    when 'collateral' then exists (select 1 from gold.collateral_holdings h where h.id = a.entity_id and h.branch_id = any (coalesce(p_scope, '{}')))
    when 'user' then true   -- profile pictures are seen by everyone in the company
    else false end
$$;

create or replace function gold.add_attachment(p jsonb, p_scope uuid[]) returns jsonb language plpgsql as $$
declare
  v_user uuid := gold.require_actor(); v_id uuid := (p->>'id')::uuid; v_type text := p->>'entityType'; v_ent uuid := (p->>'entityId')::uuid;
  v_slot text := coalesce(nullif(p->>'slot', ''), 'other'); a gold.attachments; v_branch uuid; t gold.transfers;
begin
  select * into a from gold.attachments where id = v_id;
  if found then
    if a.uploaded_by is distinct from v_user then perform gold.fail(409, 'ATTACHMENT_ID_TAKEN', 'That picture id is already used.'); end if;
    return jsonb_build_object('replayed', true, 'data', gold.attachment_json(a));
  end if;
  if v_type = 'transfer' then
    if v_slot not in ('release', 'receive', 'other') then perform gold.fail(422, 'VALIDATION_FAILED', 'That is not a place on a transfer.'); end if;
    select * into t from gold.transfers where id = v_ent;
    if not found or not (t.origin_branch_id = any (coalesce(p_scope, '{}')) or t.destination_branch_id = any (coalesce(p_scope, '{}'))) then
      perform gold.fail(404, 'NOT_FOUND', 'That transfer was not found.');
    end if;
    v_branch := case when v_slot = 'receive' then t.destination_branch_id else t.origin_branch_id end;
  elsif v_type = 'day' then
    if v_slot not in ('closing', 'opening', 'other') then perform gold.fail(422, 'VALIDATION_FAILED', 'That is not a place on a day.'); end if;
    select branch_id into v_branch from gold.business_days where id = v_ent;
    if v_branch is null or not (v_branch = any (coalesce(p_scope, '{}'))) then perform gold.fail(404, 'NOT_FOUND', 'That day was not found.'); end if;
  elsif v_type = 'collateral' then
    if v_slot not in ('collateral', 'other') then perform gold.fail(422, 'VALIDATION_FAILED', 'That is not a place on held gold.'); end if;
    select branch_id into v_branch from gold.collateral_holdings where id = v_ent;
    if v_branch is null or not (v_branch = any (coalesce(p_scope, '{}'))) then perform gold.fail(404, 'NOT_FOUND', 'That held gold was not found.'); end if;
  elsif v_type = 'user' then
    if v_ent <> v_user then perform gold.fail(403, 'FORBIDDEN', 'You can only change your own profile picture.'); end if;
    v_slot := 'profile';
  else
    perform gold.fail(422, 'VALIDATION_FAILED', 'Pictures cannot be attached to that yet.');
  end if;
  insert into gold.attachments (id, tenant_id, entity_type, entity_id, storage_key, thumb_key, file_name, content_type, size_bytes, sha256, uploaded_by,
                                branch_id, slot, width, height, taken_at, source, stamped, uploaded_at)
  values (v_id, gold.current_tenant(), v_type, v_ent, p->>'storageKey', nullif(p->>'thumbKey', ''), coalesce(nullif(p->>'fileName', ''), v_id::text || '.jpg'),
          coalesce(nullif(p->>'contentType', ''), 'image/jpeg'), (p->>'size')::bigint, decode(p->>'sha256', 'hex'), v_user,
          v_branch, v_slot, nullif(p->>'width', '')::int, nullif(p->>'height', '')::int, nullif(p->>'takenAt', '')::timestamptz,
          nullif(p->>'source', ''), coalesce((p->>'stamped')::boolean, false), clock_timestamp())
  returning * into a;
  perform gold.audit('attachment.add', 'attachment', a.id::text, null, jsonb_build_object('entityType', v_type, 'entityId', v_ent, 'slot', v_slot));
  if v_type = 'transfer' then
    perform gold.transfer_event(v_ent, 'attachment_added', jsonb_build_object('slot', v_slot, 'attachmentId', a.id));
  end if;
  return jsonb_build_object('replayed', false, 'data', gold.attachment_json(a));
end $$;

-- how many live pictures a thing has in a slot
create function gold.photo_count(p_type text, p_entity uuid, p_slot text) returns int language sql stable as $$
  select count(*)::int from gold.attachments a
  where a.entity_type = p_type and a.entity_id = p_entity and a.slot = p_slot
    and not exists (select 1 from gold.attachment_removals r where r.attachment_id = a.id)
$$;

-- the day as shown, with its closing pictures counted
alter function gold.day_json(uuid) rename to day_json_v4;
create function gold.day_json(p_day uuid) returns jsonb language sql stable as $$
  select gold.day_json_v4(p_day) || jsonb_build_object('photos', jsonb_build_object(
    'opening', gold.photo_count('day', p_day, 'opening'), 'closing', gold.photo_count('day', p_day, 'closing'), 'other', gold.photo_count('day', p_day, 'other')))
$$;

-- held gold as shown, with its pictures counted
alter function gold.collateral_json(uuid) rename to collateral_json_v2;
create function gold.collateral_json(p_id uuid) returns jsonb language sql stable as $$
  select gold.collateral_json_v2(p_id) || jsonb_build_object('photos', gold.photo_count('collateral', p_id, 'collateral'))
$$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then grant execute on all functions in schema gold to gold_app; end if;
end $$;