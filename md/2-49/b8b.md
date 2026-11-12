# B8b - shadcn select everywhere, optional typed total on note counts

New (under `web/src/`)
- `components/ui/select.tsx` - the shadcn/Radix select parts
- `features/drawer/checkTotal.ts`, `features/drawer/checkTotal.test.ts`

Changed
- `shared/ui/SelectField.tsx` - now the shadcn select. Same call shape as before (`value`, `onChange={(e) => e.target.value}`, `<option>` children), so the 26 existing uses needed no edits. New `SelectInput` for selects without a label.
- `layouts/BranchSwitcher.tsx`, `features/review/pages/BranchTimelinePage.tsx`, `features/calculator/PayoutPanel.tsx` - the remaining raw `<select>`s now use `SelectInput`.
- `features/drawer/NoteCountInput.tsx` - optional "Total you were given or expect" box under the note count. It only compares: matches, or says how much the notes are over/under. Never sent or saved. It appears everywhere notes are counted (open/close day, top-ups, loans, repayments, transfers, mobile-money resolution).

Antd selects (the import screen) are unchanged, as you asked.

Tested here: type check, 72 web tests, production build, and a real-browser check (Chromium) that the select opens above an antd modal, lists options and selects. Not checked by eye: every screen on a phone. Please click through one form of each kind.