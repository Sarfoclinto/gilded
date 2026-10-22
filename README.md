# Gold valuation

Monorepo (npm workspaces).

| Folder | What |
|---|---|
| `core-ts/` | Pure calculation engine (ExcelV1) and note solver. No UI, no database. |
| `web/` | React + TypeScript app (Vite, Tailwind, React Query, axios, zod, zustand). |
| `vectors/` | Golden test vectors shared with the C# backend: 18 sheet rows, solver cases. |
| `docs/openapi.yaml` | API contract. The mock and the zod schemas follow it. |

## Run it
```bash
npm install
npm test            # core: 18 sheet rows + solver vs brute force
npm run typecheck
npm run dev         # web on http://localhost:5173, uses the in-browser mock API
```
Mock logins (password `gold`): `director`, `manager`, `teller` (teller sees only Tarkwa).
`npm run dev` uses the mock automatically (see `web/.env.development`). To use the real API, create `web/.env.local` with `VITE_USE_MOCK=false` and `VITE_API_URL=...`.

## Try the offline behaviour
In the header, the green "Online (demo toggle)" badge pretends the server is unreachable when tapped. Save a transaction
while "Offline", reload the page (it survives, it is in IndexedDB), then tap the badge again: it syncs, gets its number
(e.g. TKW-20261022-0001) and the "waiting" chip disappears.

## Try the cash drawer
1. Sign in as `teller` (Tarkwa), go to **Cash drawer**, **Open the day** and count the notes. Until a day is open, saving a transaction is blocked.
2. Take the demo offline and save a payout or two. The drawer balance drops straight away (it is the server's last answer minus what is still waiting on this device), and the payout screen only offers notes the drawer still holds.
3. **Close the day**, enter what you really have. A difference needs a reason and makes the day wait for a manager (`manager` or `director`) to **Sign off** in Day history. A pending sign-off never stops the next day.
Mock data lives in your browser's localStorage (`mock.*`); clear site data to start over.

## Web structure
```
web/src
  app/            providers (query, auth), router and guards, route table
  config/         paths.ts (every URL), permissions.ts (resource:action keys)
  features/       auth, branches, prices, calculator, transactions, drawer, dashboard (each owns its api, hooks, pages)
  layouts/        AppShell (phone tabs, desktop rail, branch switcher, online badge)
  shared/api/     client (validated requests, ApiError, refresh), hooks, createResource (CRUD helper)
  shared/ui/      small components
  shared/offline/ connectivity, outbox (IndexedDB command queue), OutboxProvider
  mock/           in-browser API for development
```
Adding a page: create it under `features/<name>/`, add one entry to `app/router/routes.tsx` with its `access` rule.

## Calculation (ExcelV1), every step truncates
density = floor2(Top/Down); baseKarat = floor2((density-10.51) x 52.838 / density);
karat = floor2(baseKarat x (1-0.007)); purity = floor4(karat/24); net = floor2(purity x Top);
pounds = floor2(Top/7.75); amount = floor0(price x karat x pounds / 23).
