-- 0062 (B62): the Photos library, pictures on purchases, and customer ID pictures.
--   * A picture can now belong to a purchase (slot goods, other) and to a customer (slot id, other). Nothing is ever required.
--   * Customer ID pictures are personal data: only people holding attachments:ids may list or see them, and every time one is opened
--     the audit trail gets a line (who, when), at most one per person per picture per ten minutes.
--   * gold.photo_library: every live picture the caller may see, newest first, with what it belongs to, filters and pages.
--   * Profile pictures are not part of the library.
-- The old two-argument helpers keep working and treat customer pictures as not visible.
-- the two-argument check now also covers purchases (customer pictures stay hidden without the permission)
create or replace function gold.attachment_visible(a gold.attachments, p_scope uuid[]) returns boolean language sql stable as $$
  select case a.entity_type
    when 'transfer' then exists (select 1 from gold.transfers t where t.id = a.entity_id and (t.origin_branch_id = any (coalesce(p_scope, '{}')) or t.destination_branch_id = any (coalesce(p_scope, '{}'))))
    when 'day' then exists (select 1 from gold.business_days d where d.id = a.entity_id and d.branch_id = any (coalesce(p_scope, '{}')))
    when 'collateral' then exists (select 1 from gold.collateral_holdings h where h.id = a.entity_id and h.branch_id = any (coalesce(p_scope, '{}')))
    when 'transaction' then exists (select 1 from gold.transactions x where x.id = a.entity_id and x.branch_id = any (coalesce(p_scope, '{}')))
    when 'user' then true
    else false end
$$;

create function gold.attachment_visible(a gold.attachments, p_scope uuid[], p_can_ids boolean) returns boolean language sql stable as $$
  select case a.entity_type
    when 'customer' then coalesce(p_can_ids, false)
    when 'transaction' then exists (select 1 from gold.transactions x where x.id = a.entity_id and x.branch_id = any (coalesce(p_scope, '{}')))
    else gold.attachment_visible(a, p_scope) end
$$;

create function gold.attachments_json(p_type text, p_entity uuid, p_scope uuid[], p_can_ids boolean) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(gold.attachment_json(a) order by coalesce(a.taken_at, a.uploaded_at), a.id), '[]'::jsonb)
  from gold.attachments a
  where a.entity_type = p_type and a.entity_id = p_entity and gold.attachment_visible(a, p_scope, p_can_ids)
    and not exists (select 1 from gold.attachment_removals r where r.attachment_id = a.id)
$$;

-- one picture to serve; opening a customer ID leaves a line in the audit trail
create function gold.attachment_open(p_id uuid, p_scope uuid[], p_can_ids boolean) returns jsonb language plpgsql as $$
declare a gold.attachments;
begin
  select * into a from gold.attachments where id = p_id;
  if not found or not gold.attachment_visible(a, p_scope, p_can_ids)
     or exists (select 1 from gold.attachment_removals r where r.attachment_id = a.id) then return null; end if;
  if a.entity_type = 'customer' and not exists (
       select 1 from gold.audit_events e
       where e.action = 'attachment.id_viewed' and e.entity_id = a.id::text and e.actor_user_id is not distinct from gold.current_actor()
         and e.occurred_at > now() - interval '10 minutes') then
    perform gold.audit('attachment.id_viewed', 'attachment', a.id::text, null, jsonb_build_object('customerId', a.entity_id));
  end if;
  return jsonb_build_object('storageKey', a.storage_key, 'thumbKey', a.thumb_key, 'contentType', a.content_type, 'fileName', a.file_name, 'sha256', encode(a.sha256, 'hex'));
end $$;

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
  elsif v_type = 'transaction' then
    if v_slot not in ('goods', 'other') then perform gold.fail(422, 'VALIDATION_FAILED', 'That is not a place on a purchase.'); end if;
    select branch_id into v_branch from gold.transactions where id = v_ent;
    if v_branch is null or not (v_branch = any (coalesce(p_scope, '{}'))) then perform gold.fail(404, 'NOT_FOUND', 'That purchase was not found.'); end if;
  elsif v_type = 'customer' then
    if v_slot not in ('id', 'other') then perform gold.fail(422, 'VALIDATION_FAILED', 'That is not a place on a customer.'); end if;
    if not exists (select 1 from gold.customers where id = v_ent) then perform gold.fail(404, 'NOT_FOUND', 'That customer was not found.'); end if;
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

-- take a picture off the screen; p_can_ids lets someone holding attachments:ids remove a customer ID picture
create function gold.remove_attachment(p_id uuid, p_reason text, p_can_any boolean, p_scope uuid[], p_can_ids boolean) returns jsonb language plpgsql as $$
declare v_user uuid := gold.require_actor(); a gold.attachments;
begin
  select * into a from gold.attachments where id = p_id;
  if not found or not gold.attachment_visible(a, p_scope, p_can_ids) then perform gold.fail(404, 'NOT_FOUND', 'That picture was not found.'); end if;
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

-- The library. p: { branchId, type, from, to (dates), uploaderId, q, page, size }. Newest first.
create function gold.photo_library(p jsonb, p_scope uuid[], p_can_ids boolean) returns jsonb language plpgsql stable as $$
declare
  v_branch uuid := nullif(p->>'branchId', '')::uuid; v_type text := nullif(p->>'type', ''); v_up uuid := nullif(p->>'uploaderId', '')::uuid;
  v_from date := nullif(p->>'from', '')::date; v_to date := nullif(p->>'to', '')::date; v_q text := nullif(btrim(coalesce(p->>'q', '')), '');
  v_size int := least(greatest(coalesce(nullif(p->>'size', '')::int, 40), 1), 100); v_page int := greatest(coalesce(nullif(p->>'page', '')::int, 1), 1);
  v_total int; v_items jsonb;
begin
  with lib as (
    select a as att,
      case a.entity_type
        when 'transfer' then (select t.reference from gold.transfers t where t.id = a.entity_id)
        when 'day' then (select b.name || ' · ' || d.business_date::text from gold.business_days d join gold.branches b on b.id = d.branch_id where d.id = a.entity_id)
        when 'collateral' then (select c.name from gold.collateral_holdings h join gold.customers c on c.id = h.customer_id where h.id = a.entity_id)
        when 'transaction' then (select x.reference || ' · ' || x.customer_name from gold.transactions x where x.id = a.entity_id)
        when 'customer' then (select c.name from gold.customers c where c.id = a.entity_id)
      end as label,
      (select b.name from gold.branches b where b.id = a.branch_id) as branch_name,
      coalesce(a.taken_at, a.uploaded_at) as at
    from gold.attachments a
    where a.entity_type <> 'user'
      and gold.attachment_visible(a, p_scope, p_can_ids)
      and not exists (select 1 from gold.attachment_removals r where r.attachment_id = a.id)
      and (v_branch is null or a.branch_id = v_branch)
      and (v_type is null or a.entity_type = v_type)
      and (v_up is null or a.uploaded_by = v_up)
      and (v_from is null or coalesce(a.taken_at, a.uploaded_at) >= v_from::timestamptz)
      and (v_to is null or coalesce(a.taken_at, a.uploaded_at) < (v_to + 1)::timestamptz)
  ), f as (select * from lib where v_q is null or coalesce(label, '') ilike '%' || v_q || '%')
  select (select count(*) from f),
         coalesce((select jsonb_agg(gold.attachment_json(g.att) || jsonb_build_object('label', g.label, 'branchId', (g.att).branch_id, 'branchName', g.branch_name) order by g.at desc, (g.att).id)
                   from (select * from f order by at desc, (att).id limit v_size offset (v_page - 1) * v_size) g), '[]'::jsonb)
  into v_total, v_items;
  return jsonb_build_object('items', v_items, 'total', v_total, 'page', v_page, 'size', v_size);
end $$;

-- who may open the library, and who may see customer IDs
insert into gold.role_permissions (tenant_id, role_id, permission)
select r.tenant_id, r.id, perm from gold.roles r, unnest(array['attachments:library', 'attachments:ids']) perm
where r.key in ('manager', 'director') and r.is_system
on conflict do nothing;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then grant execute on all functions in schema gold to gold_app; end if;
end $$;