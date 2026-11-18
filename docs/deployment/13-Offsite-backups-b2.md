# 13 - Off-site backups to Backblaze B2 (or any S3 storage), step by step

Today the backups sit on the same Hetzner server as the system. If that server is lost, the backups go with it. This guide sets up the `backup` service (added in B71). It does the following:

| What | When | Where |
|---|---|---|
| A full copy of the database, checked to be readable | every night at 01:30 (Ghana time) | the server (`deploy/backups/`, newest 7) **and** Backblaze |
| Every photo (sent once; they never change) | every night | Backblaze |
| Tidy old copies | every night | Backblaze keeps each night for 35 days, and the 1st of each month for 400 days |
| A test that the newest copy can be put back | every Sunday at 03:15 | the server (a scratch database, removed afterwards) |
| A notification to the directors if any of this fails | when it happens | in the app |

Everything sent to Backblaze is **encrypted on the server first**, with a passphrase only you hold. Backblaze stores scrambled files with scrambled names: they cannot read customer data or ID photos.

Time: about 45 minutes. Cost: Backblaze B2 charges about **US$6.95 per TB per month**, and the first **10 GB are free**. Downloading (for a restore) is free up to three times what you store. A year of Gilded backups for one company is likely to fit in the free 10 GB at first, and then costs well under a dollar a month. (Prices checked November 2026; see backblaze.com/cloud-storage/pricing.)

Names used below: server IP **2.31.136.48**, user `deploy`, folder `~/gilded/deploy`. The bucket name `gilded-backups-gge` is an example; bucket names are unique across all of Backblaze, so pick your own.

---
## Part A - Backblaze account and bucket (15 minutes)

1. Go to **backblaze.com**, choose **B2 Cloud Storage**, then **Sign up**. Use a company e-mail that more than one person can reach (not a personal Gmail).
   - **Region:** choose **EU Central** if offered. It is close to the Hetzner server in Nuremberg, and the region cannot be changed later.
2. After signing in: **Account**, then **My Settings**. Turn on **two-factor authentication** (Google Authenticator or similar). Keep the recovery codes with the passphrase from Part B.
3. **Create the bucket:** in the left menu, **B2 Cloud Storage**, then **Buckets**, then **Create a Bucket**.
   - **Bucket Unique Name:** for example `gilded-backups-gge`.
   - **Files in Bucket are:** **Private**. This is important.
   - **Default Encryption:** Enable. It does no harm; our own encryption comes on top.
   - **Object Lock:** Disable.
   - Click **Create a Bucket**.
4. On the new bucket, note the **Endpoint**. It looks like `s3.eu-central-003.backblazeb2.com`. The part between `s3.` and `.backblazeb2.com` is the **region** (here `eu-central-003`). Write both down.
5. **Keep only the last version** (this saves money): on the bucket, click **Lifecycle Settings**, choose **Keep only the last version of the file**, then **Update Bucket**.
   *Why:* by default B2 keeps every old version of every file for ever, so copies our job deletes after 35 days would still be stored and charged.
6. **Make a key for the server, limited to this bucket:** left menu, **Application Keys**, then **Add a New Application Key**.
   - **Name of Key:** `gilded-server`
   - **Allow access to Bucket(s):** choose **only** `gilded-backups-gge`
   - **Type of Access:** **Read and Write**
   - Leave the rest empty, then **Create New Key**.
7. The screen shows a **keyID** and an **applicationKey**. **The applicationKey is shown only once.** Copy both into your password manager now. If you lose it, delete the key and make a new one.

---
## Part B - The passphrase (5 minutes; the most important part)

The passphrase scrambles every file before it leaves the server. **Without it, nobody can ever open the off-site copies: not you, not me, not Backblaze.**

1. Make a strong one on the server (log in as in Part C step 1 first, or use any password generator):
   ```
   openssl rand -base64 33 | tr -dc 'A-Za-z0-9' | head -c 40; echo
   ```
   Use letters and digits only (the `.env` file is read by several programs).
2. **Store it in two places away from the server:**
   - the company's password manager (Bitwarden, 1Password …), as "Gilded backup passphrase";
   - **on paper, in the office safe** or with the director, together with the Backblaze login and the 2FA recovery codes.
3. Never change it casually. Copies made with an old passphrase can only be opened with that old passphrase.

---
## Part C - Switch it on (10 minutes)

1. Log in to the server from PowerShell:
   ```
   ssh deploy@2.31.136.48
   cd ~/gilded/deploy
   ```
2. Get the code with the backup service (B71 or later): `git pull`
3. Edit the settings: `nano .env`. Go to the end and add (or fill in, if already copied from `.env.example`):
   ```
   BACKUP_S3_PROVIDER=Other
   BACKUP_S3_ENDPOINT=s3.eu-central-003.backblazeb2.com
   BACKUP_S3_REGION=eu-central-003
   BACKUP_S3_BUCKET=gilded-backups-gge
   BACKUP_S3_KEY_ID=<the keyID from A7>
   BACKUP_S3_SECRET=<the applicationKey from A7>
   BACKUP_ENCRYPTION_PASSPHRASE=<the passphrase from Part B>
   ```
   Use your own endpoint, region and bucket from A4. Save with **Ctrl+O**, then Enter, then **Ctrl+X**.
4. Make sure only you can read that file: `chmod 600 .env`
5. Build and start the backup service:
   ```
   docker compose up -d --build backup
   ```
   The first build takes a few minutes. `docker compose ps` should list `backup` as running.
6. **Remove the old nightly job from guide 08 (C7)**, so two backups do not run every night. The new service replaces it:
   ```
   crontab -e
   ```
   Find the line that ends with `scripts/backup.sh >> backups/backup.log 2>&1` and put a `#` at the start of it, then save. (`scripts/backup.sh` itself stays for a quick copy by hand before an update.)

---
## Part D - Prove it works (10 minutes)

1. Run a backup now:
   ```
   docker compose exec backup backup-now
   ```
   The last line should say `backup: done (off-site: sent)`.
2. See it in the bucket, through your passphrase:
   ```
   docker compose exec backup offsite list
   ```
   You should see a line like `220073 2026-11-18 … gilded-20261118-213000.sql.gz`.
3. Look in the Backblaze website (**Buckets**, then **Browse Files**). You will see folders and files with **meaningless names**. That is the encryption working.
4. Run the restore test now instead of waiting for Sunday:
   ```
   docker compose exec backup restore-check
   ```
   It lists the main tables with "backup N, live N" and ends with `restore check: ok`.
5. See how things stand at any time:
   ```
   docker compose exec backup status
   ```
6. **Tomorrow morning**, check that it ran by itself: `docker compose exec backup status` should show a `lastRun` from last night at about 01:30 and `ok: true`.

If any step fails, directors also get a notification in the app. See "If something goes wrong" below.

---
## Part E - Practise a restore from Backblaze (once now, then every few months)

Do this on your **laptop**, never on the live server. It proves you can rebuild everything from Backblaze alone, the day the server is gone.

1. On your laptop, in the repository: `git pull`.
2. In `deploy/.env` **on the laptop**, put the same seven `BACKUP_` lines as on the server.
3. In Git Bash, in the `deploy` folder:
   ```
   docker compose up -d --build
   docker compose exec backup offsite list
   docker compose exec backup offsite fetch gilded-YYYYMMDD-HHMMSS.sql.gz
   bash ./scripts/restore.sh backups/gilded-YYYYMMDD-HHMMSS.sql.gz
   docker compose exec backup offsite fetch-photos
   ```
   (Use the newest name from the list; `restore.sh` asks you to type YES.)
4. Open http://localhost, sign in, and check yesterday's purchases, a customer's ID photo and the cash drawer.
5. Afterwards, **remove the seven `BACKUP_` lines from the laptop's `.env`** (or the laptop would start uploading its demo data to the same bucket each night).

## Part F - The day the server is really gone

1. Create a new Hetzner server and install Gilded on it as in guide 08 (Parts A and C). Use **the same `.env`**, from your password manager: the same passwords, the same `BACKUP_` lines, the same passphrase.
2. Point `app` (and `@`, `www`) at the new IP in Namecheap (guide 08 Part B, guide 12 Part B).
3. On the new server:
   ```
   cd ~/gilded/deploy
   docker compose up -d --build
   docker compose exec backup offsite list
   docker compose exec backup offsite fetch <the newest file>
   bash ./scripts/restore.sh backups/<the newest file>
   docker compose exec backup offsite fetch-photos
   ```
4. Branch computers keep their unsent entries and send them once the system answers again.

---
## Other S3 storage instead of Backblaze

The service speaks the common "S3" language, so other providers work with different values:

| Provider | BACKUP_S3_PROVIDER | ENDPOINT | REGION |
|---|---|---|---|
| Backblaze B2 | `Other` | `s3.<region>.backblazeb2.com` | e.g. `eu-central-003` |
| AWS S3 | `AWS` | leave empty | e.g. `eu-central-1` |
| Wasabi | `Other` | e.g. `s3.eu-central-1.wasabisys.com` | e.g. `eu-central-1` |
| Cloudflare R2 | `Other` | `<account id>.r2.cloudflarestorage.com` | `auto` |
| Hetzner Object Storage | `Other` | e.g. `fsn1.your-objectstorage.com` | e.g. `fsn1` |

On every provider: a **private** bucket, a key limited to that one bucket with read and write, and old versions not kept (or kept only briefly). Hetzner Object Storage is convenient, but it is the same company as the server. A different company (Backblaze) protects you even from a problem at Hetzner.

## If something goes wrong

| Notification or message | Meaning, and what to do |
|---|---|
| "BACKUP_ENCRYPTION_PASSPHRASE is empty, so nothing was sent" | The passphrase line is missing in `.env`. Add it (Part C3), then `docker compose up -d backup`. |
| "could not be sent to the off-site bucket" | A wrong key, endpoint or bucket name, or Backblaze was unreachable. Check the seven lines against Part A. Run `docker compose exec backup backup-now` to see the full message. The copy on the server is still made. |
| "The copy in the off-site bucket is not complete" | The upload was cut off. It retries the next night; run `backup-now` to try now. |
| "The weekly backup check failed" | The newest copy could not be loaded. Look at `deploy/backups/restore-check.log`, run `docker compose exec backup backup-now` then `restore-check`, and send me the log if it fails again. |
| "The database could not be copied" (no notification, seen in `status`) | The database was down when the backup ran. Check `docker compose ps`. The next night retries. |
| `offsite list` shows nothing | Nothing has been sent yet, or this computer's `.env` points at another bucket or passphrase. |
| Disk filling up | `df -h`. The weekly check needs room for one more copy of the database. Lower `BACKUP_KEEP_LOCAL` in `.env` (default 7), or resize the server's disk in Hetzner. |

**Keep these together, away from the server:** the Backblaze login with its 2FA recovery codes, the keyID and applicationKey, the passphrase, and a copy of the server's `.env`. With those four you can rebuild everything.