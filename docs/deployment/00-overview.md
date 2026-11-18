# Deploying Gilded - overview

Read this first. It explains the parts, the three stages, and which guide to open next.

## What you are deploying

Gilded is four pieces. Docker runs each in its own sealed box ("container") so it behaves the same on your laptop and on a rented server.

| Container | What it is | Does |
|---|---|---|
| `db` | PostgreSQL 17 | Stores every record. Its data lives in a Docker *volume* (`dbdata`) that survives restarts and updates. |
| `migrate` | the API, run once | Applies database changes that have not been applied yet, then stops. Runs automatically on every start. |
| `api` | ASP.NET Core | The business rules, logins, price-feed worker, live updates. |
| `web` | Caddy + the built web app | Serves the screens, passes `/api` and `/hubs` to the API, and gets the HTTPS certificate on a real domain. |

Everything is described in `deploy/docker-compose.yml`. One command starts it all: `docker compose up -d --build`.

## The three stages

1. **Demo on your laptop (free).** Guides 01 and 02. Docker Desktop, the project, real data loaded through the import screens. Use it to convince your boss.
2. **Pilot on a rented server.** Guides 03 and 04. One small server, a domain, HTTPS, nightly backups. Cost: roughly GHS 2,000-2,700 per year (see 03).
3. **Operate and grow.** Guide 05. When branches get the desktop app, guide 07 adds installer hosting, a code-signing certificate (about US$150-300 a year) and a per-branch setup; the server itself does not change. Updates, backups, restore, monitoring, adding branches.

## Order of guides

| File | Open it when |
|---|---|
| `01-install-docker-windows.md` | You have nothing installed yet. |
| `02-run-demo-on-laptop.md` | Docker works. Includes the demo script for the meeting. |
| `03-hosting-and-costs.md` | Preparing the funding request. |
| `04-go-live-checklist.md` | Funding approved: server, domain, HTTPS, firewall. |
| `05-operations.md` | The system is live: backups, updates, trouble. |
| `09-updates-and-releases.md` | You are live and want to change something: laptop, rehearsal copy, night install, rollback. |
| `12-company-website.md` | Putting the company website on gildedgold.org (and www). |
| `13-offsite-backups-b2.md` | Sending encrypted backups to Backblaze B2 (or another S3 storage) and practising a restore from there. |
| `07-desktop-app-and-branch-hub.md` | Branches will use the Windows desktop app and the shared branch drawer (hub): installer, signing, router, firewall, cost. |

## Words you will meet

- **Image**: a frozen recipe for a container (built from a Dockerfile).
- **Container**: a running copy of an image.
- **Volume**: storage that stays when a container is replaced. Your database lives here. Deleting the volume deletes your data.
- **Compose file**: the list of containers and how they connect.
- **`.env`**: a small text file with your passwords and settings. Never share it.

## What has and has not been tested

- Database migrations and all 17 database test files: tested.
- Web app (tests, type check, production build): tested.
- Demo CSV files: tested automatically against the real import parsers.
- Compose file: checked for validity.
- **Not run by me (no Docker engine or .NET in my workspace):** the actual image builds and the first start. Expect that your first `docker compose up` is the real test; Troubleshooting in `05-operations.md` lists the likely snags. If anything fails, send me the last 30 lines of output.
- The GoldBod price reader has not been tried against the live website; check it with "See what the page says now" on the Price feed screen.