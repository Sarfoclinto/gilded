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
Set `VITE_USE_MOCK=false` and `VITE_API_URL` in `web/.env.local` to talk to the real API later.

## Web structure
```
web/src
  app/            providers (query, auth), router and guards, route table
  features/       auth, branches, prices, calculator, dashboard (each owns its api, hooks, pages)
  layouts/        AppShell (phone tabs, desktop rail, branch switcher, online badge)
  shared/api/     client (validated requests, ApiError, refresh), hooks, createResource (CRUD helper)
  shared/ui/      small components     shared/offline/  connectivity
  mock/           in-browser API for development
```
Adding a page: create it under `features/<name>/`, add one entry to `app/router/routes.tsx` with its `access` rule.

## Calculation (ExcelV1), every step truncates
density = floor2(Top/Down); baseKarat = floor2((density-10.51) x 52.838 / density);
karat = floor2(baseKarat x (1-0.007)); purity = floor4(karat/24); net = floor2(purity x Top);
pounds = floor2(Top/7.75); amount = floor0(price x karat x pounds / 23).
