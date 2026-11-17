# Backups

From B71 the server backs itself up. This page says what happens, how to set up the copy off the server, and how to put a backup back.

## What happens on its own
- **Every night at 01:30 (Ghana time)** the `backup` service copies the whole database into `deploy/backups/gilded-YYYYMMDD-HHMMSS.sql.gz`, checks the copy can be read, and keeps the newest 7 on the server.
- **If the off-site bucket is set up**, the copy and every photo go to the bucket, **encrypted first** (the provider only stores scrambled files and names). Photos are sent only once: they never change. A personal picture someone deleted is deleted there too. Old copies are tidied: every night's copy for 35 days, and the copy from the 1st of each month for 400 days.
- **Every Sunday at 03:15** the newest copy is loaded into a scratch database next to the real one. The main tables are compared with the live database and the scratch database is removed. This proves the backups can actually be put back.
- **If the backup or the check fails**, everyone who may change company settings gets a notification in the app ("The nightly backup failed …").
- `deploy/backups/status.json` always says how things stand (last run, result, size, off-site, last check).

```
docker compose exec backup status           # how things stand
docker compose exec backup backup-now       # back up now (for example before an update)
docker compose exec backup restore-check    # check the newest copy now
docker compose logs backup                  # what the service printed
```

## Set up the off-site copy (Backblaze B2)
1. In Backblaze, create a **private** bucket (for example `gilded-backups-yourcompany`). Note its endpoint (for example `s3.eu-central-003.backblazeb2.com`) and the region in it (`eu-central-003`).
2. Create an **application key limited to that bucket**, with read and write. Note the keyID and the applicationKey (shown once).
3. In `deploy/.env` fill in:
   ```
   BACKUP_S3_PROVIDER=Other
   BACKUP_S3_ENDPOINT=s3.eu-central-003.backblazeb2.com
   BACKUP_S3_REGION=eu-central-003
   BACKUP_S3_BUCKET=gilded-backups-yourcompany
   BACKUP_S3_KEY_ID=<keyID>
   BACKUP_S3_SECRET=<applicationKey>
   BACKUP_ENCRYPTION_PASSPHRASE=<a long passphrase, letters and digits>
   ```
   **Write the passphrase down and keep it away from the server** (a safe, a password manager the director controls). Without it nobody can open the off-site copies, not even you.
4. `docker compose up -d --build backup`, then `docker compose exec backup backup-now`, then `docker compose exec backup offsite list`. You should see the copy listed.

AWS S3 works the same way: `BACKUP_S3_PROVIDER=AWS`, the region, the bucket, and an IAM key limited to that bucket (leave the endpoint empty). Wasabi, Cloudflare R2 and others are `Other` with their endpoint.

## Put a backup back
On the same server (a copy in `deploy/backups`):
```
./scripts/restore.sh backups/gilded-YYYYMMDD-HHMMSS.sql.gz
```
On a new server (the old one is gone): install Gilded as usual with the same `.env` (the same passphrase and bucket settings), then:
```
docker compose up -d --build
docker compose exec backup offsite list                                  # pick the newest
docker compose exec backup offsite fetch gilded-YYYYMMDD-HHMMSS.sql.gz   # into deploy/backups
./scripts/restore.sh backups/gilded-YYYYMMDD-HHMMSS.sql.gz
docker compose exec backup offsite fetch-photos                          # every photo back into the photos volume
```
Practise this once on a spare machine, so the day it is needed is not the first time.

## Limits to know
- If the database itself cannot be reached, the failure is written to `status.json` and the log, but no notification can be sent (the notifications live in that database). A system status page for directors is on the plan.
- If the backup service is stopped, nothing runs and nothing is said. `docker compose ps` shows it; the status page will show the last run time.
- The weekly check needs free disk for one more copy of the database while it runs.
- Backups made by hand with `scripts/backup.sh` stay on the server only.