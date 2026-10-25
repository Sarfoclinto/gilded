-- 0001 Foundation: schema, helpers, tenancy, identity, idempotency, audit.
-- Conventions used everywhere:
--   * every business table carries tenant_id (one deployment can serve many companies)
--   * child tables point at parents with (tenant_id, id) so a row can never reference another company's data
--   * ids are uuids; devices may generate them (offline-first), the server never trusts them across tenants
--   * "append-only" tables reject UPDATE and DELETE with a trigger: history is corrected by adding rows, not editing
--   * text + CHECK instead of enum types: adding a value later is a cheap migration

create schema if not exists gold;
create extension if not exists citext;

create function gold.forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception '% on gold.% is not allowed: this table is append-only', tg_op, tg_table_name
    using errcode = 'integrity_constraint_violation';
end $$;

-- True when the text has at least n visible characters. NULL counts as "no text"; a bare length() check would let NULL pass a CHECK.
create function gold.has_text(value text, min_chars int default 1) returns boolean
language sql immutable as $$ select coalesce(length(trim(value)), 0) >= min_chars $$;

create function gold.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- The tenant the current connection is working for. The API sets it per request: SET LOCAL app.tenant_id = '...'.
create function gold.current_tenant() returns uuid language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

-- The signed-in user, for triggers that log who did something.
create function gold.current_actor() returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create table gold.tenants (
  id          uuid primary key default gen_random_uuid(),
  slug        citext not null unique,
  name        text not null,
  currency    char(3) not null default 'GHS',
  -- Company-level configuration: denominations, rounding defaults, offline threshold, notification channel...
  settings    jsonb not null default '{}'::jsonb,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table gold.branches (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references gold.tenants(id),
  code        text not null,
  name        text not null,
  is_main     boolean not null default false,          -- the branch that supplies the others (Kumasi)
  timezone    text not null default 'Africa/Accra',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (tenant_id, code),
  unique (tenant_id, id)
);
create unique index branches_one_main_per_tenant on gold.branches (tenant_id) where is_main;

create table gold.roles (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references gold.tenants(id),
  key         text not null,                             -- director, manager, teller, or anything the company defines
  name        text not null,
  is_system   boolean not null default false,
  unique (tenant_id, key),
  unique (tenant_id, id)
);

create table gold.role_permissions (
  tenant_id   uuid not null,
  role_id     uuid not null,
  permission  text not null check (permission ~ '^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$'),   -- resource:action
  primary key (role_id, permission),
  foreign key (tenant_id, role_id) references gold.roles (tenant_id, id) on delete cascade
);

create table gold.users (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references gold.tenants(id),
  username           citext not null,
  display_name       text not null,
  email              citext,
  phone              text,
  password_hash      text not null,
  role_id            uuid not null,
  is_active          boolean not null default true,
  failed_login_count integer not null default 0,
  locked_until       timestamptz,
  last_login_at      timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, username),
  unique (tenant_id, id),
  foreign key (tenant_id, role_id) references gold.roles (tenant_id, id)
);
create trigger users_touch before update on gold.users for each row execute function gold.touch_updated_at();

-- Extra grants or denials for one person on top of their role ("anyone with the right permission can set the Kumasi value").
create table gold.user_permission_overrides (
  tenant_id   uuid not null,
  user_id     uuid not null,
  permission  text not null check (permission ~ '^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$'),
  effect      text not null check (effect in ('allow', 'deny')),
  primary key (user_id, permission),
  foreign key (tenant_id, user_id) references gold.users (tenant_id, id) on delete cascade
);

-- Which branches a person can work in (some rotate, some are fixed).
create table gold.user_branches (
  tenant_id   uuid not null,
  user_id     uuid not null,
  branch_id   uuid not null,
  is_primary  boolean not null default false,
  primary key (user_id, branch_id),
  foreign key (tenant_id, user_id)   references gold.users (tenant_id, id)    on delete cascade,
  foreign key (tenant_id, branch_id) references gold.branches (tenant_id, id) on delete cascade
);

-- Refresh tokens are stored hashed. A family is one login; reuse of a rotated token revokes the whole family.
create table gold.refresh_tokens (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  user_id      uuid not null,
  family_id    uuid not null,
  token_hash   bytea not null unique,
  issued_at    timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  replaced_by  uuid,
  user_agent   text,
  ip           inet,
  foreign key (tenant_id, user_id) references gold.users (tenant_id, id) on delete cascade
);
create index refresh_tokens_user on gold.refresh_tokens (user_id) where revoked_at is null;

-- A resent request returns the stored answer instead of doing the work twice.
create table gold.idempotency_keys (
  tenant_id     uuid not null references gold.tenants(id),
  key           text not null,
  user_id       uuid not null,
  request_hash  bytea not null,        -- same key with a different body is a client bug: 422, not a replay
  status_code   integer,               -- null while the first request is still running
  response      jsonb,
  created_at    timestamptz not null default now(),
  primary key (tenant_id, key)
);
create index idempotency_keys_age on gold.idempotency_keys (created_at);

-- Who did what, when, from where. Written by the API for every business action; never edited.
create table gold.audit_events (
  id            bigint generated always as identity primary key,
  tenant_id     uuid not null references gold.tenants(id),
  occurred_at   timestamptz not null default now(),
  actor_user_id uuid,
  action        text not null,         -- e.g. day.closed, transfer.received, discrepancy.resolved
  entity_type   text not null,
  entity_id     text not null,
  branch_id     uuid,
  before        jsonb,
  after         jsonb,
  trace_id      text,
  ip            inet
);
create index audit_events_entity on gold.audit_events (tenant_id, entity_type, entity_id);
create index audit_events_when   on gold.audit_events (tenant_id, occurred_at desc);
create trigger audit_events_immutable before update or delete on gold.audit_events
  for each row execute function gold.forbid_mutation();

-- Files that prove something (collector ID photo, receipt, signed sheet). The bytes live in object storage.
create table gold.attachments (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references gold.tenants(id),
  entity_type   text not null,
  entity_id     uuid not null,
  storage_key   text not null,
  file_name     text not null,
  content_type  text not null,
  size_bytes    bigint not null check (size_bytes >= 0),
  sha256        bytea not null,
  uploaded_by   uuid,
  uploaded_at   timestamptz not null default now()
);
create index attachments_entity on gold.attachments (tenant_id, entity_type, entity_id);
create trigger attachments_immutable before update or delete on gold.attachments
  for each row execute function gold.forbid_mutation();
