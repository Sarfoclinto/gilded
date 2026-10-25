-- Run ONCE by a database administrator (in pgAdmin: Query Tool on the 'postgres' database), before the migrations.
-- Creates the least-privileged login the API uses. The migration login (owner) is separate and is only used by the migration runner.
-- Change the passwords. Do not commit real ones.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'gold_app') then
    create role gold_app login password 'change-me-app' nosuperuser nocreatedb nocreaterole;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'gold_migrator') then
    create role gold_migrator login password 'change-me-migrator' nosuperuser createdb nocreaterole;
  end if;
end $$;
