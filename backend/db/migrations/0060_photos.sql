-- 0060 (B60): photos, the evidence that used to live in WhatsApp groups.
--   * gold.attachments (made in 0001, never edited once written) gets the facts about a picture: what it is attached to, which slot of it,
--     the size, when it was taken, whether the camera or the library gave it, and whether the time was stamped on it. The picture's id is
--     chosen by the phone, so a picture queued offline and sent twice is stored once.
--   * A picture is never deleted from the books: removing one writes a row in gold.attachment_removals (who, when, why) and it stops showing.
--   * A transfer shows how many pictures it has at hand-over and at receipt, and says plainly when there is none ("no photo yet").
--     No photo is ever required: nothing is blocked, it is only flagged so a reviewer knows.
--   * A person's profile picture is the newest picture on their own user row.
-- The picture bytes are not in the database; they live in the photos volume on the server (storage_key points there).
alter table gold.attachments
  add column branch_id   uuid references gold.branches (id),
  add column slot        text not null default 'other',
  add column width       int,
  add column height      int,
  add column taken_at    timestamptz,
  add column source      text,
  add column stamped     boolean not null default false,
  add column thumb_key   text;

create table gold.attachment_removals (
  attachment_id uuid primary key references gold.attachments (id),
  tenant_id     uuid not null references gold.tenants (id),
  removed_by    uuid not null,
  removed_at    timestamptz not null default now(),
  reason        text
);
alter table gold.attachment_removals enable row level security;
alter table gold.attachment_removals force row level security;
create policy tenant_isolation on gold.attachment_removals using (tenant_id = gold.current_tenant()) with check (tenant_id = gold.current_tenant());
create trigger attachment_removals_immutable before update or delete on gold.attachment_removals for each row execute function gold.forbid_mutation();
alter table gold.transfer_events drop constraint transfer_events_event_type_check;
alter table gold.transfer_events add constraint transfer_events_event_type_check check (event_type in (
  'created', 'goods_added', 'goods_removed', 'collector_set', 'released', 'payment_recorded',
  'received', 'discrepancy_flagged', 'note_added', 'cancelled', 'attachment_added', 'recalled', 'attachment_removed'));
create index attachments_slot on gold.attachments (tenant_id, entity_type, entity_id, slot, uploaded_at);

-- one picture as the app sees it
create function gold.attachment_json(a gold.attachments) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', a.id, 'entityType', a.entity_type, 'entityId', a.entity_id, 'slot', a.slot, 'fileName', a.file_name, 'contentType', a.content_type,
    'size', a.size_bytes, 'width', a.width, 'height', a.height, 'takenAt', gold.iso(coalesce(a.taken_at, a.uploaded_at)), 'source', a.source,
    'stamped', a.stamped, 'uploadedAt', gold.iso(a.uploaded_at), 'by', gold.person_json(a.uploaded_by))
$$;

-- is this picture allowed to be seen by someone with these branches? (the same people who may see the thing it is attached to)
create function gold.attachment_visible(a gold.attachments, p_scope uuid[]) returns boolean language sql stable as $$
  select case a.entity_type
    when 'transfer' then exists (select 1 from gold.transfers t where t.id = a.entity_id and (t.origin_branch_id = any (coalesce(p_scope, '{}')) or t.destination_branch_id = any (coalesce(p_scope, '{}'))))
    when 'user' then true   -- profile pictures are seen by everyone in the company
    else false end
$$;

-- store a picture's facts. p: { id, entityType: transfer|user, entityId, slot, fileName, contentType, size, sha256 (hex), storageKey, thumbKey, width, height, takenAt, source, stamped }
create function gold.add_attachment(p jsonb, p_scope uuid[]) returns jsonb language plpgsql as $$
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

-- the pictures of one thing, oldest first; removed ones are left out
create function gold.attachments_json(p_type text, p_entity uuid, p_scope uuid[]) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(gold.attachment_json(a) order by coalesce(a.taken_at, a.uploaded_at), a.id), '[]'::jsonb)
  from gold.attachments a
  where a.entity_type = p_type and a.entity_id = p_entity and gold.attachment_visible(a, p_scope)
    and not exists (select 1 from gold.attachment_removals r where r.attachment_id = a.id)
$$;

-- one picture to serve: its storage keys, if the caller may see it and it has not been removed
create function gold.attachment_file(p_id uuid, p_scope uuid[]) returns jsonb language sql stable as $$
  select jsonb_build_object('storageKey', a.storage_key, 'thumbKey', a.thumb_key, 'contentType', a.content_type, 'fileName', a.file_name, 'sha256', encode(a.sha256, 'hex'))
  from gold.attachments a
  where a.id = p_id and gold.attachment_visible(a, p_scope) and not exists (select 1 from gold.attachment_removals r where r.attachment_id = a.id)
$$;

-- the newest profile picture of a person, if any
create function gold.profile_picture_id(p_user uuid) returns uuid language sql stable as $$
  select a.id from gold.attachments a
  where a.entity_type = 'user' and a.entity_id = p_user and a.slot = 'profile' and not exists (select 1 from gold.attachment_removals r where r.attachment_id = a.id)
  order by a.uploaded_at desc, a.id desc limit 1
$$;

-- take a picture off the screen (the file and the row stay for the record). p_can_any: the caller holds attachments:remove.
create function gold.remove_attachment(p_id uuid, p_reason text, p_can_any boolean, p_scope uuid[]) returns jsonb language plpgsql as $$
declare v_user uuid := gold.require_actor(); a gold.attachments;
begin
  select * into a from gold.attachments where id = p_id;
  if not found or not gold.attachment_visible(a, p_scope) then perform gold.fail(404, 'NOT_FOUND', 'That picture was not found.'); end if;
  if not (p_can_any or a.uploaded_by = v_user) then perform gold.fail(403, 'FORBIDDEN', 'Only the person who took it, or a manager, can remove a picture.'); end if;
  if not exists (select 1 from gold.attachment_removals where attachment_id = p_id) then
    insert into gold.attachment_removals (attachment_id, tenant_id, removed_by, reason) values (p_id, gold.current_tenant(), v_user, nullif(btrim(coalesce(p_reason, '')), ''));
    perform gold.audit('attachment.remove', 'attachment', p_id::text, gold.attachment_json(a), jsonb_build_object('reason', p_reason));
    if a.entity_type = 'transfer' then
      perform gold.transfer_event(a.entity_id, 'attachment_removed', jsonb_build_object('slot', a.slot, 'attachmentId', p_id));
    end if;
  end if;
  return jsonb_build_object('id', p_id, 'removed', true);
end $$;

-- the transfer as shown, with its pictures counted
alter function gold.transfer_json(uuid) rename to transfer_json_v2;
create function gold.transfer_json(p_id uuid) returns jsonb language sql stable as $$
  select gold.transfer_json_v2(p_id) || jsonb_build_object('photos', jsonb_build_object(
    'release', (select count(*)::int from gold.attachments a where a.entity_type = 'transfer' and a.entity_id = p_id and a.slot = 'release'
                  and not exists (select 1 from gold.attachment_removals r where r.attachment_id = a.id)),
    'receive', (select count(*)::int from gold.attachments a where a.entity_type = 'transfer' and a.entity_id = p_id and a.slot = 'receive'
                  and not exists (select 1 from gold.attachment_removals r where r.attachment_id = a.id)),
    'other',   (select count(*)::int from gold.attachments a where a.entity_type = 'transfer' and a.entity_id = p_id and a.slot = 'other'
                  and not exists (select 1 from gold.attachment_removals r where r.attachment_id = a.id))))
$$;

-- who may take a picture off the screen besides the person who took it
insert into gold.role_permissions (tenant_id, role_id, permission)
select r.tenant_id, r.id, 'attachments:remove' from gold.roles r where r.key in ('manager', 'director') and r.is_system
on conflict do nothing;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant select, insert on gold.attachment_removals to gold_app;
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;