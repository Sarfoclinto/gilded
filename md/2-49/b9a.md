# B9a - App shell: more room for the page

What changed
- **Sidebar:** narrower (232 px instead of 260), shorter rows, smaller section labels, the name/role block removed from the bottom (it lives in the header now). Starts as the slim icon menu on laptop screens under 1280 px wide until you choose otherwise (your choice is remembered). Brand shows "Gilded".
- **Header:** one slim bar (56 px). Desktop: where you are ("Between branches > Transfers") on the left; branch, connection, notifications and an account chip (initials, name, role) on the right. Phone: brand mark and branch on the left; connection shows as a dot.
- **Account menu:** now has "Change my password" (it was a menu item in Setup, removed from there) and Sign out.
- **Home:** tiles are two across on phones (price is full width), three across on desktop; smaller padding and type on phones.
- New: `crumbsFor` helper (with tests) that reads the header trail from the same menu data.

Files (under `web/src/`)
- `layouts/Header.tsx`, `layouts/Sidebar.tsx`, `layouts/BranchSwitcher.tsx`, `layouts/menu.tsx`, `layouts/menuFilter.ts`, `layouts/menuFilter.test.ts`
- `shared/ui/ConnectionBadge.tsx`, `features/notifications/NotificationBell.tsx`, `features/dashboard/DashboardPage.tsx`
- `store/ui.ts`, `styles/antd-theme.css` (new section 22 at the end)

Tested: type check, 75 web tests, production build, and screenshots of the real app (Chromium, fake data) at 1366, 1100 and 390 px wide. Not seen: real data, dark mode, tablet sizes.