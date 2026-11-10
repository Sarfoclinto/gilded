# 09 - Making a change and getting it to production (step by step)

Use this every time you change Gilded now that `app.gildedgold.org` is live. The rule: **nothing is edited on the live server. A change is made on your laptop, proven on a copy of the real data, and only then installed on the server at night.** Guide 06 explains why; this guide is the checklist.

Note: this project's main branch is called **master**.

The path: **1 Change > 2 Test on your laptop > 3 Save in Git > 4 Rehearse (staging) > 5 Announce > 6 Install on production at night > 7 Check > 8 (If wrong) roll back.**
Allow: a small fix about 30 minutes end to end; a change with a database migration about 1-2 hours.

---
## Before you start: one-time setup
1. **Git:** the project is in the private GitHub repository from guide 08. You work on your laptop, the server only ever `git pull`s.
2. **Your laptop "staging" stack:** guide 01-02 (Docker Desktop, `deploy/.env` with `SITE_ADDRESS=:80`, `COOKIE_SECURE=false`). This is both your development stack and your rehearsal copy. Keep its secrets **different** from the server's.
3. **Server access:** `ssh deploy@<server IP>` works from your laptop.
4. **A change log:** a `CHANGELOG.md` in the project root. Every release adds a plain-words line for staff, e.g. "Purchases saved from a computer with a hub now save correctly".

---
## Step 1 - Make the change (on your laptop)
1. Update your copy: `git checkout master` then `git pull`.
2. Make a branch named for the change: `git checkout -b fix-offline-purchase`. (Never work on `master` directly.)
3. Make the change. When I give you files, copy them to the paths I name, then look at `git status` to see exactly what changed. Read the `B##-CHANGES.md` I send: it says what is untested.
4. **Database changes** are new numbered files only (for example `0050_something.sql` in `backend/db/migrations/`). Never edit a migration that has already run anywhere.

## Step 2 - Test on your laptop (about 10 minutes)
Run these in the project folder. All must pass before you go on.
```
npm test
npm run typecheck
dotnet test backend/GoldValuation.slnx
backend/db/run-tests.sh -h localhost -U postgres
```
(The last one needs a local PostgreSQL; if you only have Docker, skip it and rely on step 4, which applies every migration to real data.)
Then run it for real on your laptop stack:
```
cd deploy
docker compose up -d --build
docker compose logs migrate --tail 20
```
Open `http://localhost`, and **try the thing you changed by hand**, plus the three things you always check: sign in, make a purchase, open *Cash drawer*. If you changed the desktop app: `npm run dist -w @gold/desktop` on Windows and install it on your laptop (server address `http://localhost`).

## Step 3 - Save it in Git
```
git add -A
git commit -m "Fix: queued purchases are worked out before saving"
git push -u origin fix-offline-purchase
```
Open the repository on GitHub > **Compare & pull request** > create it. The automatic checks (CI) repeat the tests. Wait for the green tick. Then **Merge**. Add a line to `CHANGELOG.md` in the same change.
Tag the release so you can always go back to it:
```
git checkout master && git pull
git tag v1.0.1
git push --tags
```
(`v1.0.1` = fix, `v1.1.0` = new feature, `v2.0.0` = big change.)

## Step 4 - Rehearse on a copy of the real data (staging)
Do this for **every release with a database migration**, and for anything touching money or the drawer. It is the step that catches what tests cannot.
1. **Download last night's backup** from the server to your laptop:
```
scp deploy@<server IP>:/home/deploy/gilded/deploy/backups/<newest file>.sql.gz C:\gilded-staging\
```
(The backup contains real customer data: keep it in a private folder, never e-mail it, and delete it after the rehearsal.)
2. On your laptop, in `deploy`: put the **new** code in (`git pull`), then restore the backup: `bash ./scripts/restore.sh <path to the file>` (type YES). This replaces the **laptop's** data only.
3. `docker compose up -d --build`. Watch the migration: `docker compose logs migrate --tail 30`. It must end without errors.
4. Sign in with a real director login (the restored data has the real users). Click through: Home, *Transactions* (old purchases open), a new test purchase, *Cash drawer*, *Day history*, *Offline entries*.
5. Desktop changes: build the installer, copy it to the server's **beta** folder (`deploy/updates/win/beta/`, `latest.yml` last), install it on **one** computer whose `channel` is `beta`, and use it for a day before copying to `stable`. (Guide 07 step 6.)
6. Everything fine? Go on. Something wrong? Fix it from step 1; production is untouched.

## Step 5 - Announce (the day before)
Tell the branch managers: the time (night, after the last day is closed), what changes in plain words (from the changelog), and that nothing needs doing on their side. Avoid month-end and busy days.

## Step 6 - Install on production (at night, about 15 minutes)
Pick a time after every branch has closed its day.
1. Log in: `ssh deploy@<server IP>`.
2. Use `tmux` so a dropped connection cannot stop the update half-way: `tmux new -s update`. (If disconnected, log in again and run `tmux attach -t update`.)
3. Go to the folder and note the current version (for rollback): `cd ~/gilded/deploy && git log --oneline -1`. Write down the short code (for example `a1b2c3d`).
4. Install: `bash ./scripts/update.sh`
   It takes a backup, pulls the new code, rebuilds, applies migrations and restarts. The site is unavailable for roughly 1-3 minutes while the API restarts; computers keep working and send their queued entries afterwards.
5. If it stops with an error, **do not repeat it blindly**. Read the message; if the migration failed, the old API is still running (see guide 05). Go to step 8.

## Step 7 - Check (10 minutes)
1. `docker compose ps`: `api`, `db`, `web` are running (`migrate` shows "exited (0)").
2. Browser: `https://app.gildedgold.org/health/ready` is OK.
3. Sign in as a director. Do the same three checks: a purchase (a small test one; void or note it per your rules), *Cash drawer*, *Offline entries* is not full of new rejected items.
4. `docker compose logs api --tail 50`: no repeating errors.
5. UptimeRobot shows the site up.
6. Desktop release? Copy the three files to `deploy/updates/win/stable/` now (`latest.yml` last). Computers update themselves within about 4 hours of starting.
7. Tell the managers it is done and send the changelog line.

## Step 8 - If it goes wrong: roll back
Decide quickly; the longer wrong code runs, the more data it touches.
- **Code only, no database change:**
```
git checkout <the short code from step 6.3>
docker compose up -d --build
```
- **The release included a database migration:** the new tables/columns stay (they are harmless to old code if you followed the "add first, remove later" rule). Roll the code back as above. Only if the data itself is damaged, restore the backup `update.sh` took just before: `bash ./scripts/restore.sh backups/<that file>` (type YES). Everything entered since that backup is lost, so restore only as a last resort and tell the managers.
- Desktop release was bad: delete `latest.yml` from `updates/win/stable/` (computers stop updating), fix, and release a new **higher** version number (guide 07 step 11).
- After a rollback, find the cause on your laptop (step 1) before trying again.

---
## Rules that keep the money safe
- **Migrations only move forward** and are never edited after use. A correction is a new migration.
- **Add before you remove:** add the column/function (release 1), switch the code (release 2), remove the old thing months later. A computer still running an older screen then keeps working.
- **Server first, desktop second** when both change. Old desktop apps must keep working against the new server for a few days.
- **One change per release** while you are new to this; small releases roll back easily.
- **Never test on production data directly.** If you need to see a problem, restore a backup on your laptop.
- **Back up before every install** (`update.sh` does it) and keep the server's own Backups ticked.
- **Secrets stay out of Git.** Changing `.env` on the server: edit, then `docker compose up -d`.
- **Do not install in the working day**, and not at month-end unless it is an emergency fix.

## Quick card (print this)
| | Command / action |
|---|---|
| Laptop tests | `npm test` / `npm run typecheck` / `dotnet test backend/GoldValuation.slnx` |
| Laptop run | `cd deploy && docker compose up -d --build` |
| Save | `git add -A && git commit -m "..." && git push`, pull request, merge, `git tag vX.Y.Z && git push --tags` |
| Rehearse | download backup, `bash ./scripts/restore.sh <file>` on the laptop, `docker compose up -d --build` |
| Install (night) | `ssh deploy@IP`, `tmux new -s update`, `cd ~/gilded/deploy`, note `git log --oneline -1`, `bash ./scripts/update.sh` |
| Check | `docker compose ps`, `/health/ready`, a test purchase, `docker compose logs api --tail 50` |
| Roll back | `git checkout <old code>` then `docker compose up -d --build` |

## Later improvements (not needed yet)
- A small permanent staging server (about US$5 a month, `staging.gildedgold.org`) so rehearsal does not use your laptop.
- CI that builds the images and the server pulls a tagged version; keep the human "approve production" step.
- Scheduled night installs: only after several smooth manual ones.