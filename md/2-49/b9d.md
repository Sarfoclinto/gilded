# B9d - Transaction detail, Customers, Customer details

What you get
- **Transaction detail:** the amount first (paid, calculated, why they differ), net gold / pounds / items / price, each item with karat and purity, how it was paid with a cash / mobile money split bar, cash notes, and a "What happened" timeline (price fixed, weighed and recorded, reached the server, mobile money confirmed, cancelled). A red banner shows who cancelled a purchase, when and why. The customer's name links to their page. **Print** gives a clean receipt (menus and buttons hidden); **Copy as text** gives a short version to paste into WhatsApp.
- **Customers:** four headline figures (customers, bought in 30 days, owe us, we owe), each a shortcut to its filter; search by name or phone; filters Everyone / Owes us / We owe / Active / Quiet; sort by name, most recent, most purchases, most paid, largest balance; rows per page; all of it in the address bar so links and the back button work. Table on desktop, cards on a phone.
- **Customer details:** a header with a tap-to-call number, lifetime paid, purchases, average, last bought and balance, then the customer's purchases with the same search, date, sort, status and amount filters as the Transactions page (starting at "All"), debts, and held gold. A teller sees a note when some purchases were made at branches they do not work in.
- A cancelled purchase no longer counts in a customer's purchases, paid total or "last bought".
- The purchase table's columns now live in one place (`transactions/columns.tsx`), used by both pages.

New files
- `backend/db/migrations/0027_customers_and_receipt.sql`
- `backend/db/tests/021_customers_query.sql`
- `web/src/features/transactions/columns.tsx`, `receipt.ts`, `receipt.test.ts`
- `web/src/features/customers/search.ts`, `search.test.ts`
- `web/src/shared/lib/dates.ts`, `dates.test.ts`

Changed files
- Backend: `PeopleEndpoints.cs`, `IPeopleStore.cs`, `PeopleService.cs`, `PostgresPeopleStore.cs`, `PeopleServiceTests.cs`; `docs/openapi.yaml` (0.18.0)
- `web/src/features/transactions/`: `pages/TransactionDetailPage.tsx`, `pages/TransactionsPage.tsx`, `TransactionFilters.tsx`, `search.ts`, `schemas.ts`, `view.ts`, `format.ts`
- `web/src/features/customers/`: `api.ts`, `pages/CustomersPage.tsx`, `pages/CustomerDetailPage.tsx`
- `web/src/features/utility/UtilityPanel.tsx` (calculator button hidden when printing), `web/src/index.css` (print rules)

Tested here: all 21 database test files (new one covers search, filters, sorting, paging, summary, wildcard characters, cancelled purchases, the receipt's cancellation details), web type check, 110 web tests (16 new), production build, screenshots of all three screens at desktop and phone width, and a printed receipt (PDF).
NOT tested here: the C# (no .NET): run `dotnet test`. Then apply migration 0027 and click through: Transactions > a purchase > Print; Customers > filter "Owes us" > a customer.
Known limits: customers are company-wide, so "Paid to them" and "Purchases" count every branch, while the purchase list on a customer's page shows only the branches you work in (a note says so). "Quiet" counts customers who never bought as well. The receipt print is a plain page, not a branded receipt slip or thermal-printer layout yet; say if you need one.