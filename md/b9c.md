# B9c - Role dashboards (teller, manager, director)

What you get
- **Teller home:** "New transaction", today's price, the drawer, my purchases today, my five latest purchases (tap to find one), this branch's last 7 days as a bar chart with today highlighted, and what is waiting (mobile money, debts, held gold).
- **Manager home:** four headline figures (paid out, purchases, gold bought, average purchase, each against yesterday), a "Needs your attention" list (cash differences, days to sign off, unconfirmed mobile money, flagged purchases, overdue debts, cancelled purchases, branches that have not opened, transfers on the road) ordered by seriousness, a 7/14/30-day chart you can switch between money, purchases and gold with a hover read-out, how people were paid (cash, mobile money, owed), branches ranked with their day status, tellers ranked, gold and money position, cash differences at closing. A branch picker appears when you work in more than one.
- **Director home:** everything the manager sees plus top customers and a company-wide default.
- Which home you get follows what you may do (prices:approve = director, reports:read = manager, otherwise teller), so a company's own custom roles land on the right one.
- Tellers never receive other staff's totals, top customers or cash differences: the server removes them.
- Figures refresh every minute while the screen is open. Needs a connection; the last figures stay on screen if it drops.

New files
- `backend/db/migrations/0026_dashboard.sql` (`dashboard_json`, `dash_base`)
- `backend/db/tests/020_dashboard.sql`
- `web/src/features/dashboard/api.ts`, `model.ts`, `model.test.ts`, `charts.tsx`, `tiles.tsx`, `TellerHome.tsx`, `OversightHome.tsx`

Changed files
- `web/src/features/dashboard/DashboardPage.tsx` (now picks the home)
- `backend/src/GoldValuation.Application/Operations/IOperationsStore.cs`, `OperationsService.cs` (`DashboardAsync`)
- `backend/src/GoldValuation.Infrastructure/Operations/PostgresOperationsStore.cs`
- `backend/src/GoldValuation.Api/Endpoints/OperationsEndpoints.cs` (`GET /dashboard`)
- `backend/tests/GoldValuation.Infrastructure.Tests/OperationsServiceTests.cs` (1 new test)
- `docs/openapi.yaml` (0.17.0)

Tested here: all 20 database test files (new one covers today/yesterday, voids left out, the series including empty days, branch ranking, tellers, payment mix, gold on hand, cash differences, windows, branch scope, empty shape), web type check, 94 web tests (12 new), production build, screenshots of all three homes at desktop and phone width with fake data.
NOT tested here: the C# (no .NET): run `dotnet test`. Then apply migration 0026 and open Home as a teller, a manager and a director.
Known limits: "today" is each branch's own calendar day, but the daily chart uses the Accra calendar; a company with branches in different time zones would need that changed. Gold per day counts the weight of each purchase (pounds), not purity-adjusted fine gold. No dark mode yet (the app has none).