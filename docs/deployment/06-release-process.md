# 06 - From your laptop to production: how a code change travels

The idea: **nobody edits the live server.** Every change is made on your laptop, tested, saved in Git, and then the server pulls that exact version and rebuilds.

## The path of one change
1. **Branch.** `git checkout -b fix-receipt-total` (never work on `main` directly).
2. **Code** on your laptop. Run the app with the demo stack or `npm run dev`.
3. **Test.** `npm test`, `npm run typecheck`, `dotnet test backend/GoldValuation.slnx`, and for database changes `backend/db/run-tests.sh -h localhost -U postgres`.
4. **Push** the branch to GitHub and open a pull request. The CI workflow repeats all the tests and builds both Docker images. Merge only when it is green.
5. **Merge to `main`.** Tag a release: `git tag v1.3.0 && git push --tags`.
6. **Try it on staging** (see below), at least for database changes.
7. **Deploy to production**, outside trading hours: on the server, `./scripts/update.sh` (backs up, pulls, rebuilds, migrates, restarts). It takes a few minutes. Staff on offline-first devices keep working; the screens reload with the new version.
8. **Check.** Log in, make a test action, watch `docker compose logs api --tail 50`, and the uptime monitor.
9. **Roll back if wrong.** `git checkout <previous tag>` then `docker compose up -d --build`. If the release changed the database, restore the backup `update.sh` made just before.

## Releasing the desktop app
Server-only changes need only `update.sh`. A change to screens or the desktop code also needs a new installer: raise the version, build on Windows, copy to `deploy/updates/win/beta/`, test on one computer, then copy to `stable/` with `latest.yml` last. Full steps in guide 07.

## Staging: a rehearsal copy
Your laptop stack IS staging: restore last night's production backup into it (`./scripts/restore.sh`), switch to the new version, run `docker compose up -d --build`, and check that the migrations apply to real-shaped data. Do this before any release that includes a new `backend/db/migrations/00NN_*.sql`. Later, a second small server (about US$5 a month) can hold staging permanently.

## Rules that keep the live data safe
- **Migrations only move forward.** Never edit a migration already applied anywhere; add a new numbered file. The ledger is immutable by design; corrections are new entries.
- **Make changes backward compatible when possible**: add a column or function first, deploy; switch the code to use it, deploy; remove old things much later. This also protects a device still running an older screen.
- **Back up before every deploy** (automatic in `update.sh`).
- **Secrets stay out of Git** (`.env` is ignored). Rotating a secret means editing `.env` on the server and `docker compose up -d`.
- **One change per release when you are new at this.** Small releases are easy to roll back.
- **Announce maintenance** to branches and avoid month-end and busy hours.

## Automatic deploys (later)
Once you trust the process, CI can build images, push them to GitHub's registry, and the server pulls the tagged version. Keep the human step "approve production" even then. Not needed for the pilot.

## Versioning
Tags `v1.0.0`, `v1.1.0` (new feature), `v1.1.1` (fix). Keep a short `CHANGELOG.md` listing what changed for staff in plain words; it doubles as the update notice you send to customers.