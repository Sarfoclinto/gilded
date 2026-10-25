-- 0002 Pricing, calculation settings, customers, document numbers.

-- The calculation constants a company's formula uses. A transaction records which version priced it,
-- so changing a constant later never rewrites history.
create table gold.formula_versions (
  tenant_id       uuid not null references gold.tenants(id),
  key             text not null,                    -- 'ExcelV1'
  params          jsonb not null,                   -- {"correctionRate":"0.007","poundGrams":"7.75","priceReferenceKarat":"23", ...}
  effective_from  date not null default current_date,
  created_at      timestamptz not null default now(),
  primary key (tenant_id, key)
);

-- Published reference prices (GoldBod, or typed in by hand when the feed is unavailable).
create table gold.price_snapshots (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references gold.tenants(id),
  source        text not null check (source in ('goldbod', 'manual')),
  base_price    numeric(18,2) not null check (base_price >= 0),
  published_at  timestamptz not null,
  fetched_at    timestamptz not null default now(),
  raw           jsonb,
  created_by    uuid,
  unique (tenant_id, id)
);
create index price_snapshots_latest on gold.price_snapshots (tenant_id, published_at desc);

-- The price a branch actually pays: reference price + margin. Staff may set a provisional margin when the
-- director is away; the director approves or replaces it.
create table gold.branch_prices (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  branch_id     uuid not null,
  snapshot_id   uuid not null,
  margin        numeric(18,2) not null,
  status        text not null check (status in ('provisional', 'approved')),
  set_by        uuid not null,
  approved_by   uuid,
  approved_at   timestamptz,
  effective_from timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  foreign key (tenant_id, branch_id)   references gold.branches (tenant_id, id),
  foreign key (tenant_id, snapshot_id) references gold.price_snapshots (tenant_id, id),
  foreign key (tenant_id, set_by)      references gold.users (tenant_id, id),
  check ((status = 'approved') = (approved_by is not null and approved_at is not null))
);
create index branch_prices_latest on gold.branch_prices (tenant_id, branch_id, effective_from desc);
create trigger branch_prices_immutable before delete on gold.branch_prices
  for each row execute function gold.forbid_mutation();

create table gold.customers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references gold.tenants(id),
  name        text not null,
  phone       text,
  notes       text,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  unique (tenant_id, id)
);
create index customers_search on gold.customers (tenant_id, lower(name));

-- Human-friendly numbers: TKW-20261022-0007, TRF-KSI-20261022-0002. Gaps are acceptable, duplicates are not.
create table gold.document_counters (
  tenant_id     uuid not null references gold.tenants(id),
  kind          text not null,                      -- 'transaction', 'transfer', ...
  branch_id     uuid not null,
  business_date date not null,
  last_value    integer not null default 0,
  primary key (tenant_id, kind, branch_id, business_date),
  foreign key (tenant_id, branch_id) references gold.branches (tenant_id, id)
);

create function gold.next_document_number(p_tenant uuid, p_kind text, p_branch uuid, p_date date)
returns integer language sql as $$
  insert into gold.document_counters (tenant_id, kind, branch_id, business_date, last_value)
  values (p_tenant, p_kind, p_branch, p_date, 1)
  on conflict (tenant_id, kind, branch_id, business_date)
  do update set last_value = gold.document_counters.last_value + 1
  returning last_value
$$;
