-- 0073 (B75): Group Sheets, phase 2 (docs/GROUP-SHEET-DESIGN.MD, section 10).
--   * Three kinds of sheet. "money" (as before); "people" (savings: one balance per named person, and the total); "quantity" (mercury: each
--     entry may also carry an amount of something in a unit, such as kg, so the sheet shows what is left as well as the cash).
--     A people sheet keeps its own list of names (a group member, or anyone by name); keepers add and rename them.
--   * Receipt photos on an entry, seen only by those who may see the sheet (their own table, like My pictures: no company role opens them,
--     they are not in the Photos library and not in the audit trail). A photo can be taken off by the person who added it or a keeper;
--     the group's log says so.
--   * Alerts: a member can ask to be told when money is taken out of a sheet (any amount, or from an amount up). The notification goes only
--     to people who can still see the sheet, never to the person who wrote the entry.
--   * A statement for one person (people sheets): the sheet filtered to that person, with their own running balance.

-- ---------------------------------------------------------------- kinds
alter table gold.gs_sheets
  add column kind text not null default 'money' check (kind in ('money', 'people', 'quantity')),
  add column unit text check (unit is null or length(unit) between 1 and 12),
  add column opening_quantity numeric(18,3) not null default 0;

-- the ids-only index also knows each sheet's kind, so an entry from someone who lost access can still be checked
alter table gold.gs_sheet_keys add column kind text not null default 'money';
create or replace function gold.trg_gs_sheet_keys() returns trigger language plpgsql as $$
begin
  insert into gold.gs_sheet_keys (sheet_id, tenant_id, group_id, branch_id, closed_at, kind) values (new.id, new.tenant_id, new.group_id, new.branch_id, new.closed_at, new.kind)
  on conflict (sheet_id) do update set branch_id = excluded.branch_id, closed_at = excluded.closed_at, kind = excluded.kind;
  return null;
end $$;

create table gold.gs_people (
  id         uuid primary key,
  tenant_id  uuid not null references gold.tenants (id),
  group_id   uuid not null references gold.gs_groups (id) on delete cascade,
  sheet_id   uuid not null references gold.gs_sheets (id) on delete cascade,
  name       text not null,
  user_id    uuid references gold.users (id),
  created_by uuid not null references gold.users (id),
  created_at timestamptz not null default now()
);
create unique index gs_people_name on gold.gs_people (sheet_id, lower(name));

alter table gold.gs_entries
  add column person_id uuid references gold.gs_people (id),
  add column quantity numeric(18,3);
alter table gold.gs_entries drop constraint gs_entries_amount_check;
alter table gold.gs_entries add constraint gs_entries_amount_check check (amount <> 0 or coalesce(quantity, 0) <> 0);
create index gs_entries_person on gold.gs_entries (person_id) where person_id is not null;

-- ---------------------------------------------------------------- photos and alerts
create table gold.gs_photos (
  id          uuid primary key,                       -- made by the device: a photo sent twice is kept once
  tenant_id   uuid not null references gold.tenants (id),
  group_id    uuid not null references gold.gs_groups (id) on delete cascade,
  sheet_id    uuid not null references gold.gs_sheets (id) on delete cascade,
  entry_id    uuid not null references gold.gs_entries (id) on delete cascade,
  storage_key text not null,
  thumb_key   text,
  size_bytes  bigint not null,
  sha256      text not null,
  width       int,
  height      int,
  taken_at    timestamptz,
  uploaded_by uuid not null references gold.users (id),
  uploaded_at timestamptz not null default now(),
  removed_at  timestamptz,
  removed_by  uuid references gold.users (id)
);
create index gs_photos_entry on gold.gs_photos (entry_id);

create table gold.gs_alerts (
  tenant_id  uuid not null references gold.tenants (id),
  group_id   uuid not null references gold.gs_groups (id) on delete cascade,
  sheet_id   uuid not null references gold.gs_sheets (id) on delete cascade,
  user_id    uuid not null references gold.users (id),
  min_amount numeric(18,2) not null default 0 check (min_amount >= 0),
  created_at timestamptz not null default now(),
  primary key (sheet_id, user_id)
);

alter table gold.gs_people enable row level security;  alter table gold.gs_people force row level security;
alter table gold.gs_photos enable row level security;  alter table gold.gs_photos force row level security;
alter table gold.gs_alerts enable row level security;  alter table gold.gs_alerts force row level security;

create policy can_see on gold.gs_people for select
  using (tenant_id = gold.current_tenant() and gold.gs_access(group_id, sheet_id, gold.current_actor()) <> 'none');
create policy keepers_add on gold.gs_people for insert
  with check (tenant_id = gold.current_tenant() and gold.gs_role_of(group_id, gold.current_actor()) = 'keeper');
create policy keepers_change on gold.gs_people for update
  using (tenant_id = gold.current_tenant() and gold.gs_role_of(group_id, gold.current_actor()) = 'keeper');

create policy can_see on gold.gs_photos for select
  using (tenant_id = gold.current_tenant() and gold.gs_access(group_id, sheet_id, gold.current_actor()) <> 'none');
create policy own_name on gold.gs_photos for insert with check (tenant_id = gold.current_tenant() and uploaded_by = gold.current_actor());
create policy can_see_change on gold.gs_photos for update
  using (tenant_id = gold.current_tenant() and gold.gs_access(group_id, sheet_id, gold.current_actor()) <> 'none');

-- alerts: a person's own; the entry function reads everyone's to send them (no names or figures are kept here)
create policy company on gold.gs_alerts using (tenant_id = gold.current_tenant()) with check (tenant_id = gold.current_tenant());

-- ---------------------------------------------------------------- shapes
create function gold.gs_person_json(p_id uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('id', x.id, 'name', x.name, 'userId', x.user_id) from gold.gs_people x where x.id = p_id
$$;

create or replace function gold.gs_entry_json(x gold.gs_entries) returns jsonb language sql stable as $$
  select jsonb_build_object('id', x.id, 'sheetId', x.sheet_id, 'amount', gold.ts(x.amount), 'moneyDate', x.money_date, 'note', x.note, 'dayTotal', x.day_total,
    'takesBack', x.takes_back, 'writtenBy', gold.person_json(x.written_by), 'writtenAt', gold.iso(x.written_at), 'receivedAt', gold.iso(x.received_at),
    'afterRemoval', x.after_removal, 'mine', x.written_by = gold.current_actor(),
    'person', case when x.person_id is null then null else gold.gs_person_json(x.person_id) end,
    'quantity', case when x.quantity is null then null else gold.ts(x.quantity) end,
    'photos', coalesce((select jsonb_agg(jsonb_build_object('id', ph.id, 'by', gold.person_json(ph.uploaded_by), 'at', gold.iso(ph.uploaded_at),
                                                          'mine', ph.uploaded_by = gold.current_actor()) order by ph.uploaded_at)
                        from gold.gs_photos ph where ph.entry_id = x.id and ph.removed_at is null), '[]'::jsonb),
    'takenBack', (select jsonb_build_object('by', gold.person_json(t.written_by), 'at', gold.iso(t.written_at), 'id', t.id) from gold.gs_entries t where t.takes_back = x.id))
$$;

create or replace function gold.gs_sheet_totals(s gold.gs_sheets) returns jsonb language sql stable as $$
  with t as (select gold.gs_today(s.branch_id) as d),
  e as (select x.amount, x.quantity, x.money_date, gold.gs_counted(x) as counted from gold.gs_entries x where x.sheet_id = s.id)
  select jsonb_build_object(
    'balance', gold.ts(s.opening_balance + coalesce((select sum(amount) from e), 0)),
    'todayIn', gold.ts(coalesce((select sum(amount) from e, t where e.money_date = t.d and amount > 0 and counted), 0)),
    'todayOut', gold.ts(coalesce((select -sum(amount) from e, t where e.money_date = t.d and amount < 0 and counted), 0)),
    'stock', case when s.kind = 'quantity' then gold.ts(s.opening_quantity + coalesce((select sum(quantity) from e), 0)) end,
    'entries', (select count(*) from e))
$$;

-- people on a people sheet, each with their balance and number of entries
create function gold.gs_people_json(s gold.gs_sheets) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'userId', x.user_id,
           'balance', gold.ts(coalesce((select sum(e.amount) from gold.gs_entries e where e.person_id = x.id), 0)),
           'entries', (select count(*) from gold.gs_entries e where e.person_id = x.id and gold.gs_counted(e))) order by lower(x.name)), '[]'::jsonb)
  from gold.gs_people x where x.sheet_id = s.id
$$;

create or replace function gold.gs_sheet_json(s gold.gs_sheets) returns jsonb language sql stable as $$
  select jsonb_build_object('id', s.id, 'groupId', s.group_id, 'name', s.name, 'branchId', s.branch_id,
    'branchName', (select name from gold.branches where id = s.branch_id),
    'kind', s.kind, 'unit', s.unit, 'openingQuantity', gold.ts(s.opening_quantity),
    'openingBalance', gold.ts(s.opening_balance), 'openingDate', s.opening_date, 'closed', s.closed_at is not null, 'closedAt', gold.iso(s.closed_at),
    'access', gold.gs_access(s.group_id, s.id, gold.current_actor()), 'createdAt', gold.iso(s.created_at),
    'alert', (select jsonb_build_object('minAmount', gold.ts(a.min_amount)) from gold.gs_alerts a where a.sheet_id = s.id and a.user_id = gold.current_actor()),
    'people', case when s.kind = 'people' then gold.gs_people_json(s) end,
    -- the last real entry: a taking back and the line it cancels are left out
    'last', (select gold.gs_entry_json(e) from gold.gs_entries e where e.sheet_id = s.id and e.takes_back is null
               and not exists (select 1 from gold.gs_entries t where t.takes_back = e.id) order by e.written_at desc, e.received_at desc limit 1))
    || gold.gs_sheet_totals(s)
$$;

-- one sheet: totals, and its entries day by day for a period (default the last 31 days). p: { sheetId, from?, to?, personId? }
-- With personId (people sheets) the days, the balance brought forward and the closings are that person's alone: their statement.
create or replace function gold.gs_sheet_get(p jsonb) returns jsonb language plpgsql stable as $$
declare
  s gold.gs_sheets; v_today date; v_from date; v_to date; v_before numeric; v_qbefore numeric; v_person uuid := nullif(p->>'personId', '')::uuid;
begin
  perform gold.require_actor();
  select * into s from gold.gs_sheets where id = (p->>'sheetId')::uuid;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That sheet was not found.'); end if;
  if v_person is not null and not exists (select 1 from gold.gs_people where id = v_person and sheet_id = s.id) then
    perform gold.fail(404, 'NOT_FOUND', 'That person is not on this sheet.');
  end if;
  v_today := gold.gs_today(s.branch_id);
  v_to := least(coalesce(nullif(p->>'to', '')::date, v_today + 1), v_today + 1);
  v_from := greatest(coalesce(nullif(p->>'from', '')::date, v_today - 30), v_to - 3660);
  v_before := case when v_person is null then s.opening_balance else 0 end
              + coalesce((select sum(amount) from gold.gs_entries where sheet_id = s.id and money_date < v_from and (v_person is null or person_id = v_person)), 0);
  v_qbefore := s.opening_quantity + coalesce((select sum(quantity) from gold.gs_entries where sheet_id = s.id and money_date < v_from), 0);
  return gold.gs_sheet_json(s) || jsonb_build_object(
    'groupName', (select name from gold.gs_groups where id = s.group_id),
    'myRole', gold.gs_role_of(s.group_id, gold.current_actor()),
    'personId', v_person,
    'today', v_today, 'from', v_from, 'to', v_to, 'balanceBefore', gold.ts(v_before),
    'stockBefore', case when s.kind = 'quantity' then gold.ts(v_qbefore) end,
    'olderEntries', exists (select 1 from gold.gs_entries where sheet_id = s.id and money_date < v_from and (v_person is null or person_id = v_person)),
    'week', jsonb_build_object(
      'in', gold.ts(coalesce((select sum(amount) from gold.gs_entries x where x.sheet_id = s.id and x.amount > 0 and gold.gs_counted(x) and x.money_date > v_today - 7 and x.money_date <= v_today), 0)),
      'out', gold.ts(coalesce((select -sum(amount) from gold.gs_entries x where x.sheet_id = s.id and x.amount < 0 and gold.gs_counted(x) and x.money_date > v_today - 7 and x.money_date <= v_today), 0))),
    'month', jsonb_build_object(
      'in', gold.ts(coalesce((select sum(amount) from gold.gs_entries x where x.sheet_id = s.id and x.amount > 0 and gold.gs_counted(x) and x.money_date >= date_trunc('month', v_today)::date and x.money_date <= v_today), 0)),
      'out', gold.ts(coalesce((select -sum(amount) from gold.gs_entries x where x.sheet_id = s.id and x.amount < 0 and gold.gs_counted(x) and x.money_date >= date_trunc('month', v_today)::date and x.money_date <= v_today), 0))),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('date', d.money_date, 'in', gold.ts(d.inn), 'out', gold.ts(d.outt), 'closing', gold.ts(v_before + d.running),
                                          'qtyIn', gold.ts(d.qin), 'qtyOut', gold.ts(d.qout),
                                          'stock', case when s.kind = 'quantity' then gold.ts(v_qbefore + d.qrunning) end, 'entries', d.entries)
                       order by d.money_date desc)
      from (
        select money_date, inn, outt, qin, qout, sum(net) over (order by money_date) as running, sum(qnet) over (order by money_date) as qrunning, entries
        from (select e.money_date,
                     coalesce(sum(e.amount) filter (where e.amount > 0 and gold.gs_counted(e)), 0) as inn,
                     coalesce(-sum(e.amount) filter (where e.amount < 0 and gold.gs_counted(e)), 0) as outt,
                     coalesce(sum(e.quantity) filter (where e.quantity > 0 and gold.gs_counted(e)), 0) as qin,
                     coalesce(-sum(e.quantity) filter (where e.quantity < 0 and gold.gs_counted(e)), 0) as qout,
                     sum(e.amount) as net,
                     coalesce(sum(e.quantity), 0) as qnet,
                     jsonb_agg(gold.gs_entry_json(e) order by e.written_at desc, e.received_at desc) as entries
              from gold.gs_entries e where e.sheet_id = s.id and e.money_date >= v_from and e.money_date <= v_to and (v_person is null or e.person_id = v_person)
              group by e.money_date) z
      ) d), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- sheets of each kind
-- p: { groupId, id, name, kind?: money | people | quantity, unit? (quantity), openingQuantity?, branchId?, openingBalance?, openingDate? }
create or replace function gold.gs_sheet_create(p jsonb) returns jsonb language plpgsql as $$
declare v_group uuid := (p->>'groupId')::uuid; v_id uuid := coalesce((p->>'id')::uuid, gen_random_uuid()); v_name text := gold.gs_name(p, 'sheet');
        v_open numeric := 0; v_branch uuid := nullif(p->>'branchId', '')::uuid; s gold.gs_sheets;
        v_kind text := coalesce(nullif(p->>'kind', ''), 'money'); v_unit text := nullif(btrim(coalesce(p->>'unit', '')), ''); v_qopen numeric := 0;
begin
  perform gold.gs_require_role(v_group, 'keeper');
  select * into s from gold.gs_sheets where id = v_id;
  if found then return gold.gs_sheet_json(s); end if;
  if v_kind not in ('money', 'people', 'quantity') then perform gold.fail(422, 'VALIDATION_FAILED', 'Choose money, savings per person, or money and quantity.'); end if;
  if nullif(p->>'openingBalance', '') is not null then
    if p->>'openingBalance' !~ '^-?\d{1,12}(\.\d{1,2})?$' then perform gold.fail(422, 'VALIDATION_FAILED', 'Type the opening balance in cedis, like 1200 or 0.'); end if;
    v_open := (p->>'openingBalance')::numeric;
  end if;
  if v_kind = 'people' and v_open <> 0 then
    perform gold.fail(422, 'VALIDATION_FAILED', 'A savings sheet starts at zero. Bring each person''s balance over as their first entry.');
  end if;
  if v_kind = 'quantity' then
    if v_unit is null or length(v_unit) > 12 then perform gold.fail(422, 'VALIDATION_FAILED', 'Give the unit of the quantity, like kg or g.'); end if;
    if nullif(p->>'openingQuantity', '') is not null then
      if p->>'openingQuantity' !~ '^\d{1,12}(\.\d{1,3})?$' then perform gold.fail(422, 'VALIDATION_FAILED', 'Type the quantity in hand, like 2.5 or 0.'); end if;
      v_qopen := (p->>'openingQuantity')::numeric;
    end if;
  else
    v_unit := null;
  end if;
  if v_branch is not null and not exists (select 1 from gold.branches where id = v_branch) then perform gold.fail(404, 'NOT_FOUND', 'That branch was not found.'); end if;
  if exists (select 1 from gold.gs_sheets where group_id = v_group and lower(name) = lower(v_name)) then perform gold.fail(409, 'NAME_IN_USE', 'This group already has a sheet with that name.'); end if;
  insert into gold.gs_sheets (id, tenant_id, group_id, name, branch_id, opening_balance, opening_date, created_by, kind, unit, opening_quantity)
  values (v_id, gold.current_tenant(), v_group, v_name, v_branch, v_open, nullif(p->>'openingDate', '')::date, gold.current_actor(), v_kind, v_unit, v_qopen) returning * into s;
  perform gold.gs_log(v_group, 'sheet_created', null, jsonb_build_object('sheet', v_name, 'openingBalance', gold.ts(v_open), 'kind', v_kind,
                                                                          'unit', v_unit, 'openingQuantity', case when v_kind = 'quantity' then gold.ts(v_qopen) end));
  return gold.gs_sheet_json(s);
end $$;

-- a person on a savings sheet: a group member, or anyone by name. p: { sheetId, id?, name?, userId? }
create function gold.gs_person_add(p jsonb) returns jsonb language plpgsql as $$
declare s gold.gs_sheets; v_user uuid := nullif(p->>'userId', '')::uuid; v_name text := left(btrim(regexp_replace(coalesce(p->>'name', ''), '\s+', ' ', 'g')), 80);
        v_id uuid := coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid());
begin
  perform gold.require_actor();
  select * into s from gold.gs_sheets where id = (p->>'sheetId')::uuid;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That sheet was not found.'); end if;
  perform gold.gs_require_role(s.group_id, 'keeper');
  if s.kind <> 'people' then perform gold.fail(422, 'VALIDATION_FAILED', 'Only a savings sheet keeps a list of people.'); end if;
  if exists (select 1 from gold.gs_people where id = v_id) then return gold.gs_sheet_json(s); end if;
  if v_user is not null then
    if v_name = '' then select display_name into v_name from gold.users where id = v_user and is_active; end if;
    if v_name is null or v_name = '' then perform gold.fail(404, 'NOT_FOUND', 'That person was not found.'); end if;
  end if;
  if v_name = '' then perform gold.fail(422, 'VALIDATION_FAILED', 'Type the person''s name.'); end if;
  if exists (select 1 from gold.gs_people where sheet_id = s.id and lower(name) = lower(v_name)) then perform gold.fail(409, 'NAME_IN_USE', 'Someone with that name is already on this sheet.'); end if;
  insert into gold.gs_people (id, tenant_id, group_id, sheet_id, name, user_id, created_by) values (v_id, gold.current_tenant(), s.group_id, s.id, v_name, v_user, gold.current_actor());
  perform gold.gs_log(s.group_id, 'person_added', null, jsonb_build_object('sheet', s.name, 'name', v_name));
  return gold.gs_sheet_json(s);
end $$;

create function gold.gs_person_rename(p jsonb) returns jsonb language plpgsql as $$
declare x gold.gs_people; s gold.gs_sheets; v_name text := left(btrim(regexp_replace(coalesce(p->>'name', ''), '\s+', ' ', 'g')), 80);
begin
  perform gold.require_actor();
  select * into x from gold.gs_people where id = (p->>'personId')::uuid;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That person was not found on the sheet.'); end if;
  perform gold.gs_require_role(x.group_id, 'keeper');
  if v_name = '' then perform gold.fail(422, 'VALIDATION_FAILED', 'Type the person''s name.'); end if;
  if v_name <> x.name then
    if exists (select 1 from gold.gs_people where sheet_id = x.sheet_id and lower(name) = lower(v_name) and id <> x.id) then perform gold.fail(409, 'NAME_IN_USE', 'Someone with that name is already on this sheet.'); end if;
    update gold.gs_people set name = v_name where id = x.id;
    select * into s from gold.gs_sheets where id = x.sheet_id;
    perform gold.gs_log(x.group_id, 'person_renamed', null, jsonb_build_object('sheet', s.name, 'from', x.name, 'to', v_name));
  end if;
  select * into s from gold.gs_sheets where id = x.sheet_id;
  return gold.gs_sheet_json(s);
end $$;

-- ---------------------------------------------------------------- entries with a person or a quantity, and alerts
-- p: { id, sheetId, direction?: in | out, amount?, personId? (people sheets), quantity?, qtyDirection?: in | out (quantity sheets),
--      note?, moneyDate?, dayTotal?, writtenAt? }. Sent twice with the same id: kept once.
create or replace function gold.gs_entry_add(p jsonb) returns jsonb language plpgsql as $$
declare
  v_user uuid := gold.require_actor(); v_id uuid := (p->>'id')::uuid; k gold.gs_sheet_keys; x gold.gs_entries; v_access text; v_after boolean := false;
  v_amount numeric := 0; v_written timestamptz; v_date date; v_today date; v_max int := greatest(coalesce((gold.setting('offline.maxDays'))::int, 7), 1);
  v_kind text; v_person uuid := nullif(p->>'personId', '')::uuid; v_qty numeric; v_sheet_name text; r record; v_note text := gold.gs_note(p);
begin
  if v_id is null then perform gold.fail(422, 'VALIDATION_FAILED', 'The entry needs an id.'); end if;
  select * into x from gold.gs_entries where id = v_id;
  if found then
    if x.written_by <> v_user then perform gold.fail(409, 'ID_IN_USE', 'That entry id is already used.'); end if;
    return gold.gs_entry_json(x);
  end if;
  -- matched through the ids-only index, so an entry written before its writer lost access can still be recognised
  select * into k from gold.gs_sheet_keys where sheet_id = (p->>'sheetId')::uuid;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That sheet was not found.'); end if;
  v_kind := k.kind;
  if nullif(p->>'amount', '') is not null then
    if p->>'direction' not in ('in', 'out') then perform gold.fail(422, 'VALIDATION_FAILED', 'Say whether the money was added or taken out.'); end if;
    v_amount := gold.gs_amount(p, 'amount') * case when p->>'direction' = 'out' then -1 else 1 end;
  end if;
  if nullif(p->>'quantity', '') is not null then
    if v_kind <> 'quantity' then perform gold.fail(422, 'VALIDATION_FAILED', 'This sheet does not keep a quantity.'); end if;
    if p->>'quantity' !~ '^\d{1,12}(\.\d{1,3})?$' or (p->>'quantity')::numeric <= 0 then perform gold.fail(422, 'VALIDATION_FAILED', 'Type the quantity, like 0.5.'); end if;
    if p->>'qtyDirection' not in ('in', 'out') then perform gold.fail(422, 'VALIDATION_FAILED', 'Say whether the quantity came in or went out.'); end if;
    v_qty := (p->>'quantity')::numeric * case when p->>'qtyDirection' = 'out' then -1 else 1 end;
  end if;
  if v_amount = 0 and v_qty is null then
    perform gold.fail(422, 'VALIDATION_FAILED', case when v_kind = 'quantity' then 'Type an amount, a quantity, or both.' else 'Type an amount in cedis, like 150 or 12.50.' end);
  end if;
  if v_kind = 'people' then
    if v_person is null then perform gold.fail(422, 'VALIDATION_FAILED', 'Choose whose savings this is.'); end if;
    if not exists (select 1 from gold.gs_people pp where pp.id = v_person and pp.sheet_id = k.sheet_id) then perform gold.fail(422, 'VALIDATION_FAILED', 'That person is not on this sheet.'); end if;
  else
    v_person := null;
  end if;
  v_written := least(coalesce(nullif(p->>'writtenAt', '')::timestamptz, now()), now());
  v_today := gold.gs_today(k.branch_id);
  v_date := coalesce(nullif(p->>'moneyDate', '')::date, (v_written at time zone 'Africa/Accra')::date);
  if v_date > v_today + 1 then perform gold.fail(422, 'VALIDATION_FAILED', 'The date cannot be in the future.'); end if;
  if v_date < date '2000-01-01' then perform gold.fail(422, 'VALIDATION_FAILED', 'That date is too far back.'); end if;
  v_access := gold.gs_access(k.group_id, k.sheet_id, v_user);
  if v_access <> 'write' or (k.closed_at is not null and k.closed_at <= v_written) then
    -- written on a device before the right to write ended, and sent later (decision 3): accepted and marked
    if v_written < now() - make_interval(days => v_max) or not exists (
         select 1 from gold.gs_access_ends a where a.group_id = k.group_id and a.at > v_written and (a.user_id = v_user or a.user_id is null)) then
      perform gold.fail(403, 'FORBIDDEN', case when k.closed_at is not null then 'This sheet is closed. It takes no new entries.' else 'You can only look at this sheet.' end);
    end if;
    v_after := true;
  end if;
  -- no RETURNING: a writer who has lost access may add the row but not read it back
  begin
    insert into gold.gs_entries (id, tenant_id, group_id, sheet_id, amount, money_date, note, day_total, written_by, written_at, after_removal, person_id, quantity)
    values (v_id, gold.current_tenant(), k.group_id, k.sheet_id, v_amount, v_date, v_note, coalesce((p->>'dayTotal')::boolean, false) and v_amount > 0,
            v_user, v_written, v_after, v_person, v_qty);
  exception when unique_violation then
    return jsonb_build_object('id', v_id, 'sheetId', k.sheet_id, 'alreadyReceived', true);
  end;
  if v_after then perform gold.gs_log(k.group_id, 'entry_after_removal', v_user, jsonb_build_object('sheetId', k.sheet_id, 'amount', gold.ts(v_amount), 'writtenAt', gold.iso(v_written))); end if;
  -- alerts on money taken out: to those who asked and can still see the sheet, never to the writer
  if v_amount < 0 then
    select s3.name into v_sheet_name from gold.gs_sheets s3 where s3.id = k.sheet_id;
    for r in select a.user_id from gold.gs_alerts a where a.sheet_id = k.sheet_id and a.user_id <> v_user and -v_amount >= a.min_amount loop
      if gold.gs_access(k.group_id, k.sheet_id, r.user_id) <> 'none' then
        perform gold.notify_user(gold.current_tenant(), r.user_id, 'group_taken_out',
          format('%s took GHS %s out of %s', (select display_name from gold.users where id = v_user), to_char(-v_amount, 'FM999,999,999,990.00'),
                 coalesce(v_sheet_name, (select s4.name from gold.gs_sheets s4 where s4.id = k.sheet_id), 'a sheet')),
          v_note, '/group-sheets/sheets/' || k.sheet_id);
      end if;
    end loop;
  end if;
  return jsonb_build_object('id', v_id, 'sheetId', k.sheet_id, 'amount', gold.ts(v_amount), 'quantity', gold.ts(v_qty), 'personId', v_person, 'moneyDate', v_date,
    'note', v_note, 'dayTotal', coalesce((p->>'dayTotal')::boolean, false) and v_amount > 0, 'writtenAt', gold.iso(v_written), 'afterRemoval', v_after);
end $$;

-- taking back now also reverses the quantity and keeps the person
create or replace function gold.gs_entry_take_back(p jsonb) returns jsonb language plpgsql as $$
declare v_user uuid := gold.require_actor(); x gold.gs_entries; t gold.gs_entries; v_access text; v_id uuid := coalesce((p->>'id')::uuid, gen_random_uuid()); v_sheet text;
begin
  select * into t from gold.gs_entries where id = v_id;
  if found then return gold.gs_entry_json(t); end if;
  select * into x from gold.gs_entries where id = (p->>'entryId')::uuid;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That entry was not found.'); end if;
  v_access := gold.gs_access(x.group_id, x.sheet_id, v_user);
  if v_access <> 'write' then perform gold.fail(403, 'FORBIDDEN', 'You can only look at this sheet.'); end if;
  if x.written_by <> v_user and gold.gs_role_of(x.group_id, v_user) <> 'keeper' then perform gold.fail(403, 'FORBIDDEN', 'You can take back your own entries. A keeper can take back anyone''s.'); end if;
  if x.takes_back is not null then perform gold.fail(422, 'VALIDATION_FAILED', 'This line already takes back another entry.'); end if;
  if exists (select 1 from gold.gs_entries where takes_back = x.id) then perform gold.fail(409, 'ALREADY_TAKEN_BACK', 'This entry was already taken back.'); end if;
  if exists (select 1 from gold.gs_sheets where id = x.sheet_id and closed_at is not null) then perform gold.fail(422, 'SHEET_CLOSED', 'This sheet is closed. Reopen it first.'); end if;
  insert into gold.gs_entries (id, tenant_id, group_id, sheet_id, amount, money_date, note, takes_back, written_by, written_at, person_id, quantity)
  values (v_id, gold.current_tenant(), x.group_id, x.sheet_id, -x.amount, x.money_date, 'Taken back', x.id, v_user, now(), x.person_id, -x.quantity);
  select name into v_sheet from gold.gs_sheets where id = x.sheet_id;
  perform gold.gs_log(x.group_id, 'entry_taken_back', x.written_by, jsonb_build_object('sheet', v_sheet, 'amount', gold.ts(x.amount), 'quantity', gold.ts(x.quantity), 'moneyDate', x.money_date, 'note', x.note));
  return gold.gs_entry_json(x);
end $$;

-- tell me when money is taken out of this sheet. p: { sheetId, on: boolean, minAmount? }
create function gold.gs_alert_set(p jsonb) returns jsonb language plpgsql as $$
declare s gold.gs_sheets; v_min numeric := 0;
begin
  perform gold.require_actor();
  select * into s from gold.gs_sheets where id = (p->>'sheetId')::uuid;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That sheet was not found.'); end if;
  if nullif(p->>'minAmount', '') is not null then
    if p->>'minAmount' !~ '^\d{1,12}(\.\d{1,2})?$' then perform gold.fail(422, 'VALIDATION_FAILED', 'Type the amount in cedis, like 500, or leave it empty for any amount.'); end if;
    v_min := (p->>'minAmount')::numeric;
  end if;
  delete from gold.gs_alerts where sheet_id = s.id and user_id = gold.current_actor();
  if coalesce((p->>'on')::boolean, false) then
    insert into gold.gs_alerts (tenant_id, group_id, sheet_id, user_id, min_amount) values (gold.current_tenant(), s.group_id, s.id, gold.current_actor(), v_min);
  end if;
  return gold.gs_sheet_json(s);
end $$;

-- ---------------------------------------------------------------- receipt photos
-- the facts of a photo whose bytes the API is writing. p: { id, entryId, storageKey, thumbKey?, size, sha256, width?, height?, takenAt? }
create function gold.gs_photo_add(p jsonb) returns jsonb language plpgsql as $$
declare v_user uuid := gold.require_actor(); v_id uuid := (p->>'id')::uuid; x gold.gs_entries; ph gold.gs_photos; v_access text;
begin
  if v_id is null then perform gold.fail(422, 'VALIDATION_FAILED', 'The photo needs an id.'); end if;
  select * into ph from gold.gs_photos where id = v_id;
  if found then
    if ph.uploaded_by <> v_user then perform gold.fail(409, 'ID_IN_USE', 'That photo id is already used.'); end if;
    return jsonb_build_object('replayed', true, 'data', jsonb_build_object('id', ph.id, 'entryId', ph.entry_id));
  end if;
  select * into x from gold.gs_entries where id = (p->>'entryId')::uuid;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That entry was not found, or has not reached the server yet.'); end if;
  v_access := gold.gs_access(x.group_id, x.sheet_id, v_user);
  if not (v_access = 'write' or (x.written_by = v_user and v_access <> 'none')) then perform gold.fail(403, 'FORBIDDEN', 'You can only look at this sheet.'); end if;
  if (select count(*) from gold.gs_photos where entry_id = x.id and removed_at is null) >= 5 then perform gold.fail(422, 'TOO_MANY_PHOTOS', 'An entry can have up to 5 photos.'); end if;
  insert into gold.gs_photos (id, tenant_id, group_id, sheet_id, entry_id, storage_key, thumb_key, size_bytes, sha256, width, height, taken_at, uploaded_by)
  values (v_id, gold.current_tenant(), x.group_id, x.sheet_id, x.id, p->>'storageKey', nullif(p->>'thumbKey', ''), (p->>'size')::bigint, p->>'sha256',
          nullif(p->>'width', '')::int, nullif(p->>'height', '')::int, nullif(p->>'takenAt', '')::timestamptz, v_user);
  return jsonb_build_object('replayed', false, 'data', jsonb_build_object('id', v_id, 'entryId', x.id));
end $$;

-- the storage keys of a photo the caller may see (and that has not been taken off)
create function gold.gs_photo_open(p jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object('storageKey', ph.storage_key, 'thumbKey', ph.thumb_key, 'sha256', ph.sha256, 'fileName', ph.id::text || '.jpg')
  from gold.gs_photos ph where ph.id = (p->>'photoId')::uuid and ph.removed_at is null
$$;

-- take a photo off an entry: the person who added it, or a keeper. The group's log keeps that it happened. p: { photoId }
create function gold.gs_photo_remove(p jsonb) returns jsonb language plpgsql as $$
declare v_user uuid := gold.require_actor(); ph gold.gs_photos;
begin
  select * into ph from gold.gs_photos where id = (p->>'photoId')::uuid and removed_at is null;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That photo was not found.'); end if;
  if ph.uploaded_by <> v_user and gold.gs_role_of(ph.group_id, v_user) is distinct from 'keeper' then
    perform gold.fail(403, 'FORBIDDEN', 'Only the person who added a photo, or a keeper, can take it off.');
  end if;
  update gold.gs_photos set removed_at = now(), removed_by = v_user where id = ph.id;
  perform gold.gs_log(ph.group_id, 'photo_removed', ph.uploaded_by, jsonb_build_object('sheet', (select name from gold.gs_sheets where id = ph.sheet_id)));
  return jsonb_build_object('id', ph.id, 'removed', true);
end $$;

-- ---------------------------------------------------------------- one door for the API (photo_add and photo_open are only called by the API itself)
create or replace function gold.group_sheets(p_action text, p jsonb) returns jsonb language plpgsql as $$
begin
  p := coalesce(p, '{}'::jsonb);
  return case p_action
    when 'home' then gold.gs_home()
    when 'group_get' then gold.gs_group_get(p)
    when 'group_create' then gold.gs_group_create(p)
    when 'group_rename' then gold.gs_group_rename(p)
    when 'member_set' then gold.gs_member_set(p)
    when 'member_remove' then gold.gs_member_remove(p)
    when 'member_unexclude' then gold.gs_member_unexclude(p)
    when 'leave' then gold.gs_member_remove(p || jsonb_build_object('userId', gold.require_actor()))
    when 'rule_set' then gold.gs_rule_set(p)
    when 'rule_remove' then gold.gs_rule_remove(p)
    when 'name_keeper' then gold.gs_name_keeper(p)
    when 'sheet_create' then gold.gs_sheet_create(p)
    when 'sheet_update' then gold.gs_sheet_update(p)
    when 'sheet_delete' then gold.gs_sheet_delete(p)
    when 'access_set' then gold.gs_access_set(p)
    when 'sheet_get' then gold.gs_sheet_get(p)
    when 'entry_add' then gold.gs_entry_add(p)
    when 'entry_take_back' then gold.gs_entry_take_back(p)
    when 'activity' then gold.gs_activity(p)
    when 'person_add' then gold.gs_person_add(p)
    when 'person_rename' then gold.gs_person_rename(p)
    when 'alert_set' then gold.gs_alert_set(p)
    when 'photo_add' then gold.gs_photo_add(p)
    when 'photo_open' then gold.gs_photo_open(p)
    when 'photo_remove' then gold.gs_photo_remove(p)
    else null
  end;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
  perform gold.fail(422, 'VALIDATION_FAILED', 'Something in the request is not in the right form (an id, a date or a number).');
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant select, insert, update on gold.gs_people, gold.gs_photos to gold_app;
    revoke delete, truncate on gold.gs_people, gold.gs_photos from gold_app;
    grant select, insert, update, delete on gold.gs_alerts to gold_app;
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;