# B8a - Fixes: price not set, transfer and mobile-money branch lists

Causes found
- **Home "price not set" (item 3):** when a new reference price arrived (typed or from GoldBod) only branches that already had a margin were priced. A branch without any margin (a fresh system, or a branch added later) stayed unpriced, so `/prices/current` answered PRICE_NOT_SET. Now every active branch is priced; one without a margin starts at margin 0, provisional (approvers are told). A new branch also starts on the latest price.
- **Empty transfer destination and mobile-money sending branch (items 9, 12):** both used `GET /branches`, which is only the branches the person works in. New endpoint `GET /branches/all` lists every active branch (names only), and `useBranchNames` now uses it, so other branches' names also show correctly elsewhere.
- "Check and use it now" always said "Checked"; it now says what happened (new price in use / nothing new / needs a director / could not read).

New
- `backend/db/migrations/0024_branch_starting_price.sql`
- `backend/db/tests/018_branch_starting_price.sql`

Changed
- `backend/src/GoldValuation.Application/Auth/AuthPorts.cs` (ListAllBranchesAsync)
- `backend/src/GoldValuation.Application/Auth/AuthService.cs` (AllBranchesAsync)
- `backend/src/GoldValuation.Infrastructure/Auth/PostgresAuthStore.cs`
- `backend/src/GoldValuation.Api/Endpoints/MeEndpoints.cs` (`GET /branches/all`)
- `backend/tests/GoldValuation.Infrastructure.Tests/AuthServiceTests.cs` (fake store gets the new method)
- `web/src/features/branches/api.ts` (useAllBranches, useBranchNames)
- `web/src/features/pricefeed/api.ts` (honest toast)
- `docs/openapi.yaml` (0.15.0)

Existing databases: the new migration is applied by `docker compose up -d --build` (the migrate job). Branches that already lack a price get one the next time a price is set or fetched; to fix them at once, press "Check and use it now" or set a price by hand.

Tested here: all 18 database test files; web 69 tests, type check. NOT tested here: the C# (no .NET) - run `dotnet test`. Then try: log in as a teller, open New transfer (other branches listed), and a purchase paid by mobile money (Sent by branch lists all branches).
Note: the user screens now list every branch in the "branches" picker for managers as well; the server still refuses assignments they have no right to make.