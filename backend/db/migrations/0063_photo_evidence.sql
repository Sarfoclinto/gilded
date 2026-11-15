-- 0063 (B63): evidence rules for photos. None of them blocks work except the company's own "camera only" choice.
--   * Setting photos.cameraOnly (off by default): when on, a picture chosen from the library is refused; only a fresh camera picture is kept.
--   * The same picture sent for two records is noticed (by the fingerprint of the original file the phone started from) and shown as "reused";
--     reviewers get a notification. The first use is never marked.
--   * gold.photo_gaps: closed days with no closing picture, hand-overs with no picture, held gold with no picture, for the reviewers' list.
create or replace function gold.setting_defaults() returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'payout.twoStep', false,
    'payout.sameUserMayPay', true,
    'payout.blindCheck', false,
    'count.blind', false,
    'customers.autoCreate', true,
    'offline.maxDays', 7,
    'drawer.looseBranches', '[]'::jsonb,
    'market.worldChart', true,
    'photos.cameraOnly', false,
    'allowance.perPerson', 100,
    'receipt.printer', false,
    'receipt.paper', '80',
    'receipt.businessName', '',
    'receipt.tagline', '',
    'receipt.address', '',
    'receipt.phone', '',
    'receipt.footer', '')
$$;

-- the fingerprint of the file a picture was made from (before the phone shrank and stamped it); written once, never changed
create table gold.attachment_fingerprints (
  attachment_id uuid primary key references gold.attachments (id),
  tenant_id     uuid not null references gold.tenants (id),
  original_sha  bytea not null
);
create index attachment_fingerprints_sha on gold.attachment_fingerprints (tenant_id, original_sha);
alter table gold.attachment_fingerprints enable row level security;
alter table gold.attachment_fingerprints force row level security;
create policy tenant_isolation on gold.attachment_fingerprints using (tenant_id = gold.current_tenant()) with check (tenant_id = gold.current_tenant());
create trigger attachment_fingerprints_immutable before update or delete on gold.attachment_fingerprints for each row execute function gold.forbid_mutation();

-- a picture as shown, now saying whether an earlier live picture has the same origin
alter function gold.attachment_json(gold.attachments) rename to attachment_json_v2;
create function gold.attachment_json(a gold.attachments) returns jsonb language sql stable as $$
  select gold.attachment_json_v2(a) || jsonb_build_object('reused', exists (
    select 1 from gold.attachment_fingerprints f
    join gold.attachment_fingerprints g on g.original_sha = f.original_sha and g.attachment_id <> f.attachment_id
    join gold.attachments o on o.id = g.attachment_id
    where f.attachment_id = a.id and (o.uploaded_at, o.id) < (a.uploaded_at, a.id)
      and not exists (select 1 from gold.attachment_removals r where r.attachment_id = o.id)))
$$;

alter function gold.add_attachment(jsonb, uuid[]) rename to add_attachment_v4;
create function gold.add_attachment(p jsonb, p_scope uuid[]) returns jsonb language plpgsql as $$
declare r jsonb; v_id uuid := (p->>'id')::uuid; v_orig bytea; v_branch uuid; v_label text; v_type text := p->>'entityType';
begin
  if v_type <> 'user' and p->>'source' = 'library' and coalesce((gold.setting('photos.cameraOnly'))::boolean, false) then
    perform gold.fail(422, 'CAMERA_ONLY', 'This company only keeps pictures taken with the camera, not from the library.');
  end if;
  r := gold.add_attachment_v4(p, p_scope);
  if v_type <> 'user' and not (r->>'replayed')::boolean and coalesce(p->>'originalSha', '') ~ '^[0-9a-f]{64}$' then
    v_orig := decode(p->>'originalSha', 'hex');
    insert into gold.attachment_fingerprints (attachment_id, tenant_id, original_sha) values (v_id, gold.current_tenant(), v_orig);
    if exists (select 1 from gold.attachment_fingerprints f join gold.attachments o on o.id = f.attachment_id
               where f.original_sha = v_orig and f.attachment_id <> v_id and not exists (select 1 from gold.attachment_removals x where x.attachment_id = o.id)) then
      select branch_id into v_branch from gold.attachments where id = v_id;
      perform gold.notify(gold.current_tenant(), 'photo_reused', 'The same picture was used on two records',
                          format('A %s picture was sent that was already used before. Open the Photos page to compare them.', v_type), '/photos',
                          case when v_branch is null then null else array[v_branch] end, 'attachments:library');
      perform gold.audit('attachment.reused', 'attachment', v_id::text, null, jsonb_build_object('entityType', v_type, 'entityId', p->>'entityId'));
      r := jsonb_set(r, '{data}', gold.attachment_json((select a from gold.attachments a where a.id = v_id)));
    end if;
  end if;
  return r;
end $$;

-- Pictures that are missing, for reviewers. p: { days (default 30) }. Held gold is listed however old.
create function gold.photo_gaps(p jsonb, p_scope uuid[]) returns jsonb language plpgsql stable as $$
declare v_days int := least(greatest(coalesce(nullif(p->>'days', '')::int, 30), 1), 365);
begin
  return coalesce((
    select jsonb_agg(g order by (g->>'at') desc) from (
      select jsonb_build_object('kind', 'day', 'id', d.id, 'label', b.name || ' · ' || d.business_date::text, 'branchId', b.id, 'branchName', b.name,
                                'at', gold.iso(d.closed_at), 'missing', 'closing picture') as g
      from gold.business_days d join gold.branches b on b.id = d.branch_id
      where d.status = 'closed' and d.branch_id = any (coalesce(p_scope, '{}')) and d.closed_at > now() - make_interval(days => v_days)
        and gold.photo_count('day', d.id, 'closing') = 0
      union all
      select jsonb_build_object('kind', 'transfer', 'id', t.id, 'label', t.reference, 'branchId', b.id, 'branchName', b.name,
                                'at', gold.iso(t.released_at), 'missing', 'hand-over picture')
      from gold.transfers t join gold.branches b on b.id = t.origin_branch_id
      where t.released_at is not null and t.status <> 'cancelled' and t.origin_branch_id = any (coalesce(p_scope, '{}')) and t.released_at > now() - make_interval(days => v_days)
        and gold.photo_count('transfer', t.id, 'release') = 0
      union all
      select jsonb_build_object('kind', 'collateral', 'id', h.id, 'label', c.name, 'branchId', b.id, 'branchName', b.name,
                                'at', gold.iso(h.received_at), 'missing', 'picture of the gold')
      from gold.collateral_holdings h join gold.branches b on b.id = h.branch_id join gold.customers c on c.id = h.customer_id
      where h.status = 'held' and h.branch_id = any (coalesce(p_scope, '{}')) and gold.photo_count('collateral', h.id, 'collateral') = 0
      limit 300
    ) x(g)), '[]'::jsonb);
end $$;

insert into gold.role_permissions (tenant_id, role_id, permission)
select r.tenant_id, r.id, 'attachments:library' from gold.roles r where r.key in ('manager', 'director') and r.is_system
on conflict do nothing;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then grant execute on all functions in schema gold to gold_app; end if;
end $$;