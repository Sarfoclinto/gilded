# Workings: a freeform scratch sheet for rough calculations (concept and design)

Status: DESIGN ONLY. Not scheduled; added to the backlog. Feasible: yes, and most of the pieces already exist in the app.

## 1. What it is
Your picture of OneNote is right, with one extra idea that makes it better than a notebook: **the figures know about each other.** A person opens a blank sheet, taps anywhere, types a figure and a label, and can build a result from other figures on the sheet. Like paper, but the arithmetic is done for you and stays correct when a number changes.

## 2. How a person uses it
- **Drop a note anywhere.** Tap or click on an empty spot of the sheet and type. A note is one line, for example `Weight 12.4 g`, `Price 1,210 /g` or just `rent`. The app reads a trailing figure (and unit, if any) as the note's value; the text before it is the label.
- **Move and tidy.** Drag notes around; select several to move, align or delete them. Pan and zoom the sheet (pinch, wheel, or two fingers), so it can be as big as paper wants.
- **Calculate by pointing.** Start a note with `=` and tap other notes to put them in: `= Weight × Price`. Their labels appear as chips; the result shows live in the note and updates when an input changes. Typing `=` and a plain sum, `= 12.4 + 3.1`, also works. Operators: + − × ÷, brackets, %, and the usual functions (sum, average, min, max, round).
- **Quick totals without typing a formula.** Drag a box around several notes: a small bar shows their sum, average, count, min and max. One tap turns that into a result note.
- **Name results.** Any result can have a label (`Total payable`), and then it can be used in another formula. A tiny arrow shows what depends on what, so a person can see where a figure came from.
- **Gold helpers (the part only we can offer).** In a formula the person can use: `purity(karat)` (karat/24), `pure(weight, karat)`, `today's price` (the approved price of the day, a chip they can tap in), and `cedis(grams × price)`. Units are light: g, kg, oz, GHS, %, karat. The app never guesses; if two units clash it says so.
- **Save, find, reopen.** Sheets are named ("Kwame, 3 chains"), listed with a small preview and last-edited date, searchable, duplicated, renamed, deleted. Edits save by themselves (a tick says "Saved on this device" and then "Saved").
- **Print or send away.** A sheet can be printed or saved as a picture or PDF, and (phase 2) shared with one colleague exactly like My pictures.

## 3. What it is not
Workings are **scratch**, not records. They never write to the books, never become a purchase, and a purchase cannot depend on them. The result of a working is copied into a form by the person (a "Copy result" button), so the books always hold the figure a person typed and a screen they confirmed. This matters for audit and is said on the page in one line.

## 4. Privacy
Same rule as My pictures: a sheet belongs to its owner, nobody else sees it (no role unlocks it), shared only by the owner to a named colleague, shares logged without content, real delete. It would reuse that machinery (owner-only table with row-level security, share table, notifications).

## 5. Where it lives
- A **Workings** page (`/workings`) with the list of sheets and the open sheet. Account menu entry, search entry, and a **Workings tab in the Tools panel** so a person can keep a sheet beside the purchase they are making (the panel already stays open beside any page).
- Phone: the sheet is a full-screen canvas with a bottom toolbar (add note, formula, select, undo); a note opens in a keyboard-friendly editor. It is usable on a phone but is at its best on a tablet or computer, and that should be said honestly in the design review.

## 6. How it would be built
- **Data**: one JSON document per sheet: `{ notes: [{ id, x, y, text, label, value, unit, formula }], view: { x, y, zoom } }` plus name, owner, times and a version number. Small (a few KB), so no file storage.
- **Formula engine**: our own small parser and evaluator (no `eval`), using exact decimal arithmetic (the app already has money-safe number helpers), returning clear errors ("Weight has no figure yet") and detecting circular references. Pure code, heavily unit-tested.
- **Canvas**: positioned elements inside a pan/zoom container (not a drawing library): selectable text, accessible, easy to print. Freehand pen is **not** in phase 1 (a good pen on every device is a project of its own).
- **Saving**: offline-first. Edits go to the device at once (IndexedDB) and sync to the server in the background, like pictures. One person editing on two devices: the newer save wins per sheet and the older version is kept as a copy ("Kwame, 3 chains (other device)") so nothing is silently lost.
- **Server**: `gold.workings` (owner-only RLS), list/get/save/delete functions, size limit per sheet and per person, company on/off switch and quota like My pictures.

## 7. Phases
1. **Sheets and formulas**: freeform notes, labels, formula by pointing, quick totals, gold helpers, save/list/open/rename/duplicate/delete, offline, print.
2. **Share and copy**: share a sheet with a colleague, "Copy result" into the purchase form, Tools-panel tab.
3. **Nice to have**: pen/ink on tablets, tables and groups, undo history across sessions, templates ("price a chain", "loan interest"), export to PDF/image with a title.

## 8. Risks and honest limits
- Freeform on a small phone screen is fiddly; phase 1 is designed for tablet and computer first.
- A formula language is a promise to be correct: money-safe decimals, no hidden rounding (the sheet shows how many places it keeps), and a test table of known answers checked against the existing calculator.
- Scope creep towards "a spreadsheet": we keep to notes and labelled results. Where someone needs rows and columns, the right tool is a spreadsheet, and we say so.
- Staff could do "real" figures here and skip the proper screens. Mitigation: the Copy result rule and the one-line notice.

## 9. Decisions needed before building
1. Phase 1 on tablet/computer first, phone usable but secondary: OK?
2. Gold helpers in phase 1 (recommended) or plain arithmetic first?
3. Private like My pictures, with sharing in phase 2: OK?
4. Pen/ink: skip for now?