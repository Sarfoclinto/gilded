# Gilded - improvement plan (from Sherlock's improvement.md, with additions)

Legend: (fix) a defect, (imp) improvement or UI update, (new) predicted need, not yet requested.

## Phase 1 - fixes (small, do first)
| # | Item | First suspicion (unverified) |
|---|---|---|
| 3 | (fix) Home still shows "price not set" after "Check and use" succeeds | Home reads a cached price query; the feed action does not invalidate it (or live event not handled). |
| 9 | (fix) New transfer: branch select is empty | Destination list probably filtered to the user's own branches, or the branches query needs a permission the teller/manager lacks. Needs a "branches I can send to" endpoint. |
| 12 | (fix) Mobile-money payment shows only own branch | Likely the same cause as 9. Check together. |
| G1 | shadcn Select replaces every non-antd select | Build one shared `Select` wrapper first, then swap usages one screen at a time. |
| 11/13 | Denomination forms: optional "typed total" field | Informational only; shows a gentle mismatch note if it differs from the notes counted; never used in the ledger. |

## Phase 2 - design system and shell (do before screen redesigns)
- Shared tokens, spacing, typography, empty/loading/error states, one table component (filter, sort, pagination), one detail-page layout.
- 2 Header/navbar redesign, all screens, phone and desktop.
- 4 Login and change-password pages.

## Phase 3 - screens
- 1 Role dashboards (teller, manager, director): see "Dashboards" below.
- 5 All Transactions: server-side filter (date range, branch, customer, status, amount, who), sort, pagination, saved filters, export (exists).
- 6 Transaction detail page.
- 7/8 Customer page and customer transactions (same table component, filtered to the customer).
- 10 Transfer pages (list, new, detail).
- 11 Open/close day screens.

## Dashboards (item 1)
- **Teller:** today's purchases (count, grams, GHS), drawer balance and float, current price and when it changed, pending items (offline queue, transfers to receive), quick actions.
- **Manager:** branch day at a glance, cash vs gold position, differences awaiting sign-off, staff activity, debts due, price approvals.
- **Director:** all branches comparison, trend charts (purchases, volume, average rate vs market), gold held, cash exposure, open differences, transfers in transit, price-feed health.

## Predicted needs (new) - what users will probably ask for
Ranked by my guess of value, highest first:
1. **Receipts:** printable/PDF receipt (A4 and 58/80 mm thermal), share by WhatsApp. Customers expect proof.
2. **Customer identity:** Ghana Card / ID number and optional photo, with a duplicate-customer check; many regulators and buyers ask for it.
3. **Selling / refining batches:** record gold sold on or sent to refiner, with price and proceeds, so profit and loss per batch is visible. Today the system shows buying only.
4. **Daily and monthly reports:** end-of-day summary PDF, purchases by agent/branch/customer, margin report, cash report.
5. **Price override approvals and fraud flags:** buying above/below the day's rate needs a reason or approval; alerts for unusual weights, same customer repeatedly, rapid sales near closing.
6. **Roles editor and audit-log viewer:** directors define roles; every action searchable by who, what, when.
7. **Float and cash top-up requests:** a teller asks for cash; the manager approves; it is recorded as a movement.
8. **Field agents / suppliers:** agents who bring gold, commission rules, advances against future gold.
9. **Notification centre improvements:** unread badges, "needs my action" list, optional push.
10. **Session safety:** auto-lock after idle, quick PIN to unlock, shift handover note.
11. **Mobile money reconciliation:** match provider statements to recorded payments.
12. **Global search** (customer, receipt number, phone), keyboard shortcut.
13. **Backups/system status page** for directors (last backup, price feed health, version).
14. **Installable app (PWA)** and clearer offline indicators ("3 waiting to sync").
15. **Dark mode**, larger text option for counter use, optional Twi labels.
16. **USD view** next to GHS, with the GoldBod rate already fetched.
17. **Customer statements:** printable list of what a customer sold, owes or holds.

## Scenarios to design for (separate walk-through)
Offline mid-purchase; same record edited on two devices; teller closes with a cash difference; transfer arrives short; price feed fails or jumps; user leaves the company; wrong customer chosen after saving; wrong weight keyed; power cut during close-day; clock wrong on a device; duplicated submit on a slow network; backup restore after a bad release.

## Queued (agreed, not started)
- **Town carat hints (steps 2-4 of the origin-town idea):** "usually 22 high here" on the transaction page and on the customer, a news/feed for new tellers, an "unusual for this town" flag, and a manager screen to rename/merge towns. Needs a few weeks of collected data; plain statistics first, ML only if they are not enough.
- **General note exchange (drawer change):** a screen, separate from changing a customer's notes after a purchase, for a branch to swap notes for its own needs (smaller notes to give change, bigger notes to hand out fewer). Out must equal in, in and out must be different notes, it must be a drawer movement so the count stays right, and every one writes an audit entry. Builds on the existing `exchange` movement kind (0037), which today links to a purchase; this one has no purchase. Decided: it is a new permission that a manager can give to any role or person (not tied to days:manage); no reason is required; no second person needed for now (revisit if exchanges get large).