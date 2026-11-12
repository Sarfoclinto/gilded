# B7b: Bring in your data (customers and past purchases)

Lets a director load real customers and past purchases from Excel or csv, so the demo shows real history.
Past purchases are **records only**: no cash, no gold on hand, no debts move. They are marked "Imported" and can be undone as a whole.

## Run first
1. `backend/db/migrations/0020_history_import.sql` (new). Migrate: `dotnet run --project src/GoldValuation.Api -- migrate`
2. `cd web && npm install` (adds `read-excel-file`).
3. **Give the director the new permission.** Re-run the seed command for your company (it syncs role permissions), then the director signs out and in.

## New files
| File | Goes to |
|---|---|
| 0020_history_import.sql | backend/db/migrations/ |
| 014_history_import.sql | backend/db/tests/ |
| IImportsStore.cs, ImportsService.cs | backend/src/GoldValuation.Application/Imports/ |
| PostgresImportsStore.cs | backend/src/GoldValuation.Infrastructure/Imports/ |
| ImportsEndpoints.cs | backend/src/GoldValuation.Api/Endpoints/ |
| ImportsServiceTests.cs | backend/tests/GoldValuation.Infrastructure.Tests/ |
| parse.ts, parse.test.ts, api.ts | web/src/features/imports/ |
| ImportPage.tsx | web/src/features/imports/pages/ |

## Changed files
| File | Change |
|---|---|
| Permissions.cs | `imports:manage` (directors) |
| InfrastructureModule.cs | registers the import store and service |
| Program.cs | `api.MapImports();` after `api.MapReview();` |
| web package.json (+ root package-lock.json) | `read-excel-file` |
| config/permissions.ts, permissionLabels.ts, paths.ts | new permission, label, `/setup/import` |
| app/router/routes.tsx, layouts/menu.tsx | route and menu entry (Setup → Bring in data) |
| transactions/view.ts | text for the `HISTORICAL` flag |
| docs/openapi.yaml (0.11.0), docs/architecture/03-roadmap.md | endpoints; new agreed order |

## How it works
- Customers sheet: `Name, Phone, Notes`. Someone with the same name and phone is left alone, so running it twice is safe.
- Purchases sheet: `Date, Branch, Customer, Phone, Item, Top, Down, Price, Amount paid, Receipt no, Note`. Branch is the code or name (or pick one branch on the page). Dates like `2026-03-02` or `02/03/2026` (day first). Lines with the same Receipt no, day and customer become one purchase with several pieces. Download the templates on the page.
- The server recalculates every piece with your formula. If the sheet had its own total and it differs by GH₵ 1 or more, the purchase is flagged. "Amount paid" is kept as what was paid; without it, the calculated amount is used.
- Imports are sent 200 purchases at a time and can be resent safely (a row already imported is skipped). "Earlier imports" lets the director void a whole import with a reason.
- Imported purchases show newest-first by their real date in each branch list.

## Not tested here, and how to test
- **The C# (service, store, endpoint, tests)** was not built here (no dotnet in my workspace). Run `dotnet test`; the new `ImportsServiceTests` should pass.
- **Real Excel files.** The parser is tested with tables and csv text, but not with a real `.xlsx` read in a browser. Try your own sheet: Setup → Bring in data → pick the file; the preview shows what was understood before anything is saved.
- End to end: import 3 rows, open Transactions for that branch (they appear marked Imported), open the customer (history shows), then Earlier imports → Undo.

## Known limits
- Opening balances (gold stock, debts) are the next step; cash is the first count when a branch opens its first day.
- Imported gold can't be transferred (it isn't physically tracked).
- Times default to 12:00 when the sheet has no Time column.