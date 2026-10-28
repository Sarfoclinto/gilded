# Gilded

An offline-first gold buying and valuation system for companies with several branches: purchases priced by the sheet formula, cash drawers, transfers between branches, debts and held gold, an immutable ledger, review of differences, imports from paper/Excel, Excel export, and an automatic GoldBod price.

| Folder | What |
|---|---|
| `core-ts/` | Pure calculation engine (ExcelV1) and note solver. |
| `web/` | React + TypeScript app (Vite, Tailwind, antd, React Query). |
| `backend/` | ASP.NET Core API, PostgreSQL migrations (`backend/db`), tests. See `backend/README.md`. |
| `deploy/` | Docker files, compose, Caddy, backup/update scripts, demo CSV data. |
| `docs/deployment/` | Step-by-step guides: install, demo, hosting and costs, go-live, operations. |
| `docs/openapi.yaml` | API contract. |
| `vectors/` | Golden test vectors shared by the TypeScript and C# calculators. |

## Run the whole thing (Docker)
Follow `docs/deployment/01-install-docker-windows.md`, then `02-run-demo-on-laptop.md`. In short:
```
cd deploy
copy .env.example .env      # then edit the passwords
docker compose up -d --build
```
and open http://localhost.

## Develop
```
npm install
npm test            # core + web
npm run typecheck
npm run dev         # web on http://localhost:5173, needs the API running (see backend/README.md)
```
Set `VITE_API_URL` in `web/.env.local` if the API is not on `http://localhost:5080/api/v1`.

Database tests: `backend/db/run-tests.sh -h localhost -U postgres`. API tests: `dotnet test backend/GoldValuation.slnx`.