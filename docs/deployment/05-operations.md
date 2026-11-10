# 05 - Operating Gilded

All commands run in the `deploy` folder (on the server, or in PowerShell on the laptop).

## Daily facts
- Status: `docker compose ps`
- Logs: `docker compose logs api --tail 100` (add `-f` to follow)
- Restart one piece: `docker compose restart api`
- Disk use: `df -h` (server), `docker system df`

## Backup and restore
- Backup now: `bash ./scripts/backup.sh` (files in `deploy/backups`, newest 14 kept).
- Restore: `bash ./scripts/restore.sh backups/gilded-<date>.sql.gz` - replaces everything, asks you to type YES.
- Test restore on a laptop: install per guide 01, start the stack, copy the file in, restore. Check you can log in and see yesterday's records.
- Keep copies off the server, and keep `.env` in the password manager.

## Update to a new version
```
bash ./scripts/update.sh
```
It backs up, pulls the new code, rebuilds, applies new database changes, restarts. Do it outside trading hours. Database changes are additive and recorded; the `migrate` job runs before the API starts, so a failed migration stops the update and leaves the old API running - read `docker compose logs migrate`.

**Rollback:** `git log --oneline` to find the earlier version, `git checkout <id>`, `docker compose up -d --build`. If the new version already changed the database, restore the backup that `update.sh` made first.

## Add a branch / user
In the app as a director (*Branches*, *Users*). The new branch's access applies after that director logs in again.

## Security routine
- Different long random passwords; `.env` readable only by the admin (`chmod 600 .env`).
- Only ports 22, 80, 443 open; SSH keys only.
- Server updates: `sudo apt update && sudo apt upgrade` monthly (automatic security updates are on if you installed `unattended-upgrades`); reboot if asked.
- Update Docker images monthly: `bash ./scripts/update.sh` (rebuild fetches fresh base images).
- Leavers: deactivate their user the same day.
- Customer data is personal data under Ghana's Data Protection Act, 2012 (Act 843): keep access limited, backups protected, and registration with the Data Protection Commission current.

## Troubleshooting
| Symptom | Likely cause and fix |
|---|---|
| `docker: command not found` / "cannot connect to the Docker daemon" | Docker Desktop not running (laptop) - start it and wait for "Engine running". |
| `set POSTGRES_PASSWORD in .env` | `.env` missing or a line empty. Copy `.env.example` to `.env`. |
| Port 80 already used | Set `HTTP_PORT=8080` in `.env`, restart, open `http://localhost:8080`. |
| `db` keeps restarting, mentions `00_roles.sh` or `\r` | Windows line endings in `db-init/00_roles.sh`. Convert to LF, then `docker compose down -v` (demo only!) and up again. |
| Changed DB passwords in `.env` after first start; API cannot log in | The database keeps the first passwords. Demo: `docker compose down -v` and start again. Live: change them inside the database (`ALTER ROLE ... PASSWORD`) to match. |
| `migrate` fails | `docker compose logs migrate`. Send me the last 30 lines. |
| Login says wrong company/user | `COMPANY_SLUG` must equal the `--company` you seeded. |
| Login works but you are logged out at once | `COOKIE_SECURE=true` on plain http (demo), or `false` on https. Match it to how you open the site. |
| Padlock/certificate missing | DNS not yet pointing at the server, or ports 80/443 closed. `docker compose logs web`. |
| Live updates stuck | WebSockets blocked by a proxy in front (a CDN or office proxy). Gilded's own Caddy passes them through. |
| Automatic price never applies | Open *Automatic price* > "See what the page says now". If the number is not found the site may draw it with JavaScript; tell me what the screen shows. |
| Site slow after a long time | Check `docker stats` and disk. 4 GB RAM is plenty for 1-5 branches; upgrade the server size in the host console (a reboot, no data loss). |

## Known limits (honest list)
- One API server only for now (live updates need a shared backplane before running several).
- Attachments (photos/files on transfers and cases) have no storage decision yet.
- Transfers already released cannot be cancelled.
- No role editor yet; standard roles only.
- The branch timeline recomputes balances per request - fine for pilot sizes.