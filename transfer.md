# B5 Transfers: gold and cash between branches

Paths are from the repo root (`gilded-v3/`). **NEW** = create the file at that path. **CHANGED** = replace your copy.
No new npm or NuGet packages.

## 0. Do this, in this order

1. Backend files (section 1). Then from `backend/db`: `./run-tests.sh` (must end with ALL DATABASE TESTS PASSED), and from `backend`: `dotnet build`, `dotnet test`.
2. Apply migration `0015_transfers.sql` the way you applied 0014, then **run the same `seed` command again** (it adds the three new permissions to the standard roles and keeps passwords).
3. Frontend files (section 2). From `web`: `npx tsc --noEmit`, `npx vitest run`, `npm run dev`.
4. **Everyone signs out and in again** (permissions are read at sign-in).

## 1. Backend

| Status | File | Goes in | Next to |
|---|---|---|---|
| NEW | `0015_transfers.sql` | `backend/db/migrations/` | `0014_people.sql` |
| NEW | `009_transfers.sql` | `backend/db/tests/` | `008_people.sql` |
| NEW | `ITransfersStore.cs`, `TransfersService.cs` | `backend/src/GoldValuation.Application/Transfers/` (new folder) | `People/` |
| NEW | `PostgresTransfersStore.cs` | `backend/src/GoldValuation.Infrastructure/Transfers/` (new folder) | `People/` |
| NEW | `TransfersEndpoints.cs` | `backend/src/GoldValuation.Api/Endpoints/` | `PeopleEndpoints.cs` |
| NEW | `TransfersServiceTests.cs` | `backend/tests/GoldValuation.Infrastructure.Tests/` | `PeopleServiceTests.cs` |
| CHANGED | `Permissions.cs` | `backend/src/GoldValuation.Application/Auth/` | |
| CHANGED | `InfrastructureModule.cs` | `backend/src/GoldValuation.Infrastructure/` | |
| CHANGED | `Program.cs` | `backend/src/GoldValuation.Api/` (one line: `api.MapTransfers();`) | |
| CHANGED | `openapi.yaml` | `docs/` (version 0.6.0). **Keep it in `docs/`, the API embeds it from there.** | |
| CHANGED | `03-roadmap.md` | `docs/architecture/` | |

### New permissions (default for teller, manager and director)
`transfers:read`, `transfers:create` (the sending end: prepare, hand over, pay, cancel a draft), `transfers:receive` (the receiving end). They are separate so a company can later make "receive" a more careful role.

### How it works
1. **Draft** at the sending branch: choose the destination, the purpose, how it travels, and for gold the pieces (only gold that is on hand at that branch and not already on another open transfer). Cash transfers are counted at handover. The collector (our staff, or someone outside with phone and ID) can be set now or later.
2. **Hand to the collector** (needs an open day at the sending branch and a collector): the gold leaves the sending branch's books (or the notes leave its drawer) and the totals are frozen. A released transfer cannot be cancelled; it must be received.
3. **Money paid because of the transfer** (either end, after release): paying the collector, or the collector paying on collection. Cash payments move notes in or out of that branch's drawer.
4. **Receive** at the destination (needs an open day there): every piece is marked *Matches*, *Differs* (weights found) or *Not here*. Anything that is not a match needs a written explanation and opens a **difference case** (visible on the transfer; the review inbox comes in B6). What was received is booked on the receiving branch **as stock**, as you decided. A piece that did not arrive stays "in transit" until a manager settles it. For cash, the notes counted are booked in; a different total needs an explanation and opens a case.
5. Every step is written to the transfer's **timeline** (who, when, what), including a change of collector and notes.

Weights and value: the value of a piece on a transfer is its share of what its purchase was booked at. If the receiver finds a different weight, the booked value is scaled by the top weight. A manager settles the exact difference from the case. This is a stated rule, say if you want another.

### Failed mobile money (your earlier decision)
When a mobile money payment fails and the purchase branch pays cash, the purchase branch's drawer pays the notes. The branch that was to send the money gets **no notes added to its drawer**; the amount shows against it as `mobile_money_failed_covered_by_cash` in the between-branches position (`v_interbranch_position`), as money it still has to hand over. Nothing is netted automatically. You chose this on my question, I only added the figure to the position, no screen shows the position yet (B6).

### New endpoints (details in `docs/openapi.yaml`)
`GET /transfers`, `POST /transfers`, `GET /transfers/available-items`, `GET /transfers/staff`, `GET/PATCH /transfers/{id}`, `POST /transfers/{id}/release`, `/payments`, `/receive`, `/cancel`, `/notes`.

## 2. Frontend

### 2.1 NEW (create)
| File | Goes in |
|---|---|
| `schemas.ts`, `api.ts`, `labels.tsx`, `CollectorFields.tsx`, `CollectorModal.tsx`, `AddItemsModal.tsx`, `ReleaseModal.tsx`, `PaymentModal.tsx`, `ReceiveModal.tsx` | `web/src/features/transfers/` (new folder) |
| `TransfersPage.tsx`, `NewTransferPage.tsx`, `TransferDetailPage.tsx` | `web/src/features/transfers/pages/` (new folder) |

### 2.2 CHANGED (replace)
| File | Folder |
|---|---|
| `permissions.ts`, `permissionLabels.ts`, `paths.ts` | `web/src/config/` |
| `routes.tsx` | `web/src/app/router/` |
| `menu.tsx` | `web/src/layouts/` |

## 3. Screens
| Screen | Menu | Who |
|---|---|---|
| **Transfers** list (all / sent from here / coming here, by status; a banner counts what is on its way to this branch) | Between branches → Transfers | `transfers:read` |
| **New transfer** | button on the list | `transfers:create` |
| **Transfer detail** (collector, lines, differences, money paid, timeline; action buttons depend on the status and on which end you work at) | click a row | read |

## 4. Test walkthrough (two branches, two people)
1. Tarkwa teller: open the day, buy something (any cash purchase). **Transfers → New transfer**: to Kumasi, "Collecting gold", pick the piece, tick "I know who is carrying it", choose a person (or someone outside), **Save draft**.
2. On the draft: **Hand to the collector**. Check the cash drawer / day figures: the goods value at Tarkwa has gone down.
3. **Record money paid**: pay the collector 50 cash in notes. Check the drawer drops by 50.
4. Sign in as the Kumasi teller, open the day. **Transfers** shows "1 on its way". Open it, **Receive**: mark the piece *Differs*, enter a lighter weight and write what you found, confirm. Status becomes "Received, with differences" and a case is listed. Kumasi's goods went up by the received amount.
5. Repeat with a second piece and choose *Not here*. Then a **cash** transfer: send 1000, count 900, explain.
6. Refusals to try: receive twice; hand over with no collector; add a piece already on another transfer; receive at a branch whose day is not open; try to cancel a released transfer; receive from the sending branch.

## 5. Tested / not tested
- **Tested (SQL):** `009_transfers.sql`, 36 assertions: drafting, the one-open-transfer-per-piece rule, scope refusals, release posting, payments, receive (matched / differs / missing), cash with a short count, case creation, books at both ends, the timeline, cancelling a draft, and the failed mobile money figure. All earlier tests still pass.
- **Tested (web):** `tsc` clean, 43 unit tests pass, build succeeds. The JSON the new SQL produces parses with the new zod schemas.
- **NOT tested:** the C# (I cannot compile here: `dotnet build` and `dotnet test`, send me any error), and the screens in a browser.

## 6. Known limits
- **Attachments (photos, documents on a transfer) are not built.** They need a decision on file storage (local disk, Azure Blob, S3). Tell me which and I will add them.
- A released transfer can only be received (no cancel). If it was sent by mistake, receive it with the explanation, or tell me to add a "return to sender" step.
- The difference cases are created and shown on the transfer; the inbox where a manager assigns, comments and resolves them is B6.
- A piece marked *Not here* stays "in transit" and is not offered for any other transfer until resolved in B6.