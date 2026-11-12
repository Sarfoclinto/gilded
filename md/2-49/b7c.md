# B7c: Excel export

Two buttons write real `.xlsx` files in the browser (numbers stay numbers, dates stay dates, header row bold and frozen).

- **Transactions** page → **Excel**: choose a date range; one row per purchase with customer, pieces, weights, calculated amount, paid, difference, cash / mobile money / owed split, flags, imported marker, receipt no, who recorded it, void reason. Up to 5000 rows per file (it tells you if a range had more). Needs `reports:read` (managers and directors) and uses the active branch.
- **Branch timeline** → **Excel**: saves everything matching the screen's branch, dates and kind (up to 5000 rows, oldest first), with the balances after each row.

## Run first
1. `backend/db/migrations/0022_transactions_export.sql` (new): `dotnet run --project src/GoldValuation.Api -- migrate`
2. `cd web && npm install` (adds `write-excel-file`).

## Files
| File | Goes to |
|---|---|
| 0022_transactions_export.sql | backend/db/migrations/ |
| 016_transactions_export.sql | backend/db/tests/ |
| IReviewStore.cs, ReviewService.cs | backend/src/GoldValuation.Application/Review/ (replace) |
| PostgresReviewStore.cs | backend/src/GoldValuation.Infrastructure/Review/ (replace) |
| ReviewEndpoints.cs | backend/src/GoldValuation.Api/Endpoints/ (replace) |
| ReviewServiceTests.cs | backend/tests/GoldValuation.Infrastructure.Tests/ (replace) |
| xlsx.ts, xlsx.test.ts, ExportTransactionsButton.tsx, exportTimeline.ts | web/src/features/exports/ (new folder) |
| TransactionsPage.tsx | web/src/features/transactions/pages/ (replace) |
| BranchTimelinePage.tsx | web/src/features/review/pages/ (replace) |
| web package.json (+ root package-lock.json) | write-excel-file |
| openapi.yaml (0.13.0), 03-roadmap.md | docs/ |

## Not tested here
- The C# (no dotnet here): `dotnet test`.
- The actual browser download. The file writing is tested by writing a real xlsx and reading it back; the click-to-download part is not. Try: Transactions → Excel → Download, open the file in Excel.
- Closing-day (day history) export is not included yet.