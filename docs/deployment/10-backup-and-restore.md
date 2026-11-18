# 10 - Backups and restores (laptop and production)

A backup is one file, `gilded-YYYYMMDD-HHMMSS.sql.gz`, holding the whole database (customers, transactions, users, settings). It does **not** hold the `.env` file (passwords/secrets) - keep `.env` separately in a password manager.

Run every script as `bash ./scripts/<name>.sh` from the `deploy` folder. On Windows use **Git Bash**, not PowerShell (PowerShell's `bash` is the WSL launcher and fails).

## 1. The routine in production
> **From B71** the `backup` service takes over the nightly copy (01:30, newest 7 kept) and sends an encrypted copy off the server. Set it up with `13-offsite-backups-b2.md`, then remove the old cron line. The table below describes the older routine; the copies to your laptop and the practice restore still apply.

| What | How often | Where it lives |
|---|---|---|
| Nightly backup (cron, 02:00) | every night, newest 14 kept | server: `~/gilded/deploy/backups/` |
| Hetzner server backups | every night (the paid option you switched on) | Hetzner |
| **Copy to your own computer** | weekly, and before every update | a folder on your laptop + one other place (flash drive / cloud) |
| **Practice restore** | monthly | your laptop (section 4) |

A backup nobody has ever restored is only a hope. The monthly practice restore is the part that matters.

## 2. Take a backup now (server)
```
ssh deploy@2.31.136.48
cd ~/gilded/deploy
bash ./scripts/backup.sh
ls -lh backups
```
Last line shows `Saved backups/gilded-....sql.gz (size)`. A size of a few KB or more is normal; "Backup is empty" means stop and ask.

## 3. Download backups to your laptop (the scp errors)
Two causes of the errors you saw:
1. **The destination folder did not exist** ("No such file or directory").
2. **`C:\...` inside an scp command**: scp reads everything before the first `:` as a *host name*, so `C:\x` means "host C". Never put a `C:` path in an scp command. Go to the folder first and use `.` (meaning "here").

Run these on your **laptop** (not inside the ssh session).

**PowerShell**
```
mkdir C:\gilded-backups
cd C:\gilded-backups
scp deploy@2.31.136.48:/home/deploy/gilded/deploy/backups/gilded-20261110-020001.sql.gz .
```
Copy everything at once:
```
scp "deploy@2.31.136.48:/home/deploy/gilded/deploy/backups/gilded-*.sql.gz" .
```
**Git Bash** (drive C is `/c/`)
```
mkdir -p /c/gilded-backups
cd /c/gilded-backups
scp deploy@2.31.136.48:/home/deploy/gilded/deploy/backups/gilded-20261110-020001.sql.gz .
```
Use the exact file name from `ls -lh backups` on the server (the server path is always `/home/deploy/gilded/deploy/backups/...`, with forward slashes). Then check it arrived: `dir` (PowerShell) or `ls -lh` (Git Bash), and that it is not 0 bytes.

Still failing? Send me the exact line you typed and the exact error text.

**Protect the copies.** They contain customer data. Keep them off shared drives, delete old ones, never put them in git (`*.sql.gz` is already git-ignored).

## 4. Restore on your laptop (practice, and the way to test an update on real data)
Needs the Docker stack from guide 02 set up in `deploy` (it has its own `.env`; it does not need the production one).
```
cd <your repo>/deploy
bash ./scripts/backup.sh                 # safety copy of whatever is there now (optional, laptop data is only demo)
mkdir -p backups
cp /c/gilded-backups/gilded-20261110-020001.sql.gz backups/
bash ./scripts/restore.sh backups/gilded-20261110-020001.sql.gz
```
It asks you to type `YES`. It then: stops the api and web, deletes the laptop database, creates an empty one, loads the file, and starts everything again.

Check: open `http://localhost` (or your local address), log in **with the production users and passwords** (the restore brings their accounts), see the real customers and transactions, `docker compose ps` shows everything up, `docker compose logs --tail 50 api` has no errors.
Notes:
- Logins from the old server's browser are not kept; everyone logs in again.
- Never do a test on the laptop with real customer data in a public place, and delete it afterwards (`bash ./scripts/restore.sh` with a demo backup, or `docker compose down -v` to wipe).
- To rehearse an update: restore, then `git checkout` the new version and `docker compose up -d --build` - the migrations run on real data.

## 5. Restore in production (disaster only)
Use when data is damaged or lost. **Everything after the backup's time is lost**, so decide with the managers first and tell all branches to stop entering transactions (queued/offline ones sync after, and are rejected if they conflict).
```
ssh deploy@2.31.136.48
tmux new -s restore
cd ~/gilded/deploy
bash ./scripts/backup.sh                 # keep a copy of the broken state too
ls -lh backups                           # pick the file to go back to
bash ./scripts/restore.sh backups/gilded-XXXX.sql.gz     # type YES
docker compose ps
curl -s https://app.gildedgold.org/health/ready
```
Then log in, check the latest records, tell the branches they can resume, and write down what time range was lost.
If the server itself is gone: create a new server by guide 08, put the saved `.env` in `deploy`, `docker compose up -d --build`, copy a backup file in with scp (reverse direction: `scp gilded-X.sql.gz deploy@NEWIP:/home/deploy/gilded/deploy/backups/`), then restore as above. Without `.env` the passwords inside it must be reset - keep it in a password manager.

## 6. Monthly checklist
1. Download the newest backup (section 3). 2. Restore it on the laptop (section 4). 3. Log in and look at yesterday's transactions. 4. Delete the laptop copy. 5. Note the date.