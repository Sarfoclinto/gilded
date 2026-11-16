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

## Photos (in progress)
- **Photos inside the app, as smooth as WhatsApp or better.** Design and phased plan in `docs/PHOTOS-DESIGN.md`. Decided: files on a Hetzner volume; photos never required or blocking, a missing one is flagged to the reviewer; iPhones first, then Android, tablets, webcams.
  - [x] B60a spike: camera sheet, shrinking, background upload queue, viewer (`/photos-lab`), tested on real devices ("feels good as WhatsApp").
  - [x] B60 foundation: photos table facts + server volume, upload/list/serve/remove, transfer hand-over and receipt photos with the "no photo" flag, profile pictures, `attachments:remove`, backups include photos.
  - [x] B61 closing-day photo (scaled accumulated gold), including the offline day-close path.
  - [x] B62 Photos library page; purchase and customer ID photos (v1.14.0). Left: Share to WhatsApp, uploader filter in the UI.
  - [x] B63 evidence rules (v1.15.0): camera-only setting, reuse detection, Missing photos list, Share. Left: late-photo alerts, retention/archive (company decision), a "no photo" flag on purchases, perceptual (look-alike) reuse detection.

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
12. ~~**Global search** (customer, receipt number, phone), keyboard shortcut.~~ **Done in B54** (v1.7.0).
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
- **DONE in B55 (v1.8.0).** ~~World gold price chart (idea from Sherlock, like the NetDania screen):~~ a live chart of the world spot price, as an extra panel only.
  - **Widget:** TradingView's free "Advanced Real-Time Chart" embed (symbol `OANDA:XAUUSD` or `TVC:GOLD`, interval 60, timezone Africa/Accra, theme following the app). It brings its own data, so no price API. The default TradingView branding must stay on. In React: a small component that adds a `<script src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js">` with the JSON config in `useEffect`.
  - **Not the "Advanced Charts" library:** that one is self-hosted and only free for public sites with attribution; Gilded is a paid app behind a login, so use the embed widget only.
  - **Offline:** the widget does not work offline. Hide the panel when the branch is offline; never put it on a screen people need to do their work.
  - **Label it clearly** "World spot (USD/oz)": it is not GoldBod's price and must not be used for valuations.
  - **Second option (works offline):** chart our own stored GoldBod price history with `lightweight-charts` (Apache-2.0), showing the price the business actually buys at. Good setup is both: widget for world spot, lightweight-charts for our own history.
  - Where: a card on the director/manager dashboards, or a tab in the tools panel. To decide when picked up. Check TradingView's current widget terms before shipping.

## Product backlog (candidates for the next major updates)
- ~~Manager notice when entries are recorded short at a branch hub.~~ **Done in B50** (v1.3.0).
- ~~Offline day open/close.~~ **Done in B51 (server), B52 (screens), B53 (hub)**, v1.4.0–v1.6.0. Left to do: the two-computer test on real hardware with the network unplugged (B53 notes).
- Optional separate permission for branch computers.
- Edit conflicts for users, branches and roles.
- Branch overview showing the two-session status.
- Dashboard fixes: the owed-to-us direction filter and whole-cedi display.
- Small cleanups: CA warnings and an Npgsql bump.
- QR-scan offline pay.
- Town feature steps 3-4 (see "Queued" above).
- Optional held-price expiry/escalation.
- ESC/POS raw receipt printing.
- ~~World gold price chart.~~ **Done in B55** (v1.8.0). Left: email TradingView to confirm the widget may be used in a paid app behind a login; check the chart loads inside the desktop app.
- Before wide desktop rollout: a code-signing certificate for the Windows installer; real-hardware tests of hub failure; move the domain to the company account.
- Hub: an entry kept for a manager's review and applied on a later day may be counted once more by the hub (B53 limit); trim the hub's log file.
- ~~Global search.~~ **Done in B54** (v1.7.0). Possible later: search inside guide article text; a page of their own for a debt and for held gold so results open the exact record; measure speed on a large database.

## Asked for on 14 Nov 2026 (not started)
- ✅ **Done in B57 (feat-transfer-scaled). Transfers: totals of the selected gold, and the scaled weight.** After choosing the gold to send, show the total top and total down clearly (from the books). Then the sender puts all the selected gold on the scale together and enters the scaled top and down; both are recorded against the books' totals before the goods leave. Today the picker shows count, total top and value only, and nothing is weighed at sending (the receiver's weights are the first check). Done: totals panel, scale entry on hand-over, graded top (0.1/0.5) and down (allowance by pieces and weight, max 0.5), red notifies reviewers. Limits are fixed in `gold.scale_check`; make them settings if wanted.
- **Cash that arrives without a draft (from the bank).** A way to receive cash that no branch drafted, where the notes are only known on arrival. Today this can be recorded as "Cash in" on the drawer (counted notes + a note saying where it is from), but it is not shown with transfers and has no source of its own. To decide: a "Cash from the bank" record of its own (source, reference/slip number, who brought it) that lists with transfers and reports.
- ✅ **Done in B58 (feat-branch-performance). Branch performance over time (line chart).** Directors/admins: one line per branch in its own colour, over a chosen period, to compare branches. Tellers: only their own branch. To decide: what "performance" is drawn (cedis paid for gold, weight bought, number of purchases), with a switch between them. Done: `GET /dashboard/performance`, panel on both homes with Paid out / Weight / Purchases and 7 days to 12 months, chips to hide or single out a branch, read-out, table. Dates across the app now carry the weekday (`when`, `day`, dashboard dates). Open: weight in pounds or grams; weekday text in narrow columns.
- ✅ **Done in B56 (feat-cancel-purchase). Cancel a wrongly saved purchase.** Not possible today for staff (only an import can be undone). Needs: a reason, who may do it (manager approval), the cash and the gold put back by new ledger entries (the original is never edited), the receipt marked cancelled, the day's count explained. Done: permission `transactions:cancel` (manager/director), reversal by new entries, cash back into today's drawer, refused if gold moved / mobile money confirmed / no open day.
- **A customer who already owes asks for more.** Allowed today with no warning and no limit: each loan is its own debt. To decide: show what the customer already owes when lending, and optionally a company limit per customer or a manager's approval above it.

## Asked for on 15 Nov 2026 (not started)
- ✅ **Done in B64 (v1.15.1). Modernize the personal settings page (My settings).** Make it look nicer and more current: profile header with the picture, grouped cards (password, sign-in, device, preferences), better spacing on phones.
- ✅ **Done in B64 (v1.15.1). Login page refresh.** (Company settings and Change password got the same look in B64.) Make it nicer, and replace the plain `G` in a box with the real Gilded logo (also check the favicon, the header and the installer use the same mark).
  - Left from the login item: the printed receipt still has a plain `G`; it needs a one-colour version of the mark.
- ✅ **Phase 1 done in B65 (v1.16.0). My pictures, a private camera for every user.** Round camera button on every screen, a My pictures page only the owner can open (not even admins), real delete, quota and a company on/off switch. Design: `docs/personal-pictures-design.md`.
  - ✅ **Done in B66 (v1.17.0): sharing.** Share a picture with one named colleague (view and download), "Shared with me" tab, stop sharing, notification, audit lines for share and stop-share only.
  - Later (optional): attach a personal picture to a purchase or transfer as company evidence (a copy), encryption at rest, a "recently deleted" bin.

## Asked for on 16 Nov 2026 (design written, not scheduled)
- **Workings: a freeform scratch sheet for rough calculations (OneNote-like).** Tap anywhere to drop a labelled figure, build results by pointing at other figures (live formulas), quick totals, gold helpers (karat purity, pure weight, today's price), save/list/reopen sheets, print. Scratch only: never writes to the books; the person copies a result into a form. Private to the owner like My pictures. Design: `docs/workings-design.md` (feasible; phases 1 to 3; four decisions to confirm before building).