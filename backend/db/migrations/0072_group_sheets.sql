-- 0072 (B74): Group Sheets, private running records for a chosen group (docs/group-sheets-design.md).
--   * A group is a set of people: handpicked by name, and/or "everyone who works at branch X" (from their branch assignments, never from
--     branches:all). Roles: keeper (runs the group), writer (adds entries), reader (looks). Keepers are always handpicked.
--   * A sheet is a running balance in cedis. Entries only ever add to the record: + Add or - Take out with a short note. A mistake is put
--     right by "taking back", a linked opposite entry. Nothing is edited or deleted (there is no update or delete policy on entries).
--   * Per sheet, a keeper can narrow what a member (or everyone) may do: write, see only, or not see. Narrowing never widens a role.
--   * NO company role opens a group: not director, not admin. Row-level security on groups, sheets, entries and the group log checks
--     membership only. The single exception: a group whose last keeper has gone (account switched off) is shown to people with
--     users:manage, by name and remaining members only, so one of them can be named keeper. Its sheets stay closed to them.
--   * The membership tables themselves are company-wide under row-level security (a membership policy on them would refer to itself);
--     they hold only ids and roles, and only the checked functions below read them.
--   * Entries written offline by someone removed before they were sent are accepted and marked "sent after removal" (decision 3).
--   * New permission groups:create (directors and managers). Creating a group makes you its first keeper; it opens no other group.

insert into gold.role_permissions (tenant_id, role_id, permission)
select r.tenant_id, r.id, 'groups:create' from gold.roles r where r.key in ('manager', 'director') and r.is_system
on conflict do nothing;

create table gold.gs_groups (
  id         uuid primary key,
  tenant_id  uuid not null references gold.tenants (id),
  name       text not null,
  created_by uuid not null references gold.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- handpicked members (role set), and people left out of a branch rule (role null, excluded)
create table gold.gs_members (
  tenant_id  uuid not null references gold.tenants (id),
  group_id   uuid not null references gold.gs_groups (id) on delete cascade,
  user_id    uuid not null references gold.users (id),
  role       text check (role in ('keeper', 'writer', 'reader')),
  excluded   boolean not null default false,
  added_by   uuid references gold.users (id),
  created_at timestamptz not null default now(),
  primary key (group_id, user_id),
  check ((role is not null and not excluded) or (role is null and excluded))
);
create index gs_members_user on gold.gs_members (tenant_id, user_id);

create table gold.gs_branch_rules (
  tenant_id  uuid not null references gold.tenants (id),
  group_id   uuid not null references gold.gs_groups (id) on delete cascade,
  branch_id  uuid not null references gold.branches (id),
  role       text not null check (role in ('writer', 'reader')),
  created_at timestamptz not null default now(),
  primary key (group_id, branch_id)
);
create index gs_rules_branch on gold.gs_branch_rules (tenant_id, branch_id);

create table gold.gs_sheets (
  id              uuid primary key,
  tenant_id       uuid not null references gold.tenants (id),
  group_id        uuid not null references gold.gs_groups (id) on delete cascade,
  name            text not null,
  branch_id       uuid references gold.branches (id),
  opening_balance numeric(18,2) not null default 0,
  opening_date    date,
  closed_at       timestamptz,
  closed_by       uuid references gold.users (id),
  created_by      uuid not null references gold.users (id),
  created_at      timestamptz not null default now()
);
create index gs_sheets_group on gold.gs_sheets (tenant_id, group_id);

-- which group each sheet belongs to, its branch and whether it is closed: ids only (no name, no figures), readable company-wide, so an
-- entry written offline before its writer lost access can still be matched to its group. Kept in step with gs_sheets by a trigger.
create table gold.gs_sheet_keys (
  sheet_id  uuid primary key references gold.gs_sheets (id) on delete cascade,
  tenant_id uuid not null references gold.tenants (id),
  group_id  uuid not null references gold.gs_groups (id) on delete cascade,
  branch_id uuid,
  closed_at timestamptz
);
create function gold.trg_gs_sheet_keys() returns trigger language plpgsql as $$
begin
  insert into gold.gs_sheet_keys (sheet_id, tenant_id, group_id, branch_id, closed_at) values (new.id, new.tenant_id, new.group_id, new.branch_id, new.closed_at)
  on conflict (sheet_id) do update set branch_id = excluded.branch_id, closed_at = excluded.closed_at;
  return null;
end $$;
create trigger gs_sheet_keys after insert or update on gold.gs_sheets for each row execute function gold.trg_gs_sheet_keys();

-- narrowing per sheet: for one person (user_id) or for everyone (user_id null). No row = the member's role decides.
create table gold.gs_sheet_access (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references gold.tenants (id),
  group_id  uuid not null references gold.gs_groups (id) on delete cascade,
  sheet_id  uuid not null references gold.gs_sheets (id) on delete cascade,
  user_id   uuid references gold.users (id),
  access    text not null check (access in ('write', 'read', 'none'))
);
create unique index gs_access_one on gold.gs_sheet_access (sheet_id, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table gold.gs_entries (
  id            uuid primary key,                       -- made by the device, so an entry sent twice is kept once
  tenant_id     uuid not null references gold.tenants (id),
  group_id      uuid not null references gold.gs_groups (id) on delete cascade,
  sheet_id      uuid not null references gold.gs_sheets (id) on delete cascade,
  amount        numeric(18,2) not null check (amount <> 0),   -- + added, - taken out
  money_date    date not null,
  note          text,
  day_total     boolean not null default false,
  takes_back    uuid unique references gold.gs_entries (id),
  written_by    uuid not null references gold.users (id),
  written_at    timestamptz not null,                   -- when it was written on the device
  received_at   timestamptz not null default now(),
  after_removal boolean not null default false
);
create index gs_entries_sheet on gold.gs_entries (sheet_id, money_date, written_at);

create table gold.gs_events (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references gold.tenants (id),
  group_id  uuid not null references gold.gs_groups (id) on delete cascade,
  kind      text not null,
  actor     uuid references gold.users (id),
  subject   uuid references gold.users (id),
  detail    jsonb not null default '{}',
  at        timestamptz not null default now()
);
create index gs_events_group on gold.gs_events (group_id, at desc);

-- when someone's right to write may have ended (removed, role changed, a branch rule changed, a sheet narrowed or closed): ids and times
-- only, readable company-wide, so an entry written on a device before that moment can be recognised after the person lost access.
create table gold.gs_access_ends (
  tenant_id uuid not null references gold.tenants (id),
  group_id  uuid not null references gold.gs_groups (id) on delete cascade,
  user_id   uuid references gold.users (id),        -- null: it may have ended for everyone
  at        timestamptz not null default now()
);
create index gs_access_ends_group on gold.gs_access_ends (group_id, at desc);

-- ---------------------------------------------------------------- who may do what
create function gold.gs_rank(p_role text) returns int language sql immutable as $$
  select case p_role when 'keeper' then 3 when 'writer' then 2 when 'reader' then 1 else 0 end
$$;

-- the role a person holds in a group now, or null: handpicked first, then the best branch rule; switched-off accounts hold none
create function gold.gs_role(p_group uuid, p_user uuid) returns text language sql stable as $$
  select case when u.id is null or not u.is_active then null
    else coalesce(
      (select case when m.excluded then 'none' else m.role end from gold.gs_members m where m.group_id = p_group and m.user_id = p_user),
      (select r.role from gold.gs_branch_rules r
         join gold.user_branches ub on ub.branch_id = r.branch_id and ub.user_id = p_user
         join gold.branches b on b.id = r.branch_id and b.is_active
        where r.group_id = p_group order by gold.gs_rank(r.role) desc limit 1))
  end
  from (select 1) one left join gold.users u on u.id = p_user
$$;

create function gold.gs_role_of(p_group uuid, p_user uuid) returns text language sql stable as $$
  select nullif(gold.gs_role(p_group, p_user), 'none')
$$;

-- write | read | none, on one sheet (the sheet's group is passed in, so this never reads gs_sheets: safe inside its policy)
create function gold.gs_access(p_group uuid, p_sheet uuid, p_user uuid) returns text language plpgsql stable as $$
declare r text := gold.gs_role_of(p_group, p_user); o text;
begin
  if r is null then return 'none'; end if;
  if r = 'keeper' then return 'write'; end if;
  select access into o from gold.gs_sheet_access where sheet_id = p_sheet and user_id = p_user;
  if o is null then select access into o from gold.gs_sheet_access where sheet_id = p_sheet and user_id is null; end if;
  if o = 'none' then return 'none'; end if;
  if o = 'read' or r = 'reader' then return 'read'; end if;
  return 'write';
end $$;

create function gold.gs_has_keeper(p_group uuid) returns boolean language sql stable as $$
  select exists (select 1 from gold.gs_members m join gold.users u on u.id = m.user_id
                 where m.group_id = p_group and m.role = 'keeper' and u.is_active)
$$;

create function gold.gs_can_manage_people() returns boolean language sql stable as $$
  select exists (select 1 from gold.effective_permissions(gold.current_actor()) p where p = 'users:manage')
$$;

-- everyone in a group now: { id, displayName, role, how: handpicked | branch }
create function gold.gs_members_json(p_group uuid) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'displayName', x.display_name, 'role', x.role, 'how', x.how)
                            order by gold.gs_rank(x.role) desc, x.display_name), '[]'::jsonb)
  from (
    select u.id, u.display_name, coalesce(m.role, br.role) as role, case when m.role is not null then 'handpicked' else 'branch' end as how
    from gold.users u
    left join gold.gs_members m on m.group_id = p_group and m.user_id = u.id
    left join lateral (select r.role from gold.gs_branch_rules r
                         join gold.user_branches ub on ub.branch_id = r.branch_id and ub.user_id = u.id
                         join gold.branches b on b.id = r.branch_id and b.is_active
                        where r.group_id = p_group order by gold.gs_rank(r.role) desc limit 1) br on true
    where u.tenant_id = gold.current_tenant() and u.is_active
      and (m.role is not null or (br.role is not null and not coalesce(m.excluded, false)))
  ) x
$$;

-- a group with no keeper left but people still in it: the one case shown to people with users:manage
create function gold.gs_needs_keeper(p_group uuid) returns boolean language sql stable as $$
  select not gold.gs_has_keeper(p_group) and jsonb_array_length(gold.gs_members_json(p_group)) > 0
$$;

-- ---------------------------------------------------------------- row-level security
alter table gold.gs_groups enable row level security;        alter table gold.gs_groups force row level security;
alter table gold.gs_members enable row level security;       alter table gold.gs_members force row level security;
alter table gold.gs_branch_rules enable row level security;  alter table gold.gs_branch_rules force row level security;
alter table gold.gs_sheets enable row level security;        alter table gold.gs_sheets force row level security;
alter table gold.gs_sheet_access enable row level security;  alter table gold.gs_sheet_access force row level security;
alter table gold.gs_sheet_keys enable row level security;    alter table gold.gs_sheet_keys force row level security;
alter table gold.gs_access_ends enable row level security;   alter table gold.gs_access_ends force row level security;
alter table gold.gs_entries enable row level security;       alter table gold.gs_entries force row level security;
alter table gold.gs_events enable row level security;        alter table gold.gs_events force row level security;

create policy members_read on gold.gs_groups for select
  using (tenant_id = gold.current_tenant() and (gold.gs_role_of(id, gold.current_actor()) is not null
         or (gold.gs_can_manage_people() and gold.gs_needs_keeper(id))));
create policy create_any on gold.gs_groups for insert with check (tenant_id = gold.current_tenant() and created_by = gold.current_actor());
create policy keepers_change on gold.gs_groups for update
  using (tenant_id = gold.current_tenant() and gold.gs_role_of(id, gold.current_actor()) = 'keeper');

create policy company on gold.gs_members using (tenant_id = gold.current_tenant()) with check (tenant_id = gold.current_tenant());
create policy company on gold.gs_branch_rules using (tenant_id = gold.current_tenant()) with check (tenant_id = gold.current_tenant());
create policy company on gold.gs_access_ends using (tenant_id = gold.current_tenant()) with check (tenant_id = gold.current_tenant());
create policy company on gold.gs_sheet_keys using (tenant_id = gold.current_tenant()) with check (tenant_id = gold.current_tenant());
create policy company on gold.gs_sheet_access using (tenant_id = gold.current_tenant()) with check (tenant_id = gold.current_tenant());

create policy can_see on gold.gs_sheets for select
  using (tenant_id = gold.current_tenant() and gold.gs_access(group_id, id, gold.current_actor()) <> 'none');
create policy keepers_add on gold.gs_sheets for insert
  with check (tenant_id = gold.current_tenant() and gold.gs_role_of(group_id, gold.current_actor()) = 'keeper');
create policy keepers_change on gold.gs_sheets for update
  using (tenant_id = gold.current_tenant() and gold.gs_role_of(group_id, gold.current_actor()) = 'keeper');
create policy keepers_delete on gold.gs_sheets for delete
  using (tenant_id = gold.current_tenant() and gold.gs_role_of(group_id, gold.current_actor()) = 'keeper');

-- entries: seen by who may see the sheet; added only in one's own name (the functions check the right to write); never changed
create policy can_see on gold.gs_entries for select
  using (tenant_id = gold.current_tenant() and gold.gs_access(group_id, sheet_id, gold.current_actor()) <> 'none');
create policy own_name on gold.gs_entries for insert with check (tenant_id = gold.current_tenant() and written_by = gold.current_actor());

create policy members_read on gold.gs_events for select
  using (tenant_id = gold.current_tenant() and gold.gs_role_of(group_id, gold.current_actor()) is not null);
create policy own_name on gold.gs_events for insert with check (tenant_id = gold.current_tenant() and actor is not distinct from gold.current_actor());

-- ---------------------------------------------------------------- helpers
create function gold.gs_log(p_group uuid, p_kind text, p_subject uuid, p_detail jsonb) returns void language plpgsql as $$
begin
  insert into gold.gs_events (tenant_id, group_id, kind, actor, subject, detail) values (gold.current_tenant(), p_group, p_kind, gold.current_actor(), p_subject, coalesce(p_detail, '{}'));
  if p_kind in ('member_removed', 'member_left', 'role_changed', 'access_changed', 'rule_removed', 'rule_changed', 'sheet_closed') then
    insert into gold.gs_access_ends (tenant_id, group_id, user_id)
    values (gold.current_tenant(), p_group, case when p_kind in ('rule_removed', 'rule_changed', 'sheet_closed') then null else p_subject end);
  end if;
end $$;

create function gold.gs_require_role(p_group uuid, p_min text) returns text language plpgsql stable as $$
declare r text := gold.gs_role_of(p_group, gold.require_actor());
begin
  if r is null or not exists (select 1 from gold.gs_groups where id = p_group) then perform gold.fail(404, 'NOT_FOUND', 'That group was not found.'); end if;
  if gold.gs_rank(r) < gold.gs_rank(p_min) then
    perform gold.fail(403, 'FORBIDDEN', case p_min when 'keeper' then 'Only a keeper of this group can do that.' else 'You can only look at this group.' end);
  end if;
  return r;
end $$;

create function gold.gs_today(p_branch uuid) returns date language sql stable as $$
  select (now() at time zone coalesce((select timezone from gold.branches where id = p_branch), 'Africa/Accra'))::date
$$;

create function gold.gs_amount(p jsonb, p_key text) returns numeric language plpgsql immutable as $$
declare v text := p->>p_key; n numeric;
begin
  if v is null or v !~ '^\d{1,12}(\.\d{1,2})?$' then perform gold.fail(422, 'VALIDATION_FAILED', 'Type an amount in cedis, like 150 or 12.50.'); end if;
  n := v::numeric;
  if n <= 0 then perform gold.fail(422, 'VALIDATION_FAILED', 'The amount must be more than zero.'); end if;
  return n;
end $$;

create function gold.gs_note(p jsonb) returns text language sql immutable as $$
  select left(nullif(btrim(regexp_replace(coalesce(p->>'note', ''), '\s+', ' ', 'g')), ''), 140)
$$;

create function gold.gs_name(p jsonb, p_what text) returns text language plpgsql immutable as $$
declare v text := left(btrim(regexp_replace(coalesce(p->>'name', ''), '\s+', ' ', 'g')), 80);
begin
  if v = '' then perform gold.fail(422, 'VALIDATION_FAILED', format('Give the %s a name.', p_what)); end if;
  return v;
end $$;

-- an entry counts in the day's "in" and "out" unless it is a taking back or was taken back (the pair nets to zero; the balance is the same)
create function gold.gs_counted(e gold.gs_entries) returns boolean language sql stable as $$
  select e.takes_back is null and not exists (select 1 from gold.gs_entries t where t.takes_back = e.id)
$$;

create function gold.gs_sheet_totals(s gold.gs_sheets) returns jsonb language sql stable as $$
  with t as (select gold.gs_today(s.branch_id) as d),
  e as (select x.amount, x.money_date, gold.gs_counted(x) as counted from gold.gs_entries x where x.sheet_id = s.id)
  select jsonb_build_object(
    'balance', gold.ts(s.opening_balance + coalesce((select sum(amount) from e), 0)),
    'todayIn', gold.ts(coalesce((select sum(amount) from e, t where e.money_date = t.d and amount > 0 and counted), 0)),
    'todayOut', gold.ts(coalesce((select -sum(amount) from e, t where e.money_date = t.d and amount < 0 and counted), 0)),
    'entries', (select count(*) from e))
$$;

create function gold.gs_entry_json(x gold.gs_entries) returns jsonb language sql stable as $$
  select jsonb_build_object('id', x.id, 'sheetId', x.sheet_id, 'amount', gold.ts(x.amount), 'moneyDate', x.money_date, 'note', x.note, 'dayTotal', x.day_total,
    'takesBack', x.takes_back, 'writtenBy', gold.person_json(x.written_by), 'writtenAt', gold.iso(x.written_at), 'receivedAt', gold.iso(x.received_at),
    'afterRemoval', x.after_removal, 'mine', x.written_by = gold.current_actor(),
    'takenBack', (select jsonb_build_object('by', gold.person_json(t.written_by), 'at', gold.iso(t.written_at), 'id', t.id) from gold.gs_entries t where t.takes_back = x.id))
$$;

create function gold.gs_sheet_json(s gold.gs_sheets) returns jsonb language sql stable as $$
  select jsonb_build_object('id', s.id, 'groupId', s.group_id, 'name', s.name, 'branchId', s.branch_id,
    'branchName', (select name from gold.branches where id = s.branch_id),
    'openingBalance', gold.ts(s.opening_balance), 'openingDate', s.opening_date, 'closed', s.closed_at is not null, 'closedAt', gold.iso(s.closed_at),
    'access', gold.gs_access(s.group_id, s.id, gold.current_actor()), 'createdAt', gold.iso(s.created_at),
    -- the last real entry: a taking back and the line it cancels are left out
    'last', (select gold.gs_entry_json(e) from gold.gs_entries e where e.sheet_id = s.id and e.takes_back is null
               and not exists (select 1 from gold.gs_entries t where t.takes_back = e.id) order by e.written_at desc, e.received_at desc limit 1))
    || gold.gs_sheet_totals(s)
$$;

-- ---------------------------------------------------------------- reading
create function gold.gs_home() returns jsonb language plpgsql stable as $$
declare v_user uuid := gold.require_actor();
begin
  return jsonb_build_object(
    'canCreate', exists (select 1 from gold.effective_permissions(v_user) p where p = 'groups:create'),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'myRole', gold.gs_role_of(g.id, v_user),
               'sheets', coalesce((select jsonb_agg(gold.gs_sheet_json(s) order by s.closed_at is not null, s.name) from gold.gs_sheets s where s.group_id = g.id), '[]'::jsonb))
             order by g.name)
      from gold.gs_groups g where gold.gs_role_of(g.id, v_user) is not null), '[]'::jsonb),
    'needKeeper', case when gold.gs_can_manage_people() then coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'members', gold.gs_members_json(g.id)) order by g.name)
      from gold.gs_groups g where gold.gs_role_of(g.id, v_user) is null and gold.gs_needs_keeper(g.id)), '[]'::jsonb) else '[]'::jsonb end);
end $$;

create function gold.gs_group_get(p jsonb) returns jsonb language plpgsql stable as $$
declare v_group uuid := (p->>'groupId')::uuid; r text := gold.gs_require_role(v_group, 'reader'); g gold.gs_groups;
begin
  select * into g from gold.gs_groups where id = v_group;
  return jsonb_build_object('id', g.id, 'name', g.name, 'myRole', r, 'createdAt', gold.iso(g.created_at),
    'members', gold.gs_members_json(g.id),
    'keepers', (select count(*) from gold.gs_members m join gold.users u on u.id = m.user_id where m.group_id = g.id and m.role = 'keeper' and u.is_active),
    'rules', coalesce((select jsonb_agg(jsonb_build_object('branchId', b.id, 'branchName', b.name, 'role', x.role) order by b.name)
                        from gold.gs_branch_rules x join gold.branches b on b.id = x.branch_id where x.group_id = g.id), '[]'::jsonb),
    'leftOut', case when r = 'keeper' then coalesce((select jsonb_agg(gold.person_json(m.user_id)) from gold.gs_members m where m.group_id = g.id and m.excluded), '[]'::jsonb) else '[]'::jsonb end,
    'sheets', coalesce((select jsonb_agg(gold.gs_sheet_json(s) order by s.closed_at is not null, s.name) from gold.gs_sheets s where s.group_id = g.id), '[]'::jsonb),
    'access', case when r = 'keeper' then coalesce((select jsonb_agg(jsonb_build_object('sheetId', a.sheet_id, 'userId', a.user_id, 'access', a.access))
                                                    from gold.gs_sheet_access a where a.group_id = g.id), '[]'::jsonb) else '[]'::jsonb end);
end $$;

-- one sheet: totals, and its entries day by day for a period (default the last 31 days). p: { sheetId, from?, to? }
create function gold.gs_sheet_get(p jsonb) returns jsonb language plpgsql stable as $$
declare
  s gold.gs_sheets; v_today date; v_from date; v_to date; v_before numeric;
begin
  perform gold.require_actor();
  select * into s from gold.gs_sheets where id = (p->>'sheetId')::uuid;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That sheet was not found.'); end if;
  v_today := gold.gs_today(s.branch_id);
  v_to := least(coalesce(nullif(p->>'to', '')::date, v_today + 1), v_today + 1);
  v_from := greatest(coalesce(nullif(p->>'from', '')::date, v_today - 30), v_to - 3660);
  v_before := s.opening_balance + coalesce((select sum(amount) from gold.gs_entries where sheet_id = s.id and money_date < v_from), 0);
  return gold.gs_sheet_json(s) || jsonb_build_object(
    'groupName', (select name from gold.gs_groups where id = s.group_id),
    'myRole', gold.gs_role_of(s.group_id, gold.current_actor()),
    'today', v_today, 'from', v_from, 'to', v_to, 'balanceBefore', gold.ts(v_before),
    'olderEntries', exists (select 1 from gold.gs_entries where sheet_id = s.id and money_date < v_from),
    'week', jsonb_build_object(
      'in', gold.ts(coalesce((select sum(amount) from gold.gs_entries x where x.sheet_id = s.id and x.amount > 0 and gold.gs_counted(x) and x.money_date > v_today - 7 and x.money_date <= v_today), 0)),
      'out', gold.ts(coalesce((select -sum(amount) from gold.gs_entries x where x.sheet_id = s.id and x.amount < 0 and gold.gs_counted(x) and x.money_date > v_today - 7 and money_date <= v_today), 0))),
    'month', jsonb_build_object(
      'in', gold.ts(coalesce((select sum(amount) from gold.gs_entries x where x.sheet_id = s.id and x.amount > 0 and gold.gs_counted(x) and x.money_date >= date_trunc('month', v_today)::date and x.money_date <= v_today), 0)),
      'out', gold.ts(coalesce((select -sum(amount) from gold.gs_entries x where x.sheet_id = s.id and x.amount < 0 and gold.gs_counted(x) and x.money_date >= date_trunc('month', v_today)::date and money_date <= v_today), 0))),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('date', d.money_date, 'in', gold.ts(d.inn), 'out', gold.ts(d.outt), 'closing', gold.ts(v_before + d.running), 'entries', d.entries)
                       order by d.money_date desc)
      from (
        select money_date, inn, outt, sum(net) over (order by money_date) as running, entries
        from (select e.money_date,
                     coalesce(sum(e.amount) filter (where e.amount > 0 and gold.gs_counted(e)), 0) as inn,
                     coalesce(-sum(e.amount) filter (where e.amount < 0 and gold.gs_counted(e)), 0) as outt,
                     sum(e.amount) as net,
                     jsonb_agg(gold.gs_entry_json(e) order by e.written_at desc, e.received_at desc) as entries
              from gold.gs_entries e where e.sheet_id = s.id and e.money_date >= v_from and e.money_date <= v_to
              group by e.money_date) z
      ) d), '[]'::jsonb));
end $$;

create function gold.gs_activity(p jsonb) returns jsonb language plpgsql stable as $$
declare v_group uuid := (p->>'groupId')::uuid;
begin
  perform gold.gs_require_role(v_group, 'reader');
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'at', gold.iso(e.at), 'actor', gold.person_json(e.actor), 'subject', gold.person_json(e.subject), 'detail', e.detail) order by e.at desc)
                   from (select * from gold.gs_events where group_id = v_group and (p->>'before' is null or at < (p->>'before')::timestamptz) order by at desc limit 100) e), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- groups and people
create function gold.gs_group_create(p jsonb) returns jsonb language plpgsql as $$
declare v_user uuid := gold.require_actor(); v_id uuid := coalesce((p->>'id')::uuid, gen_random_uuid()); v_name text := gold.gs_name(p, 'group');
begin
  if not exists (select 1 from gold.effective_permissions(v_user) x where x = 'groups:create') then
    perform gold.fail(403, 'FORBIDDEN', 'You may not create groups. Ask a director.');
  end if;
  if exists (select 1 from gold.gs_members where group_id = v_id and user_id = v_user) then return gold.gs_group_get(jsonb_build_object('groupId', v_id)); end if;
  insert into gold.gs_groups (id, tenant_id, name, created_by) values (v_id, gold.current_tenant(), v_name, v_user);
  insert into gold.gs_members (tenant_id, group_id, user_id, role, added_by) values (gold.current_tenant(), v_id, v_user, 'keeper', v_user);
  perform gold.gs_log(v_id, 'group_created', null, jsonb_build_object('name', v_name));
  return gold.gs_group_get(jsonb_build_object('groupId', v_id));
end $$;

create function gold.gs_group_rename(p jsonb) returns jsonb language plpgsql as $$
declare v_group uuid := (p->>'groupId')::uuid; v_name text := gold.gs_name(p, 'group'); v_old text;
begin
  perform gold.gs_require_role(v_group, 'keeper');
  select name into v_old from gold.gs_groups where id = v_group;
  if v_old is distinct from v_name then
    update gold.gs_groups set name = v_name, updated_at = now() where id = v_group;
    perform gold.gs_log(v_group, 'group_renamed', null, jsonb_build_object('from', v_old, 'to', v_name));
  end if;
  return gold.gs_group_get(p);
end $$;

-- refuses a change that would leave the group with no keeper
create function gold.gs_keep_a_keeper(p_group uuid, p_user uuid) returns void language plpgsql as $$
begin
  if exists (select 1 from gold.gs_members where group_id = p_group and user_id = p_user and role = 'keeper')
     and (select count(*) from gold.gs_members m join gold.users u on u.id = m.user_id where m.group_id = p_group and m.role = 'keeper' and u.is_active and m.user_id <> p_user) = 0 then
    perform gold.fail(422, 'LAST_KEEPER', 'A group needs at least one keeper. Make someone else a keeper first.');
  end if;
end $$;

-- add a person by name, or change their role. p: { groupId, userId, role }
create function gold.gs_member_set(p jsonb) returns jsonb language plpgsql as $$
declare
  v_group uuid := (p->>'groupId')::uuid; v_target uuid := (p->>'userId')::uuid; v_role text := p->>'role'; v_was text; v_gname text;
begin
  perform gold.gs_require_role(v_group, 'keeper');
  if v_role is null or v_role not in ('keeper', 'writer', 'reader') then perform gold.fail(422, 'VALIDATION_FAILED', 'Choose keeper, writer or reader.'); end if;
  if not exists (select 1 from gold.users where id = v_target and is_active) then perform gold.fail(404, 'NOT_FOUND', 'That person was not found.'); end if;
  v_was := gold.gs_role_of(v_group, v_target);
  if v_was is not distinct from v_role and exists (select 1 from gold.gs_members where group_id = v_group and user_id = v_target and role = v_role) then return gold.gs_group_get(p); end if;
  if v_role <> 'keeper' then perform gold.gs_keep_a_keeper(v_group, v_target); end if;
  insert into gold.gs_members (tenant_id, group_id, user_id, role, excluded, added_by) values (gold.current_tenant(), v_group, v_target, v_role, false, gold.current_actor())
  on conflict (group_id, user_id) do update set role = excluded.role, excluded = false, added_by = excluded.added_by;
  select name into v_gname from gold.gs_groups where id = v_group;
  if v_was is null then
    perform gold.gs_log(v_group, 'member_added', v_target, jsonb_build_object('role', v_role));
    perform gold.notify_user(gold.current_tenant(), v_target, 'group_added', format('%s added you to %s, as a %s', (select display_name from gold.users where id = gold.current_actor()), v_gname, v_role), null, '/group-sheets');
  else
    perform gold.gs_log(v_group, 'role_changed', v_target, jsonb_build_object('from', v_was, 'to', v_role));
    perform gold.notify_user(gold.current_tenant(), v_target, 'group_role', format('You are now a %s in %s', v_role, v_gname), null, '/group-sheets');
  end if;
  return gold.gs_group_get(p);
end $$;

-- take a person out: a handpicked member is removed; someone in through a branch rule is left out of it. p: { groupId, userId }
create function gold.gs_member_remove(p jsonb) returns jsonb language plpgsql as $$
declare v_group uuid := (p->>'groupId')::uuid; v_target uuid := (p->>'userId')::uuid; v_self boolean := v_target = gold.current_actor(); v_gname text;
begin
  perform gold.gs_require_role(v_group, case when v_self then 'reader' else 'keeper' end);
  if gold.gs_role_of(v_group, v_target) is null then return case when v_self then '{}'::jsonb else gold.gs_group_get(p) end; end if;
  perform gold.gs_keep_a_keeper(v_group, v_target);
  insert into gold.gs_members (tenant_id, group_id, user_id, role, excluded, added_by) values (gold.current_tenant(), v_group, v_target, null, true, gold.current_actor())
  on conflict (group_id, user_id) do update set role = null, excluded = true, added_by = excluded.added_by;
  -- a left-out row is only needed while a branch rule would bring them in
  if gold.gs_role(v_group, v_target) = 'none' and not exists (
       select 1 from gold.gs_branch_rules r join gold.user_branches ub on ub.branch_id = r.branch_id and ub.user_id = v_target where r.group_id = v_group) then
    delete from gold.gs_members where group_id = v_group and user_id = v_target;
  end if;
  select name into v_gname from gold.gs_groups where id = v_group;
  if v_self then
    perform gold.gs_log(v_group, 'member_left', v_target, '{}');
    return '{}'::jsonb;
  end if;
  perform gold.gs_log(v_group, 'member_removed', v_target, '{}');
  perform gold.notify_user(gold.current_tenant(), v_target, 'group_removed', format('You are no longer in %s', v_gname), null, '/group-sheets');
  return gold.gs_group_get(p);
end $$;

-- let a left-out person back in through the branch rule. p: { groupId, userId }
create function gold.gs_member_unexclude(p jsonb) returns jsonb language plpgsql as $$
declare v_group uuid := (p->>'groupId')::uuid; v_target uuid := (p->>'userId')::uuid;
begin
  perform gold.gs_require_role(v_group, 'keeper');
  delete from gold.gs_members where group_id = v_group and user_id = v_target and excluded;
  if found then perform gold.gs_log(v_group, 'member_back', v_target, jsonb_build_object('role', gold.gs_role_of(v_group, v_target))); end if;
  return gold.gs_group_get(p);
end $$;

-- everyone who works at a branch, as writers or readers. p: { groupId, branchId, role }
create function gold.gs_rule_set(p jsonb) returns jsonb language plpgsql as $$
declare v_group uuid := (p->>'groupId')::uuid; v_branch uuid := (p->>'branchId')::uuid; v_role text := p->>'role'; v_was text; v_bname text;
begin
  perform gold.gs_require_role(v_group, 'keeper');
  if v_role is null or v_role not in ('writer', 'reader') then perform gold.fail(422, 'VALIDATION_FAILED', 'Everyone at a branch can be writers or readers. Keepers are chosen by name.'); end if;
  select name into v_bname from gold.branches where id = v_branch and is_active;
  if v_bname is null then perform gold.fail(404, 'NOT_FOUND', 'That branch was not found.'); end if;
  select role into v_was from gold.gs_branch_rules where group_id = v_group and branch_id = v_branch;
  if v_was is not distinct from v_role then return gold.gs_group_get(p); end if;
  insert into gold.gs_branch_rules (tenant_id, group_id, branch_id, role) values (gold.current_tenant(), v_group, v_branch, v_role)
  on conflict (group_id, branch_id) do update set role = excluded.role;
  perform gold.gs_log(v_group, case when v_was is null then 'rule_added' else 'rule_changed' end, null, jsonb_build_object('branch', v_bname, 'role', v_role, 'from', v_was));
  return gold.gs_group_get(p);
end $$;

create function gold.gs_rule_remove(p jsonb) returns jsonb language plpgsql as $$
declare v_group uuid := (p->>'groupId')::uuid; v_branch uuid := (p->>'branchId')::uuid;
begin
  perform gold.gs_require_role(v_group, 'keeper');
  delete from gold.gs_branch_rules where group_id = v_group and branch_id = v_branch;
  if found then perform gold.gs_log(v_group, 'rule_removed', null, jsonb_build_object('branch', (select name from gold.branches where id = v_branch))); end if;
  return gold.gs_group_get(p);
end $$;

-- a group whose last keeper has gone: someone with users:manage names a keeper from the people still in it. p: { groupId, userId }
create function gold.gs_name_keeper(p jsonb) returns jsonb language plpgsql as $$
declare v_group uuid := (p->>'groupId')::uuid; v_target uuid := (p->>'userId')::uuid;
begin
  perform gold.require_actor();
  if not gold.gs_can_manage_people() then perform gold.fail(403, 'FORBIDDEN', 'Only someone who manages people can name a keeper.'); end if;
  if not exists (select 1 from gold.gs_groups where id = v_group) then perform gold.fail(404, 'NOT_FOUND', 'That group was not found.'); end if;
  if gold.gs_has_keeper(v_group) then perform gold.fail(409, 'HAS_KEEPER', 'This group has a keeper again. Nothing to do.'); end if;
  if gold.gs_role_of(v_group, v_target) is null then perform gold.fail(422, 'VALIDATION_FAILED', 'The new keeper must be someone already in the group.'); end if;
  insert into gold.gs_members (tenant_id, group_id, user_id, role, excluded, added_by) values (gold.current_tenant(), v_group, v_target, 'keeper', false, gold.current_actor())
  on conflict (group_id, user_id) do update set role = 'keeper', excluded = false, added_by = excluded.added_by;
  perform gold.gs_log(v_group, 'keeper_named', v_target, '{}');
  perform gold.notify_user(gold.current_tenant(), v_target, 'group_keeper', format('You are now the keeper of %s', (select name from gold.gs_groups where id = v_group)), null, '/group-sheets');
  return gold.gs_home();
end $$;

-- ---------------------------------------------------------------- sheets
create function gold.gs_sheet_create(p jsonb) returns jsonb language plpgsql as $$
declare v_group uuid := (p->>'groupId')::uuid; v_id uuid := coalesce((p->>'id')::uuid, gen_random_uuid()); v_name text := gold.gs_name(p, 'sheet');
        v_open numeric := 0; v_branch uuid := nullif(p->>'branchId', '')::uuid; s gold.gs_sheets;
begin
  perform gold.gs_require_role(v_group, 'keeper');
  select * into s from gold.gs_sheets where id = v_id;
  if found then return gold.gs_sheet_json(s); end if;
  if nullif(p->>'openingBalance', '') is not null then
    if p->>'openingBalance' !~ '^-?\d{1,12}(\.\d{1,2})?$' then perform gold.fail(422, 'VALIDATION_FAILED', 'Type the opening balance in cedis, like 1200 or 0.'); end if;
    v_open := (p->>'openingBalance')::numeric;
  end if;
  if v_branch is not null and not exists (select 1 from gold.branches where id = v_branch) then perform gold.fail(404, 'NOT_FOUND', 'That branch was not found.'); end if;
  if exists (select 1 from gold.gs_sheets where group_id = v_group and lower(name) = lower(v_name)) then perform gold.fail(409, 'NAME_IN_USE', 'This group already has a sheet with that name.'); end if;
  insert into gold.gs_sheets (id, tenant_id, group_id, name, branch_id, opening_balance, opening_date, created_by)
  values (v_id, gold.current_tenant(), v_group, v_name, v_branch, v_open, nullif(p->>'openingDate', '')::date, gold.current_actor()) returning * into s;
  perform gold.gs_log(v_group, 'sheet_created', null, jsonb_build_object('sheet', v_name, 'openingBalance', gold.ts(v_open)));
  return gold.gs_sheet_json(s);
end $$;

-- rename, close or reopen. p: { sheetId, name?, closed? }
create function gold.gs_sheet_update(p jsonb) returns jsonb language plpgsql as $$
declare s gold.gs_sheets; v_name text;
begin
  perform gold.require_actor();
  select * into s from gold.gs_sheets where id = (p->>'sheetId')::uuid;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That sheet was not found.'); end if;
  perform gold.gs_require_role(s.group_id, 'keeper');
  if p ? 'name' then
    v_name := gold.gs_name(p, 'sheet');
    if v_name <> s.name then
      if exists (select 1 from gold.gs_sheets where group_id = s.group_id and lower(name) = lower(v_name) and id <> s.id) then perform gold.fail(409, 'NAME_IN_USE', 'This group already has a sheet with that name.'); end if;
      update gold.gs_sheets set name = v_name where id = s.id;
      perform gold.gs_log(s.group_id, 'sheet_renamed', null, jsonb_build_object('from', s.name, 'to', v_name));
    end if;
  end if;
  if p ? 'closed' then
    if (p->>'closed')::boolean and s.closed_at is null then
      update gold.gs_sheets set closed_at = now(), closed_by = gold.current_actor() where id = s.id;
      perform gold.gs_log(s.group_id, 'sheet_closed', null, jsonb_build_object('sheet', coalesce(v_name, s.name)));
    elsif not (p->>'closed')::boolean and s.closed_at is not null then
      update gold.gs_sheets set closed_at = null, closed_by = null where id = s.id;
      perform gold.gs_log(s.group_id, 'sheet_reopened', null, jsonb_build_object('sheet', coalesce(v_name, s.name)));
    end if;
  end if;
  select * into s from gold.gs_sheets where id = s.id;
  return gold.gs_sheet_json(s);
end $$;

create function gold.gs_sheet_delete(p jsonb) returns jsonb language plpgsql as $$
declare s gold.gs_sheets;
begin
  perform gold.require_actor();
  select * into s from gold.gs_sheets where id = (p->>'sheetId')::uuid;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That sheet was not found.'); end if;
  perform gold.gs_require_role(s.group_id, 'keeper');
  if exists (select 1 from gold.gs_entries where sheet_id = s.id) then perform gold.fail(422, 'HAS_ENTRIES', 'A sheet with entries cannot be deleted. Close it instead: it stays readable and takes no new entries.'); end if;
  delete from gold.gs_sheets where id = s.id;
  perform gold.gs_log(s.group_id, 'sheet_deleted', null, jsonb_build_object('sheet', s.name));
  return jsonb_build_object('deleted', true);
end $$;

-- who may do what on one sheet. p: { sheetId, userId (null = everyone), access: write | read | none | null (back to the role) }
create function gold.gs_access_set(p jsonb) returns jsonb language plpgsql as $$
declare s gold.gs_sheets; v_target uuid := nullif(p->>'userId', '')::uuid; v_access text := nullif(p->>'access', '');
begin
  perform gold.require_actor();
  select * into s from gold.gs_sheets where id = (p->>'sheetId')::uuid;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That sheet was not found.'); end if;
  perform gold.gs_require_role(s.group_id, 'keeper');
  if v_access is not null and v_access not in ('write', 'read', 'none') then perform gold.fail(422, 'VALIDATION_FAILED', 'Choose see and write, see only, or not see.'); end if;
  if v_target is not null and gold.gs_role_of(s.group_id, v_target) is null then perform gold.fail(422, 'VALIDATION_FAILED', 'That person is not in the group.'); end if;
  delete from gold.gs_sheet_access where sheet_id = s.id and user_id is not distinct from v_target;
  if v_access is not null and not (v_target is null and v_access = 'write') then
    insert into gold.gs_sheet_access (tenant_id, group_id, sheet_id, user_id, access) values (gold.current_tenant(), s.group_id, s.id, v_target, v_access);
  end if;
  perform gold.gs_log(s.group_id, 'access_changed', v_target, jsonb_build_object('sheet', s.name, 'access', coalesce(v_access, 'role')));
  return gold.gs_group_get(jsonb_build_object('groupId', s.group_id));
end $$;

-- ---------------------------------------------------------------- entries
-- p: { id, sheetId, direction: in | out, amount, note?, moneyDate?, dayTotal?, writtenAt? }. Sent twice with the same id: kept once.
create function gold.gs_entry_add(p jsonb) returns jsonb language plpgsql as $$
declare
  v_user uuid := gold.require_actor(); v_id uuid := (p->>'id')::uuid; k gold.gs_sheet_keys; x gold.gs_entries; v_access text; v_after boolean := false;
  v_amount numeric; v_written timestamptz; v_date date; v_today date; v_max int := greatest(coalesce((gold.setting('offline.maxDays'))::int, 7), 1);
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
  if p->>'direction' not in ('in', 'out') then perform gold.fail(422, 'VALIDATION_FAILED', 'Say whether the money was added or taken out.'); end if;
  v_amount := gold.gs_amount(p, 'amount') * case when p->>'direction' = 'out' then -1 else 1 end;
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
    insert into gold.gs_entries (id, tenant_id, group_id, sheet_id, amount, money_date, note, day_total, written_by, written_at, after_removal)
    values (v_id, gold.current_tenant(), k.group_id, k.sheet_id, v_amount, v_date, gold.gs_note(p), coalesce((p->>'dayTotal')::boolean, false), v_user, v_written, v_after);
  exception when unique_violation then
    -- already received (sent twice, and this person can no longer see it): nothing more to do
    return jsonb_build_object('id', v_id, 'sheetId', k.sheet_id, 'alreadyReceived', true);
  end;
  if v_after then perform gold.gs_log(k.group_id, 'entry_after_removal', v_user, jsonb_build_object('sheetId', k.sheet_id, 'amount', gold.ts(v_amount), 'writtenAt', gold.iso(v_written))); end if;
  return jsonb_build_object('id', v_id, 'sheetId', k.sheet_id, 'amount', gold.ts(v_amount), 'moneyDate', v_date, 'note', gold.gs_note(p), 'dayTotal', coalesce((p->>'dayTotal')::boolean, false),
    'writtenAt', gold.iso(v_written), 'afterRemoval', v_after);
end $$;

-- put a mistake right: a linked opposite entry on the same money date. Writers take back their own; keepers anyone's. p: { entryId, id }
create function gold.gs_entry_take_back(p jsonb) returns jsonb language plpgsql as $$
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
  insert into gold.gs_entries (id, tenant_id, group_id, sheet_id, amount, money_date, note, takes_back, written_by, written_at)
  values (v_id, gold.current_tenant(), x.group_id, x.sheet_id, -x.amount, x.money_date, 'Taken back', x.id, v_user, now());
  select name into v_sheet from gold.gs_sheets where id = x.sheet_id;
  perform gold.gs_log(x.group_id, 'entry_taken_back', x.written_by, jsonb_build_object('sheet', v_sheet, 'amount', gold.ts(x.amount), 'moneyDate', x.money_date, 'note', x.note));
  return gold.gs_entry_json(x);
end $$;

-- ---------------------------------------------------------------- one door for the API
create function gold.group_sheets(p_action text, p jsonb) returns jsonb language plpgsql as $$
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
    else null
  end;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
  perform gold.fail(422, 'VALIDATION_FAILED', 'Something in the request is not in the right form (an id, a date or a number).');
end $$;

-- ---------------------------------------------------------------- the last keeper's account is switched off
create function gold.trg_gs_keeper_gone() returns trigger language plpgsql as $$
declare g record;
begin
  if old.is_active and not new.is_active then
    for g in select gr.id, gr.name from gold.gs_members m join gold.gs_groups gr on gr.id = m.group_id
             where m.user_id = new.id and m.role = 'keeper' loop
      if gold.gs_needs_keeper(g.id) then
        perform gold.notify(new.tenant_id, 'group_needs_keeper', format('A group has no keeper: %s', g.name),
          'Its keeper''s account was switched off. Name a new keeper from the people still in it. You will not see its sheets.', '/group-sheets', null, 'users:manage');
      end if;
    end loop;
  end if;
  return null;
end $$;
create trigger gs_keeper_gone after update of is_active on gold.users for each row execute function gold.trg_gs_keeper_gone();

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant select, insert, update, delete on gold.gs_groups, gold.gs_members, gold.gs_branch_rules, gold.gs_sheets, gold.gs_sheet_access, gold.gs_sheet_keys, gold.gs_access_ends to gold_app;
    grant select, insert on gold.gs_entries, gold.gs_events to gold_app;
    -- entries and the log are never changed or removed by the app (default privileges may have granted more)
    revoke update, delete, truncate on gold.gs_entries, gold.gs_events from gold_app;
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;