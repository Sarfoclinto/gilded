-- 0067 (B67): Workings, a person's own scratch sheets for rough calculations.
--   * A sheet is one JSON document (notes placed on a canvas) with a name. It belongs to its owner alone, exactly like My pictures:
--     row-level security on the signed-in person, no role or permission opens it, deletion is real, nothing is audited.
--   * Scratch only: nothing here touches the books. A person copies a result into a form themselves.
--   * Saving carries the version the device started from. If the server already holds a newer version (edited on another device),
--     the server keeps its copy and stores the incoming one as a separate sheet "<name> (other device)", so nothing is silently lost.
--   * Settings: workings.enabled, workings.maxPerUser (sheets), workings.maxKb (size of one sheet).
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
    'personalPictures.enabled', true,
    'personalPictures.maxPerUser', 300,
    'personalPictures.maxMb', 300,
    'personalPictures.purgeDays', 90,
    'workings.enabled', true,
    'workings.maxPerUser', 200,
    'workings.maxKb', 256,
    'allowance.perPerson', 100,
    'receipt.printer', false,
    'receipt.paper', '80',
    'receipt.businessName', '',
    'receipt.tagline', '',
    'receipt.address', '',
    'receipt.phone', '',
    'receipt.footer', '')
$$;

create table gold.workings (
  id         uuid primary key,
  tenant_id  uuid not null references gold.tenants (id),
  owner_id   uuid not null references gold.users (id),
  name       text not null,
  doc        jsonb not null,
  notes      int  not null default 0,
  version    int  not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workings_owner on gold.workings (tenant_id, owner_id, updated_at desc);
alter table gold.workings enable row level security;
alter table gold.workings force row level security;
create policy owner_only on gold.workings
  using (tenant_id = gold.current_tenant() and owner_id = gold.current_actor())
  with check (tenant_id = gold.current_tenant() and owner_id = gold.current_actor());

create function gold.working_json(w gold.workings, p_doc boolean) returns jsonb language sql stable as $$
  select jsonb_build_object('id', w.id, 'name', w.name, 'notes', w.notes, 'version', w.version, 'createdAt', gold.iso(w.created_at), 'updatedAt', gold.iso(w.updated_at))
         || case when p_doc then jsonb_build_object('doc', w.doc) else '{}'::jsonb end
$$;

create function gold.workings_usage() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'enabled', coalesce((gold.setting('workings.enabled'))::boolean, true),
    'count', (select count(*) from gold.workings where owner_id = gold.current_actor()),
    'maxCount', greatest(coalesce((gold.setting('workings.maxPerUser'))::int, 200), 1),
    'maxKb', greatest(coalesce((gold.setting('workings.maxKb'))::int, 256), 1))
$$;

-- the person's sheets, newest edited first, without their contents. p: { q }
create function gold.workings_list(p jsonb) returns jsonb language plpgsql stable as $$
declare v_q text := nullif(trim(coalesce(p->>'q', '')), '');
begin
  perform gold.require_actor();
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(gold.working_json(w, false) order by w.updated_at desc, w.id) from gold.workings w
                        where w.owner_id = gold.current_actor() and (v_q is null or w.name ilike '%' || v_q || '%')), '[]'::jsonb),
    'usage', gold.workings_usage());
end $$;

create function gold.working_get(p_id uuid) returns jsonb language sql stable as $$
  select gold.working_json(w, true) from gold.workings w where w.id = p_id and w.owner_id = gold.current_actor()
$$;

-- save a sheet. p: { id, name, doc, baseVersion }. Returns { data (the sheet as now stored), copy (a second sheet when the versions clashed, else null) }.
create function gold.working_save(p jsonb) returns jsonb language plpgsql as $$
declare
  v_user uuid := gold.require_actor(); v_id uuid := (p->>'id')::uuid; v_name text := left(coalesce(nullif(trim(p->>'name'), ''), 'Untitled'), 120);
  v_doc jsonb := p->'doc'; v_base int := nullif(p->>'baseVersion', '')::int; w gold.workings; u jsonb := gold.workings_usage(); v_notes int; v_copy gold.workings;
begin
  if v_id is null then perform gold.fail(422, 'VALIDATION_FAILED', 'The sheet needs an id.'); end if;
  if v_doc is null or jsonb_typeof(v_doc) <> 'object' or jsonb_typeof(v_doc->'notes') <> 'array' then perform gold.fail(422, 'VALIDATION_FAILED', 'The sheet is not in a shape that can be saved.'); end if;
  if octet_length(v_doc::text) > (u->>'maxKb')::int * 1024 then perform gold.fail(422, 'WORKING_TOO_BIG', format('This sheet is bigger than the %s KB a sheet may be. Split it into two.', u->>'maxKb')); end if;
  v_notes := jsonb_array_length(v_doc->'notes');
  select * into w from gold.workings where id = v_id and owner_id = v_user;
  if not found then
    if not (u->>'enabled')::boolean then perform gold.fail(403, 'WORKINGS_OFF', 'Workings are switched off for this company.'); end if;
    if (u->>'count')::int >= (u->>'maxCount')::int then perform gold.fail(422, 'WORKINGS_FULL', format('You have reached the limit of %s sheets. Delete some to make more.', u->>'maxCount')); end if;
    begin
      insert into gold.workings (id, tenant_id, owner_id, name, doc, notes) values (v_id, gold.current_tenant(), v_user, v_name, v_doc, v_notes) returning * into w;
    exception when unique_violation then
      perform gold.fail(409, 'ID_IN_USE', 'That sheet id is already used.');
    end;
    return jsonb_build_object('data', gold.working_json(w, false), 'copy', null);
  end if;
  if w.doc = v_doc and w.name = v_name then return jsonb_build_object('data', gold.working_json(w, false), 'copy', null); end if;
  if v_base is not null and v_base < w.version then
    -- edited elsewhere since this device last saw it: keep both
    insert into gold.workings (id, tenant_id, owner_id, name, doc, notes) values (gen_random_uuid(), gold.current_tenant(), v_user, left(v_name || ' (other device)', 120), v_doc, v_notes) returning * into v_copy;
    return jsonb_build_object('data', gold.working_json(w, true), 'copy', gold.working_json(v_copy, false));
  end if;
  update gold.workings set name = v_name, doc = v_doc, notes = v_notes, version = version + 1, updated_at = now() where id = v_id returning * into w;
  return jsonb_build_object('data', gold.working_json(w, false), 'copy', null);
end $$;

create function gold.working_rename(p_id uuid, p_name text) returns jsonb language plpgsql as $$
declare w gold.workings;
begin
  perform gold.require_actor();
  update gold.workings set name = left(coalesce(nullif(trim(p_name), ''), 'Untitled'), 120), updated_at = now() where id = p_id and owner_id = gold.current_actor() returning * into w;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That sheet was not found.'); end if;
  return gold.working_json(w, false);
end $$;

create function gold.workings_delete(p_ids uuid[]) returns jsonb language plpgsql as $$
declare v_n int;
begin
  perform gold.require_actor();
  with d as (delete from gold.workings where id = any (coalesce(p_ids, '{}')) and owner_id = gold.current_actor() returning 1)
  select count(*) into v_n from d;
  return jsonb_build_object('deleted', v_n);
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant select, insert, update, delete on gold.workings to gold_app;
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;