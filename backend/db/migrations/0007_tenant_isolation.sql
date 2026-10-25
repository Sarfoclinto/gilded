-- 0007 Row-level security: a connection can only see and change its own company's rows.
-- The API runs `SET LOCAL app.tenant_id = '<uuid>'` at the start of every request's transaction.
-- Even a bug in a query (a missing WHERE tenant_id = ...) cannot leak another company's data.
-- The migration user owns the tables and is not subject to this; the application connects as gold_app.

do $$
declare t record;
begin
  for t in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'gold' and c.column_name = 'tenant_id' and tb.table_type = 'BASE TABLE'
  loop
    execute format('alter table gold.%I enable row level security', t.table_name);
    execute format('alter table gold.%I force row level security', t.table_name);
    execute format(
      'create policy tenant_isolation on gold.%I using (tenant_id = gold.current_tenant()) with check (tenant_id = gold.current_tenant())',
      t.table_name);
  end loop;
end $$;

alter table gold.tenants enable row level security;
alter table gold.tenants force row level security;
create policy tenant_self on gold.tenants using (id = gold.current_tenant());
