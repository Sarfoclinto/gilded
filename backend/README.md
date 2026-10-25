# GoldValuation backend

Design: `../docs/architecture/` (read `02-accounting-and-traceability.md` first).

## 1. Database (pgAdmin)

1. In pgAdmin, open the Query Tool on the `postgres` database and run `db/setup/00_roles.sql` (change the two passwords first).
2. Create an empty database called `gold` (owner `gold_migrator`): right-click Databases > Create > Database.
3. Apply the migrations, either way:
   - from the command line (needs the .NET SDK): `dotnet run --project src/GoldValuation.Api -- migrate`
   - or by hand in pgAdmin: Query Tool on `gold`, run `db/migrations/0001...0008` in order as `gold_migrator` (the file names are the order).
4. Check: in pgAdmin, Schemas > gold > Tables should list about 31 tables (plus schema_migrations after the first migrate).

Connection strings: edit `src/GoldValuation.Api/appsettings.json`, or better set them with user-secrets so they never reach git:

```
dotnet user-secrets --project src/GoldValuation.Api set "ConnectionStrings:App" "Host=localhost;Database=gold;Username=gold_app;Password=..."
dotnet user-secrets --project src/GoldValuation.Api set "ConnectionStrings:Migrator" "Host=localhost;Database=gold;Username=gold_migrator;Password=..."
```

## 2. Tests

```
dotnet test                       # Domain tests: calculator and solver vs the shared vectors, accounting rules
```

Database tests (needs a login that can create databases; the tests create and drop their own scratch database):

```
# PowerShell
$env:GOLD_TEST_ADMIN_CONNECTION = "Host=localhost;Username=postgres;Password=YOUR_PASSWORD"
dotnet test
```

SQL scenario tests on their own (Linux/macOS/WSL with psql): `db/run-tests.sh -h localhost -U postgres`. In pgAdmin you can also open `db/tests/001_accounting_flow.sql` in a scratch database after applying the migrations; it prints "all assertions passed".

## 3. Run

```
dotnet run --project src/GoldValuation.Api
# http://localhost:5xxx/health/live   and   /health/ready (checks the database)
```

## .NET version

`Directory.Build.props` targets `net10.0` (current LTS) and `global.json` asks for SDK 10. If `dotnet --list-sdks` shows an older SDK, change the one line in `Directory.Build.props` (and delete or edit `global.json`); nothing else depends on it.
