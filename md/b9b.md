# B9b - Transactions page: search, filters, sorting, paging (and the shared list pattern)

What you get
- **All Transactions:** a table on desktop (when, receipt, customer, gold, amount, paid by, status, recorded by) and cards on a phone. Search by customer, phone or receipt; date range (Today, 7 days, 30 days, All, Custom); sort (newest, oldest, highest, lowest); more filters (status, smallest/largest amount, flagged only); removable filter chips and "Clear all"; paging with 25/50/100 rows; a one-line total ("60 purchases, GHS 125,490 paid out"). Filters live in the address bar, so refresh, back and a pasted link give the same list. The default is the last 30 days, so a big import never buries today's work.
- **Server side:** new `GET /transactions/search` (database function `transactions_search`). It only ever searches the branches the person works in. A `%` or `_` typed in the search box is treated as plain text.
- **Reusable pieces** for the next screens (customer page, transfers, debts): `shared/ui/DataTable.tsx` (DataTable, Pager, EmptyState, loading rows), `features/transactions/search.ts` (filters <-> address), `TransactionFilters.tsx`.
- Small: "Mobile money pending" is now "Money pending" so it fits one line; the page keeps clear of the floating calculator button.

New files
- `backend/db/migrations/0025_transactions_search.sql`
- `backend/db/tests/019_transactions_search.sql`
- `web/src/shared/ui/DataTable.tsx`
- `web/src/features/transactions/search.ts`, `search.test.ts`, `TransactionFilters.tsx`

Changed files
- `backend/src/GoldValuation.Application/Operations/Commands.cs` (TransactionSearch)
- `backend/src/GoldValuation.Application/Operations/IOperationsStore.cs`, `OperationsService.cs`
- `backend/src/GoldValuation.Infrastructure/Operations/PostgresOperationsStore.cs`
- `backend/src/GoldValuation.Api/Endpoints/OperationsEndpoints.cs`
- `backend/tests/GoldValuation.Infrastructure.Tests/OperationsServiceTests.cs` (2 new tests, fake store)
- `web/src/features/transactions/pages/TransactionsPage.tsx`, `api.ts`, `hooks.ts`, `view.ts`, `SyncChip.tsx`
- `web/src/shared/ui/Chip.tsx`, `web/src/layouts/AppLayout.tsx`
- `docs/openapi.yaml` (0.16.0; also fixed an older YAML error so the file now parses)

Tested here: all 19 database test files (new one covers search, phone, receipt, dates, customer, status, flags, amounts, sorting, paging, branch scope, unknown sort), web type check, 82 web tests, production build, screenshots of the real page (Chromium, fake data) at desktop and phone width.
NOT tested here: the C# (no .NET) - run `dotnet test`. Then in the app: open Transactions, type a customer name, pick 7 days, open Filters, change page.
Known limits: the list needs a connection (a search can't run offline; the last list you looked at stays visible); purchases waiting on this device show at the top of page 1 only when no filter narrows the list; Excel export still uses its own date picker (next step: export exactly what the filters show).