# Accounting and traceability model

Goal: every cedi, every gram and every debt can be traced from where it came from, to where it went, who was responsible, and how the final balance was reached, for any branch and any date range.

## The one idea: an immutable ledger

A branch holds four kinds of assets and obligations:

| Asset                  | Measured as                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| **Cash**               | notes by denomination (and so its value)                                                       |
| **Goods**              | gold on hand: total top weight, total down weight, monetary value                              |
| **Debts** (receivable) | amount owed _to_ the branch (customers, staff advances)                                        |
| **Payables**           | amount the branch _owes_ (typically a customer who brought gold and could not be paid in full) |

Every change to any of them is one or more rows in `gold.ledger_entries`. A row says: which branch, which asset, how much (signed), when it really happened, who recorded it, and **what caused it** (`source_type` + `source_id`: a transaction, a transfer, a drawer movement, a debt repayment, an adjustment...).

- Rows are never edited or deleted (database trigger, plus the app login has no UPDATE/DELETE privilege). A mistake is fixed by a new row (`reversal`, `*_adjustment`, `discrepancy_resolution`) that points at what it corrects.
- A branch's balance at any moment is the **sum of its ledger** (`gold.branch_balance(branch, upto_seq)`).
- `gold.v_branch_timeline` lists every movement in order with the running balance after each, filterable by branch and date range. That is the timeline directors and managers read.

Why this and not "update a balance column": a balance column can only say where you are. The ledger says how you got there, and the totals can always be re-derived and audited.

## What causes ledger rows

| Event                                              | Cash                                  | Goods                                 | Debt                      | `source_type`                                                  |
| -------------------------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------- | -------------------------------------------------------------- |
| Customer sale of gold (purchase)                   | notes out (the cash part)             | top/down/value in                     | payable + if part is owed | `transaction_payout`, `transaction_purchase`, `payable_issued` |
| Payable settled later                              | notes out if paid in cash             |                                       | payable -                 | `payable_settlement`                                           |
| Top-up / withdrawal                                | notes in/out                          |                                       |                           | `drawer_movement`                                              |
| Staff advance / debt issued                        | notes out                             |                                       | debt +                    | `debt_issued`                                                  |
| Debt repayment                                     | notes in                              |                                       | debt -                    | `debt_repayment`                                               |
| Transfer released (collector takes goods, or cash) | cash out of origin if a cash transfer | out of origin if a goods transfer     |                           | `transfer_release`                                             |
| Transfer received                                  | cash into destination (as counted)    | goods into destination (as confirmed) |                           | `transfer_receipt`                                             |
| Money paid with a transfer                         | notes in/out                          |                                       |                           | `transfer_payment`                                             |
| Opening count differs from yesterday's close       | +/-                                   | +/-                                   | +/-                       | `opening_adjustment`                                           |
| Closing count differs from expected                | +/-                                   | +/-                                   | +/-                       | `closing_adjustment`                                           |
| Manager corrects a surplus/shortage                | +/-                                   | +/-                                   | +/-                       | `discrepancy_resolution`                                       |
| First balances when the company goes live          |                                       |                                       |                           | `go_live_balance`                                              |

Late or offline entries keep their real time (`occurred_at`, device clock) and the time the server learned of them (`recorded_at`). An entry that reaches the server when no day is open has no day (`business_day_id` null) but still counts toward the balance and shows on the timeline, flagged as between days.

## Days, continuity and reconciliation

```
          yesterday's closing (ledger balance, = what was declared at close)
                                  |
                      opening_expected  (server, from the ledger)
                      opening_declared  (teller counts)  --> differs? reason required, opening_adjustment posted
                                  |
                       ... transactions, movements, transfers ...
                                  |
                      closing_expected  (server, from the ledger)
                      closing_declared  (teller reports)  --> differs? reason required, closing_adjustment posted
                                  |
                       close = tick the physical-verification box
                                  |
                      tomorrow's opening_expected = this closing (automatic)
```

- **Continuity is automatic.** Tomorrow's expected opening is the ledger balance, which already equals today's declared closing (the closing adjustment aligned it). The teller counts again anyway; if the count differs, they must say why. A first-ever day has no yesterday and uses `go_live_balance`.
- **Six reconciled figures per phase**: cash, total top weight, total down weight, value of goods, debts owed to the branch, amounts the branch owes. Each gets a `day_reconciliations` row with expected, actual, difference and outcome. **The database computes `balanced` / `surplus` / `shortage`**, so no client can mislabel it.
- **A difference needs an explanation** of at least 5 characters from the teller, enforced by a CHECK constraint, not only by the screen.
- **Closing requires the confirmation.** The teller ticks a mandatory box under the notice "I confirm that I have physically verified and accounted for the cash, total top weight, total down weight, value of goods, debts owed to the branch and amounts the branch owes, as reported above...". The exact wording and its version are stored on the day. A `CHECK` constraint makes it impossible to set a day to closed without it. The notice is versioned in code (`ClosingConfirmation`); wording changes add a new version, never edit an old one.
- **Manager sign-off** is `pending` when anything did not balance, never blocks the next day, and records who decided and when.

## Goods movements (transfers)

A transfer moves **either goods or cash** in one direction, and is a document with a lifecycle and a permanent event trail. When a person from Kumasi brings cash to a branch and takes goods back, those are **two independent transfers sharing a `visit_id`** (and the same collector). They are never linked as payment for each other: the cash may be more or less than the goods are worth, and the system does not net them.

```
draft --> released --> received
                  \--> received_with_discrepancy
draft/released --> cancelled (reason required)
```

It records:

| Question                                                         | Where it is answered                                                                                                                                                                          |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who released it                                                  | `released_by`, `released_at`, `release_note`                                                                                                                                                  |
| Who collected it                                                 | `collector_type` staff (a user) or external (name, phone, ID type/number, relationship, e.g. "sent by Kumasi manager"), `collected_at`                                                        |
| Who received it                                                  | `received_by`, `received_at`, `receipt_note`                                                                                                                                                  |
| Origin, destination, dates and times                             | `origin_branch_id`, `destination_branch_id`, created / released / collected / received timestamps                                                                                             |
| Total top, down, value (goods) or amount (cash)                  | `declared_*` (frozen at release, from the lines) and `received_*` (what the receiver confirmed or counted)                                                                                    |
| Which gold exactly                                               | `transfer_goods_lines`, each pointing at a customer's transaction item (so "where did this customer's gold go" has an answer) or, for legacy/bulk stock, carrying a description               |
| Small payments made because of it (transport money, for example) | `transfer_payments` (method, purpose, external reference) with note-level ledger rows for cash                                                                                                |
| Method and purpose                                               | `method` (collector from destination, staff travelling, designated courier, branch delivery, other), `purpose` (stock collection, restock funding, cash return, payment on collection, other) |
| Everything that happened, in order                               | `transfer_events` (append-only): created, goods added, collector set, released, payment recorded, received, discrepancy flagged, note added, cancelled, attachment added                      |
| Proof                                                            | `attachments` (photo of the collector's ID, signed handover sheet)                                                                                                                            |

Goods leave the origin's ledger at release and enter the destination's ledger at receipt, **for the weights and value the receiver confirmed**. If they differ, each differing line becomes a discrepancy case. A transfer that is released and never received stays visible in "open transfers" (index `transfers_open`) so management sees goods in transit.

The customer item's `location_branch_id` / `location_state` (on hand, in transit) moves with the transfer, so any single item's journey is a short query.

### Who has sent what to whom

`gold.v_interbranch_position` shows, per pair of branches and direction: cash sent, mobile money paid on the other branch's behalf, and goods value sent. Cash and goods going opposite ways are shown side by side; settling them against each other is a management decision, so the system does not assume it.

## Paying a customer: cash, mobile money, or owed

A transaction's amount payable can be split across `gold.transaction_payments`:

- **cash** from the drawer (note-level ledger rows, as before),
- **mobile money** sent by a branch, usually Kumasi, on request. It names the sending branch and the mobile-money reference, and is `pending` until Kumasi confirms (or `failed`, in which case another way of paying must cover that part),
- **owed**: not paid yet. A payable is created for the customer (`debts` with `direction = 'payable'`, linked to the transaction) and shows on the branch's books until settled by cash or mobile money.

The database refuses a transaction whose payments do not add up to the amount payable. Mobile money paid by Kumasi for a Tarkwa customer appears in the inter-branch position.

## Discrepancies: review without losing the record

Surplus, shortage and transfer differences automatically open a case (`gold.discrepancies`). The original reconciliation row, ledger entries and transfer lines are never touched.

- A case moves `open -> under_review -> resolved | written_off` (and can be reopened). **The database logs every status change itself** (trigger), so history is complete even if the app forgets.
- Admins add notes, assign it, attach evidence (`discrepancy_actions`, append-only).
- Closing a case requires a real written resolution (10+ characters), who resolved it and the type (explained, found, recovered, corrected entry, written off).
- If the resolution changes a balance (the missing note turns up), it is a new `discrepancy_resolution` ledger entry linked to the case. The original shortage still shows, along with how it ended.
- The facts of a case (expected, actual, difference, the teller's explanation) cannot be edited.

## Multi-company, access and audit

- Every table carries `tenant_id`; foreign keys include it, so a row cannot reference another company's data. Row-level security restricts each connection to its company (`SET LOCAL app.tenant_id` per request). The application connects as a login with no structure-changing rights.
- Roles and permissions are data per company (`resource:action`), with per-user overrides, so a company can change who may close a day or set the Kumasi value without a release.
- `gold.audit_events` is written by the API for every business action (who, what, when, from where, before/after). It is append-only.
- Idempotency keys make every write safe to retry after a lost connection.

## Who sees what (default, adjustable per company)

| Role     | Sees                           | Can do                                                                                                                                           |
| -------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Teller   | their branch(es)               | transactions, drawer movements, open/close their day with confirmation, explain differences, create transfers, record receipts they are assigned |
| Manager  | branches assigned (all, today) | everything a teller can, sign off days, review and resolve discrepancies, release/receive transfers, see any branch timeline                     |
| Director | everything                     | all of the above, approve prices, manage users and roles, write off discrepancies                                                                |

## Two more customer flows (noted 2026-10-23, built in B3)

**A. A customer settles a debt with gold.** The gold goes through the normal valuation, so it gets a monetary value. That value is applied to what the customer owes:

- equal to the debt: debt cleared, no cash moves;
- less than the debt: the customer adds cash (or mobile money), or leaves the rest owing (the debt stays, reduced);
- more than the debt: debt cleared, and the customer is paid the difference like any payout (cash, mobile money, or owed).

Design: a new payment kind `debt_offset` in the payout split (alongside cash, mobile_money, owed). Each offset creates a `debt_repayments` row with method `gold` pointing at the purchase transaction, so the debt's history shows which gold paid it. Ledger effect: goods in (what was paid for them, as usual), receivable down by the offset. The split rule still holds: all parts add up to the value of the gold.

**B. Loan against unrefined gold.** The customer brings unrefined gold; only its top weight is taken. The branch keeps it and gives the loan. This is custody, not a purchase: it has no value yet, it is not "goods bought", and it must not inflate the goods-value figure.

Design: a `collateral_holdings` record (customer, branch, top weight, linked loan debt, received by, released when) and a separate ledger asset `custody_top` so the closing reconciliation can count it physically without valuing it. When the customer returns, the gold is refined and valued like a normal purchase (this is when it becomes goods), and flow A applies: the value is used against the loan, the customer tops up, leaves some owing, or receives the surplus. Handing the gold back unchanged without refining is also possible, and is recorded as a release.

Effects on earlier decisions: the closing confirmation will need a seventh figure (custody top weight), added in B4 together with its wording (v3). Nothing already built needs changing.

## Decisions

Confirmed by the business:

1. **Debts go both ways.** Money owed to the branch, and money the branch owes a customer (gold brought, not enough cash). Both are reconciled at close.
2. **Value of goods** is what was paid for them.
3. **Who may receive** a transfer at the destination: a user with the receive permission there; not someone from the origin branch.
4. **Cash from Kumasi and goods taken away are independent.** Same trip, two movements, never paid against each other.
5. **Mobile money**: a customer may be paid some or all by mobile money, which Kumasi sends on request.

Still open:

6. **After goods reach Kumasi** they stay on Kumasi's books as goods. What happens next (sale, export, refining) is not modelled until we know.
