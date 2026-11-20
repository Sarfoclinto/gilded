# Group Sheets: private running records for a chosen group (concept and design)

Status: PHASE 1 BUILT in B74 (v1.21.0) and PHASE 2 in B75 (v1.22.0). Decisions in section 12 (18 Nov 2026). Phase 3 ("maybe later") not scheduled. Feasible: yes. It reuses the privacy machinery of My pictures and Workings, and the offline sending of purchases.

## 1. What it is
Some money at a branch is real and needs a record, but it is not the gold business and it is not the directors' concern. Examples: mercury sales, the kitchen fee pot, staff savings, a welfare fund. Today it lives in a notebook or in someone's head.

**Group sheets** gives that money a home in the app:
- A **group** is a set of chosen people.
- The group keeps **sheets**, one per pot: "Kitchen fees", "Mercury sales", "Savings".
- A sheet is a running record. Every entry **adds to or takes from** the amount, with a short optional note. The sheet always shows the balance and how it got there.

```
 Kitchen fees · Anyanso                      ┌──────────────────────┐
 ───────────────────────────────────────     │  Balance             │
                                             │  GHS 1,240.00        │
  Today, Wed 18 Nov            +150   −40    │  +150 today · −40    │
   + 100   Ama paid (week 47)    Kofi 09:12  └──────────────────────┘
   +  50   Yaw paid              Kofi 11:40   [ + Add ]   [ − Take out ]
   −  40   Gas refill · receipt  Esi  14:05
  Tue 17 Nov                   +320    0
   + 320   Day total             Kofi 17:30
   …
```

## 2. Who can see it: the main rule
**A group's sheets are seen only by its members.** No role in the company unlocks them: not director, not admin, not the person who manages users. This is the same promise as My pictures, enforced by the database itself (row-level security), not just by hiding screens.

What everyone else sees:
- **People who are not members** never see the group, its name or its sheets, and get no menu entry for it.
- **Company admins** see nothing: not the groups, their names, their members or their figures. An admin who is added to a group sees exactly what that membership allows, like anyone else (decision 1).
  - The one exception is a group that has lost its last keeper (section 7). Admins then get a notice naming that group and its remaining members, so they can name a new keeper. They still never see its sheets.
- **The server operator (us)**: the data sits in the same database and the same encrypted backups. This keeps it safe and recoverable, but it is privacy *inside the app*, not a vault. The design review should say this plainly.

## 3. Members and what they may do
Each member has one of three roles in the group:

| Role | What they can do |
|---|---|
| **Keeper** | Everything a writer can do, plus: add or remove members, change roles, create, rename or close sheets, and decide who sees which sheet. A group always has at least one keeper. |
| **Writer** | Read and add entries to the sheets they can see. They can also take back their own entries (section 5). |
| **Reader** | See the sheets they are allowed to see. They cannot change anything. |

**Two ways to add people** (both can be used in one group):
1. **Handpicked.** Choose people by name. They stay members until removed.
2. **By branch.** For example: "Everyone who works at Anyanso, as readers." Membership then follows the staff list on its own:
   - someone posted to Anyanso joins automatically, with the role the rule gives;
   - someone who leaves the branch, or whose account is switched off, drops out automatically.

   A keeper can still change one person's role or leave one person out ("everyone at Anyanso except the guard").

**Access per sheet.** By default a member sees every sheet of the group with their group role. A keeper can narrow it for any sheet, by person or for everyone:
- *see and write*;
- *see only*;
- *not see*. The sheet then does not appear for them at all.

So one group can hold "Kitchen fees" (everyone at the branch can see it) and "Savings" (only the two people who run it).

**Joining and leaving.** A person added to a group gets a notification: "Esi added you to Anyanso staff, as a writer". Anyone may leave a group, except the last keeper (section 7). Removing someone takes effect at once on every device, the next time it connects.

## 4. Sheets
A sheet has these settings:
- **Name.** Example: Kitchen fees.
- **Branch** (optional, for the label and the filter).
- **Opening balance** (optional, with its date), so a notebook that is already running can be carried over.
- **Kind** (phase 1 has the first one only):
  - **Money.** One balance in cedis. Fits kitchen fees, mercury sales in cedis, a welfare pot.
  - **Money per person** (phase 2). One balance for each named person, plus the total. Fits savings: Ama has 400, Kofi 250, total 650.
  - **Money and quantity** (phase 2). Each entry also carries an amount of something with its unit. Fits mercury: "−0.5 kg, +1,800 cedis". The sheet then shows both what is left and the cash.

A sheet can be **closed**: kept and readable, but no new entries. A sheet is never deleted while it holds entries, because the record is the point. A sheet with no entries can be deleted.

## 5. Entries: how money goes in and out
- **Two big buttons:** **+ Add** and **− Take out**. The amount, an optional note (up to 140 characters) and the date (today by default) are filled in, then Save.
  - **Day total**: a switch on the Add form that labels the entry "Day total". This covers a branch that collects all day and writes one figure at closing.
  - Whether to write each payment or one total per day is the group's choice; the sheet accepts both.
- **Taking out more than the balance** is allowed, with a warning ("The balance will be −60"). Real life sometimes runs ahead of the record. A negative balance shows in red.
- **Every entry shows** who wrote it and when. The time of writing is kept separately from the date the money moved, so a late entry ("for Monday, written on Wednesday") is visible.
- **No editing, no deleting.** A mistake is put right by **taking the entry back**:
  - a writer can take back their own entries; a keeper can take back anyone's;
  - the app adds an opposite entry linked to the first, and both show struck through with "Taken back by Kofi, Wed 18 Nov";
  - the correct entry is then written fresh.
  - This keeps the balance honest and the history complete. It matters because these are pots of other people's money, and arguments about them are exactly what a record is for.
- **Works offline**, like purchases. An entry made with no connection is saved on the device and sent when the connection returns. Until then it shows "Waiting to send" and the balance is marked "on this device".
  - Entries only ever add to the record, so two people writing on two devices at once never clash. Each entry is sent once, even if the connection drops halfway.

## 6. The screens
- **Group sheets** page, reached from the account menu and search. The menu entry shows only to people who are in a group, or who may create one.
  - A card per sheet the person can see. Each card shows the balance, today's in and out, the last entry, and its group and branch.
  - People in several groups see a group switcher at the top.
- **A sheet**:
  - the balance in large type;
  - in and out for today, this week and this month;
  - the entries grouped by day, newest first, each day with its own in, out and closing balance;
  - filters for dates and for "only takings out";
  - the + Add and − Take out buttons fixed at the bottom on a phone.
- **Group settings** (keepers only):
  - members and branch rules, each person's role;
  - the sheets and who sees which one: a simple table of people against sheets, with *write / see / —* in each cell;
  - closing sheets.
- **Activity** (any member): who joined or left, roles changed, sheets created or closed, and entries taken back. It is the group's own log, seen only by its members.
- **Print and export** (phase 2): a sheet for any period, as a printed page or a CSV, with opening balance, entries and closing balance.

## 7. The hard cases
- **The last keeper wants to leave.** They must first make another member keeper. The app explains this rather than just refusing.
- **The last keeper's account is switched off**, for example when someone leaves the company. The group would be locked, so (decision 2):
  - the app warns while a group has only one keeper ("Add a second keeper");
  - once the group has no keeper, company admins get a notice, "Anyanso staff has no keeper", listing the group's name and remaining members only;
  - an admin names a new keeper **from those members**; the notice then disappears and the admin sees nothing more of the group;
  - the naming is written in the group's activity log, so its members see who did it;
  - if no members remain, the group is frozen as it is: readable by nobody, kept for the record, and never shown to admins.
- **Someone is removed while offline with unsent entries.** The entries were written while they had the right to write, so they are accepted and marked "sent after removal" on the entry and in the activity log (decision 3). A keeper can take them back if they are wrong.
- **Branch rule and handpicked both match one person.** The handpicked role wins, because it was a deliberate choice about that person.
- **Fraud or a dispute.** The history cannot be changed, and every entry and every taking back names a person. That is the protection. Admins cannot step in (that is the design), so a group that needs an outside check should add that person as a reader.

## 8. What it is not
- **Not the gold books.** Group sheets never touch the cash drawer, day closing, purchases, debts or company reports, and a purchase never depends on them.
  - If kitchen money physically sits in the branch drawer, the drawer does not know. Agreed: keep the two separate for now, with the money in its own envelope or box (decision 4). A later version could offer "moved to or from the drawer" as a linked entry on both sides.
- **Not a bank or savings product.** It records what people say happened. It holds no money and computes no interest.
- **Not a spreadsheet.** One running balance per sheet, entries with notes. For anything bigger, use Workings (scratch) or a real spreadsheet.

## 9. How it would be built
- **Database**, new tables:
  - `gold.groups`;
  - `gold.group_members` (person, role, how they joined: handpicked or by branch, any per-person exception);
  - `gold.group_branch_rules` (branch, role);
  - `gold.group_sheets`;
  - `gold.group_sheet_access` (the per-sheet narrowing);
  - `gold.group_entries` (append only: sheet, signed amount, money date, note, writer, written at, the device's own id for sending exactly once, a link for taking back);
  - `gold.group_events` (the group's log).
- **Who may see what.** One function answers "what may this person do on this sheet": none, see or write. It combines membership, branch rules, the person's branches and accounts, and the per-sheet narrowing.
  - Row-level security on every table uses that function **with no exception for any company role**. This is the same approach as `gold.workings`, and it is what makes the promise in section 2 true.
- **Totals.** Balances and day totals are summed by the database on reading. A sheet with years of daily entries is still small: about 10,000 rows. An index on (sheet, money date) keeps that quick, so no stored balances can drift.
- **Offline.** On the device, the latest view of each sheet the person may see is kept for showing offline, like prices and debts. New entries queue like any other offline command and are checked on arrival: still a member, still allowed to write, sheet still open.
  - Being removed from a group also clears that group's sheets from the device on its next connection.
- **Permission to create groups:** a new permission, `groups:create`, given by default to directors and managers. A company can give it to anyone. Creating a group makes you its first keeper. It does **not** let you see anyone else's groups.
- **Notifications** (phase 2, per person and per sheet): "Tell me when money is taken out", or "… over GHS 500".
- **Size.** Entries are tiny. Receipt photos (phase 2) would use the existing photo storage, under the same group-only rule.

## 10. Phases
1. ✅ (B74) **Groups and money sheets:** groups, keepers, writers and readers, handpicked and by-branch members, per-sheet access, money sheets with opening balance, + Add, − Take out and Day total, notes, taking back, running balance and day totals, the activity log, offline, phone and computer, join and leave notifications.
2. ✅ (B75) **More kinds and reach:** money per person (savings), money and quantity (mercury), receipt photos on an entry, print and export, alerts on takings out, a Tools-panel tab for a quick entry beside any page.
   B75 choices: a savings sheet keeps its own list of people (a group member, or anyone by name), added and renamed by keepers, and starts at zero (each person's balance is brought over as their first entry); tapping a person shows their statement. A quantity sheet has one unit (kg, g…) and an optional quantity in hand; an entry may move money, quantity or both. Receipt photos (up to 5 per entry) live in their own table, seen only by those who can see the sheet, never in the Photos library or the audit trail; the person who added one, or a keeper, can take it off and the log says so. Alerts are per person and per sheet, any amount or from an amount up, only while the person can still see the sheet, never for one's own entries. Print uses the page itself; export is a CSV of the period on screen.
3. **Maybe later:** linked drawer entries (decision 4), a monthly summary sent to keepers, recurring entries (a fixed weekly fee), and sheets in other currencies.

## 11. Risks and honest limits
- **Admins cannot see it, by design.** If a group misuses it, nobody outside will know. That is the trade the request asks for. The safeguards are a history that cannot be changed and names on every line.
- **A record is only as good as what people type.** The app cannot know whether the 100 cedis was really paid. Entries that are written late, or taken back, are always visible.
- **Privacy is inside the app, not from the server operator** (section 2).
- **Branch rules move people in and out automatically.** That is convenient, but the group's notifications and activity log must make each change visible, so nobody gains or loses access unnoticed.

## 12. Decisions (agreed 18 Nov 2026)
1. **Admins see nothing** of a group, not even that it exists, unless they are added to it. They then see what their membership allows. The only exception: a group with no keeper left is shown to admins (name and remaining members only) so one can be named (decision 2).
2. **Last keeper gone:** an admin names a new keeper from the remaining members. The app warns while a group has only one keeper.
3. **Offline entries from someone removed before sending:** accepted, and marked "sent after removal".
4. **Drawer money:** kept separate for now.
5. **Who may create groups by default:** directors and managers (`groups:create`); a company can give it to anyone.
6. **Phase 1 is money sheets only.** Savings per person, and mercury with a quantity, come in phase 2.
7. **Name:** Group Sheets.