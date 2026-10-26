# Backend architecture

ASP.NET Core + PostgreSQL, ADO.NET (Npgsql) repositories, no EF, as agreed. Built to be sold to other gold buyers: multi-company from the first table, auditable by construction, offline-safe.

## Shape: a modular monolith in four layers

```
backend/
  src/
    GoldValuation.Domain          pure rules: ExcelV1 calculator, note solver, reconciliation, closing confirmation. No packages.
    GoldValuation.Application     use cases and the ports they need (IClock, ICurrentContext, AppException). Depends on Domain.
    GoldValuation.Infrastructure  Npgsql repositories, TenantSession, SqlMigrator (embedded SQL). Depends on Application.
    GoldValuation.Api             HTTP: endpoints, auth, error envelope, health. Depends on Infrastructure.
  tests/
    GoldValuation.Domain.Tests          shared calculation and solver vectors, accounting rules
    GoldValuation.Infrastructure.Tests  migrations against a real PostgreSQL (opt-in)
  db/
    migrations/  0001..  numbered SQL, applied once each, checksum-verified
    setup/       roles to create once as an administrator
    tests/       SQL scenario tests (run with db/run-tests.sh)
```

Dependencies point inward only. Business rules live in Domain/Application and are unit-testable without a database or web server. The database enforces the rules that protect money (immutability, tenant isolation, "difference needs explanation", "no close without confirmation") as a second line of defence, so a bug or a second client cannot corrupt the books.

Inside Application, code is organised by **feature** (Days, Transfers, Transactions, Discrepancies...), each with its commands, queries, validators and repository interface, rather than by technical type. Adding a feature touches one folder.

## Key decisions

| Topic | Decision | Why |
|---|---|---|
| Data access | Npgsql + hand-written SQL in repositories, one `TenantSession` (connection + transaction) per request | Matches how you work; explicit SQL is easy to review for money code |
| Schema changes | Numbered SQL migrations, embedded in the assembly, run by `dotnet run --project src/GoldValuation.Api -- migrate`; checksum stops edits to applied files | One deployable artifact; no drift |
| Tenancy | `tenant_id` everywhere, composite FKs, row-level security, per-request `SET LOCAL` | Safe to host several companies; a missing WHERE cannot leak |
| Logins | `gold_migrator` (owner, migrations only) and `gold_app` (data only, no DDL, no UPDATE/DELETE on append-only tables) | Least privilege |
| Money and weights | `numeric` in the database, `decimal` in C#, strings over the wire (as the contract already says) | No floating point near money |
| Offline | Every write command carries a client-generated id used as `Idempotency-Key`; late entries are accepted and flagged, never refused for lateness | Already how the web app queues commands |
| Time | Server records `recorded_at`; the device's `occurred_at` is kept next to it | Auditors see both |
| API contract | `docs/openapi.yaml` stays the source of truth; each slice's contract is updated before its code | Web and backend develop against the same document |
| Errors | One envelope `{ error: { code, message, fieldErrors, traceId } }` with real HTTP statuses | Same as the web client expects |
| Auth | Short-lived JWT access token, rotating refresh token in an httpOnly cookie, reuse detection (family revoke), lockout | Matches the client's single-flight refresh |
| Authorization | `resource:action` permissions from role plus per-user overrides, checked in the use case | Company-configurable; the UI only mirrors it |
| Audit | `audit_events` row for every business action in the same transaction as the change | Cannot be missed |
| Config and secrets | appsettings + environment variables + user-secrets locally; nothing secret in git | Standard |

## Request flow

```
HTTP -> ErrorEnvelopeMiddleware -> auth (JWT) -> ICurrentContext (tenant, user, branches, permissions)
     -> endpoint -> use case -> TenantSession.BeginAsync(tenant, user)   // SET LOCAL app.tenant_id / app.user_id
                             -> repositories (same connection + transaction)
                             -> ledger rows + audit row, commit once
```

## What is deliberately not here yet

Background jobs (price feed, notifications), SignalR, file storage provider, encryption at rest layer (the design leaves room: sensitive columns such as collector ID numbers are isolated and can be wrapped by a protector), reporting read-models. Each arrives in its phase (see the roadmap) so nothing is built before it is needed.
