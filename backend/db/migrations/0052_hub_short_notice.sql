-- 0052 (B50): "the drawer ran short at the hub" - a notice for the branch's managers.
--   Several computers in a branch share one drawer through the branch hub. When a computer saved while it could not reach the hub, and the hub
--   later found the drawer could not cover that entry, the hub records it anyway ("reality wins") and says it was short. The computer that
--   hears this tells the server here. Each entry is reported once (a repeat is ignored), kept as a small record, and the people who may review
--   differences at that branch get a notification. Nothing is refused or changed: the entry itself reaches the server the usual way.
create table gold.hub_short_notices (
  tenant_id    uuid not null,
  command_id   text not null,
  branch_id    uuid not null,
  short        jsonb not null,
  short_value  numeric not null,
  captured_at  timestamptz,
  reported_by  uuid,
  reported_at  timestamptz not null default now(),
  primary key (tenant_id, command_id),
  foreign key (tenant_id, branch_id) references gold.branches (tenant_id, id)
);
create index hub_short_notices_branch on gold.hub_short_notices (branch_id, reported_at desc);
alter table gold.hub_short_notices enable row level security;
alter table gold.hub_short_notices force row level security;
create policy tenant_isolation on gold.hub_short_notices
  using (tenant_id = gold.current_tenant()) with check (tenant_id = gold.current_tenant());

-- p: { branchId, commandId, short: { "100": 7, ... }, capturedAt? }  ->  { recorded: true|false, value }
create function gold.report_hub_short(p jsonb) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant(); v_branch uuid; v_cmd text := p->>'commandId'; v_short jsonb := p->'short'; v_at timestamptz;
  v_name text; v_value numeric := 0; v_words text; r record; v_n int;
begin
  begin v_branch := (p->>'branchId')::uuid; exception when others then v_branch := null; end;
  select name into v_name from gold.branches where id = v_branch;
  if v_name is null then perform gold.fail(404, 'NOT_FOUND', 'Branch was not found.'); end if;
  if v_cmd is null or length(v_cmd) not between 1 and 100 then perform gold.fail(422, 'VALIDATION_FAILED', 'commandId is needed.'); end if;
  if v_short is null or jsonb_typeof(v_short) <> 'object' or v_short = '{}'::jsonb then perform gold.fail(422, 'VALIDATION_FAILED', 'short must list the notes that were missing.'); end if;
  for r in select key, value from jsonb_each(v_short) loop
    if r.key !~ '^[1-9][0-9]{0,3}$' or jsonb_typeof(r.value) <> 'number' or (r.value #>> '{}') !~ '^[1-9][0-9]{0,6}$' then
      perform gold.fail(422, 'VALIDATION_FAILED', 'short must be note values with whole counts.');
    end if;
    v_value := v_value + r.key::numeric * (r.value #>> '{}')::numeric;
  end loop;
  begin v_at := (p->>'capturedAt')::timestamptz; exception when others then v_at := null; end;

  insert into gold.hub_short_notices (tenant_id, command_id, branch_id, short, short_value, captured_at, reported_by)
  values (v_tenant, v_cmd, v_branch, v_short, v_value, v_at, gold.current_actor())
  on conflict (tenant_id, command_id) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then return jsonb_build_object('recorded', false); end if;

  select string_agg(format('%s × GHS %s', value #>> '{}', key), ', ' order by key::int desc) into v_words from jsonb_each(v_short);
  perform gold.notify(v_tenant, 'hub_short', format('The drawer ran short at %s''s hub (GHS %s)', v_name, gold.ts(v_value)),
    format('An entry made while a computer could not reach the hub was recorded, but the drawer did not hold enough notes for it: %s. It is counted; check the drawer and this day''s count.', v_words),
    '/drawer/history', array[v_branch], 'discrepancies:review');
  return jsonb_build_object('recorded', true, 'value', gold.ts(v_value));
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant select, insert on gold.hub_short_notices to gold_app;
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;