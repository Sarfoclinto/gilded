# 02 - Run Gilded on your laptop and give the demo

Do guide 01 first. All commands run in PowerShell, inside the `deploy` folder.

## A. Start it

```
docker compose up -d --build
```

The first run downloads about 1 GB and compiles everything: expect 5-15 minutes. Later starts take seconds.

Check:

```
docker compose ps
```

You want `db` (healthy), `api` (running), `web` (running). `migrate` shows "exited (0)" - that is correct, it is a one-off job.

If something is red: `docker compose logs api --tail 40` (swap `api` for `db`, `migrate`, `web`). See Troubleshooting in 05.

## B. Create the company and the first director (once)

```
bash ./scripts/first-company.sh "Demo Gold Traders" director TKW "Takoradi"
```

If PowerShell does not know `bash`, run the script through Git's bash: `& "C:\Program Files\Git\bin\bash.exe" ./scripts/first-company.sh "Demo Gold Traders" director TKW "Takoradi"`. It asks for a password (10+ characters; typing is hidden).

Fallback without bash (same effect), after putting your own password in place of `YourPassword123`:

```
docker compose run --rm -e GOLD_SEED_PASSWORD=YourPassword123 api seed --company demo --company-name "Demo Gold Traders" --admin director --branch-code TKW --branch-name Takoradi
```

(`--company` must equal `COMPANY_SLUG` in `.env`.)

Open **http://localhost** (or `:8080` if you changed the port). Log in as `director` with your password.

## C. Load the data (about 10 minutes)

Sample files are in `deploy/demo-data/` - 40 customers, about 280 purchase lines over three months, opening gold, opening debts. They use branch codes **TKW** and **KSI**, and they pass the same checks as real files.

1. **Branches** (People > Branches): add a second branch, code `KSI`, name `Kumasi`. Then **log out and log in again** (needed for the new branch to appear in your access).
2. **Prices**: set today's price (or use the automatic GoldBod price once you have checked it).
3. **Bring in data** (Setup), in this order:
   1. _1 Customers_ - `customers.csv`
   2. _2 Past purchases_ - `past-purchases.csv`
   3. _3 Opening balances_ - `opening-gold.csv` (gold you hold at go-live) then `opening-debts.csv`
      Each screen previews first and lists any problem row by row; nothing is saved until you press import. Every import can be undone from _Earlier imports_.
4. **Using real data instead:** put your own sheets into the same shape (the screens offer a template download). Use real customer data only on a laptop with BitLocker (disk encryption) switched on, and wipe it afterwards (see "Clean up").

## D. Demo script (15 minutes)

Say the point of each step before you click.

1. **The problem (1 min).** Paper receipts, Excel, disputes about weights, no view across branches.
2. **Today's price (1 min).** _Automatic price_: the schedule screen, the presets, "See what the page says now". Price changes are controlled by permission and every change is on record.
3. **Open the day (1 min).** Drawer count; explain the first count is treated as go-live.
4. **A purchase at the counter (3 min).** New purchase: type top and down weights, the system computes purity and the amount, same as the Excel formula. Complete it; show the receipt and that the customer record is created.
5. **Cash drawer and close (2 min).** Close the day, show the expected-versus-counted difference opening a _Difference_ case.
6. **Two branches (2 min).** A transfer from Takoradi to Kumasi; "Between branches" shows what is in transit.
7. **Review (2 min).** Branch timeline: every movement, running balance; press _Export to Excel_.
8. **Moving over from paper (2 min).** _Bring in data_: show what you did earlier, and that it can be undone.
9. **Ask (1 min).** Hand over the cost sheet (guide 03): about GHS 2,700 for the first year.

Rehearse once. Keep the laptop plugged in, and have a mobile hotspot ready. Because Gilded is offline-first, you can also unplug the network mid-demo and keep working - a strong moment, if you have tried it first.

## E. Daily laptop use

- Stop (keeps data): `docker compose stop`
- Start again: `docker compose start`
- See logs: `docker compose logs -f api`
- Docker Desktop must be running.

## F. Clean up (wipes ALL data, including the demo)

```
docker compose down -v
```

Without `-v` the data stays. Do not run this casually.
