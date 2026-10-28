# B7e - Deployment pack

New files (path from the repository root):
- `deploy/Dockerfile.api`, `deploy/Dockerfile.web`, `deploy/Caddyfile`, `deploy/docker-compose.yml`, `deploy/.env.example`
- `deploy/db-init/00_roles.sh` (creates the two logins and the database on first start)
- `deploy/scripts/{backup,restore,update,first-company}.sh`
- `deploy/demo-data/{customers,past-purchases,opening-gold,opening-debts}.csv`
- `.dockerignore`, `.gitattributes` (keeps `.sh` files LF on Windows), `.github/workflows/ci.yml`
- `docs/deployment/{00-overview,01-install-docker-windows,02-run-demo-on-laptop,03-hosting-and-costs,04-go-live-checklist,05-operations}.md`
- `web/src/features/imports/demoData.test.ts` (the demo CSVs must always pass the import parsers)

Changed: `README.md` (rewritten, mock text removed).

No application code changed.

Tested: web tests (incl. demo CSVs), web production build, compose file validity, YAML/shell syntax.
Not tested (no Docker engine or .NET here): image builds and first start; `dotnet test`; the CI workflow. Your first `docker compose up -d --build` is that test.