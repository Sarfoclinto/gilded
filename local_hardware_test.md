# Testing Gilded on two real laptops, before deploying

Goal: prove on real Windows hardware, with the backend on your own laptop, that (1) the desktop app installs and signs in, (2) a laptop works with the backend unreachable and catches up afterwards, (3) the two laptops share one cash drawer through the hub, (4) nothing is lost or counted twice when things fail.

Call the laptop that runs the backend and database **A**. The second laptop is **B**. (If A is not one of the two laptops with the app, the steps are the same; just skip installing the app on A.) Use the hub on **B**: that is the realistic case, because the backend laptop is the one most likely to be switched off or move.

Allow about 2 hours the first time. Tick each box. Write down anything that differs from "Expect".

---

## 0. Know these three things first

1. **Use https, not http, for this test.** Plain `http://192.168.x.x` looks like it works but silently loses the sign-in cookie, so people are signed out after 15 minutes (proved on a test machine). The steps below run the backend over https with a development certificate and tell the desktop app to trust it. That switch (`allowSelfSigned`) is for this test only: **never ship an installer that has it.** In production the server has a real certificate and the field stays out.
2. **The server address is the backend, not the website.** For this test: `https://<A's address>:5443`.
3. **Both laptops must be able to reach each other.** Some routers (guest Wi-Fi, "AP isolation", "client isolation") stop devices on the same Wi-Fi from talking to each other. Step 2 checks this.

---

## 1. Prepare laptop A (backend + database)

### 1.1 Find A's address
In PowerShell: `ipconfig`. Under "Wireless LAN adapter Wi-Fi", note **IPv4 Address**, e.g. `192.168.1.20`. This guide calls it `A-IP`.
If your router gives out a new address when laptops restart, either reserve this one in the router ("DHCP reservation" / "address reservation" for A's MAC address) or re-check it before each session. If it changes, the installers built with the old address stop finding the backend.

### 1.2 Database and backend, as in `backend/README.md`
- [ ] PostgreSQL running; roles and the `gold` database created (README step 1).
- [ ] **Apply all migrations through 0048:** `dotnet run --project src/GoldValuation.Api -- migrate` (from the `backend` folder).
- [ ] Seed a company and a director (README step 3). Then, from the app later, create a **manager** user and a **teller** user (People → Users) so the two laptops can sign in as different people. Make sure at least one has the `sync:review` permission (Managers and Directors have it).
- [ ] `dotnet test` passes. (The sync server code has never been compiled before; if anything fails here, stop and send me the output.)

### 1.3 Run the backend over https on the network
In PowerShell, from the `backend` folder:
```
dotnet dev-certs https
$env:ASPNETCORE_ENVIRONMENT = "Development"
dotnet run --project src/GoldValuation.Api --urls "https://0.0.0.0:5443"
```
`dev-certs` makes the development certificate (answer Yes if Windows asks to trust it; it is not required). `0.0.0.0` means "answer on the network, not only on this laptop". Leave this window open: it is the backend. Press Ctrl+C later to simulate the backend going down.

### 1.4 Let other laptops in (Windows Firewall)
Open PowerShell **as Administrator** on A:
```
New-NetFirewallRule -DisplayName "Gilded API (test)" -Direction Inbound -Protocol TCP -LocalPort 5443 -Action Allow -Profile Any
```
(Remove it after testing: `Remove-NetFirewallRule -DisplayName "Gilded API (test)"`.)

---

## 2. Check the network before installing anything

On **B**, open a browser and go to `https://A-IP:5443/health/live`.
- [ ] The browser warns the certificate is not trusted (expected: choose Advanced → Continue).
- [ ] You see `{"status":"ok"}`.

If it does not load: wrong IP, firewall rule missing, backend not running, or the Wi-Fi isolates devices (try a phone hotspot or a cable/switch). Do not continue until this works. Also try `https://A-IP:5443/health/ready` (checks the database).

Also check **both laptops' clocks** are right (Settings → Time & language → Sync now). The app warns if a clock is more than 5 minutes out, and entry times are used to order things.

---

## 3. Build the installer (once, on any Windows laptop with Node installed)

1. Get the latest code from me (the files from B30–B35, and the desktop change delivered with this guide). At the repo root: `npm install`.
2. Edit `desktop/assets/defaults.json`:
```
{ "companyName": "Gilded", "serverUrl": "https://A-IP:5443", "channel": "stable", "allowSelfSigned": true }
```
3. `npm run dist -w @gold/desktop`. The installer is `desktop/release/Gilded-Setup-<version>.exe`.
4. **Afterwards set `defaults.json` back** (remove `allowSelfSigned`, restore the real address). Do not commit it with the test values.
5. Windows shows "Windows protected your PC" for an unsigned installer: **More info → Run anyway**. Expected for now.
6. Install on **B** (and on A if you want to use the app there too). Copy the file with a USB stick or a shared folder.

---

## 4. First launch

On each laptop with the app:
- [ ] A short landing page shows, then **Connected**, then the login screen opens by itself.
- [ ] Sign in (A: director or manager; B: teller or manager).

If it says **No connection**: the address in the installer is wrong, or the backend/firewall (go back to step 2 from that laptop's browser). If it opens a login that always fails with a certificate-like or network error: the installer was built without `allowSelfSigned`.

### 4.1 The sign-in cookie really stays (this was the one real bug found while writing this guide)
- [ ] Sign in on B and just use the app for **at least 20 minutes** (leave it open, click something every few minutes). You must **not** be thrown back to the login. The sign-in lasts 15 minutes and renews itself in the background through the cookie.

---

## 5. Set up the day (on A or B, signed in as director/manager)
- [ ] Set today's price (Prices) and approve it.
- [ ] Open the day for the branch (Cash drawer → Open the day). Enter a starting count with a few hundred 100s, some 50s/20s/10s. Write the starting count down.

---

## 6. One laptop at a time: working with the backend unreachable (no hub yet)

On **B**, signed in as the teller:
- [ ] Press Ctrl+C in A's backend window (the backend is now down, the Wi-Fi is still up).
- [ ] The header badge turns to **Offline** within about half a minute.
- [ ] Make a purchase and pay it. It saves ("Saved on this device…"). Make a cash top-up or withdrawal. The badge shows "N waiting". The drawer total already reflects them.
- [ ] Close the app completely and open it again. Sign in (this works offline). The entries are still waiting.
- [ ] Start the backend again (the `dotnet run` command from 1.3).
- [ ] Within about 15 seconds the waiting count goes to 0. **Expect:** nothing shown as refused.
- [ ] On A, as manager: the purchases appear in Transactions; the drawer balance equals the starting count minus what you paid out.

Check the database (pgAdmin, Query Tool on `gold`, connected as `postgres`):
```
select status, count(*) from gold.sync_commands group by status;
select count(*) from gold.device_keys;
select type, status, code, flags from gold.sync_commands order by received_at desc limit 10;
```
- [ ] `device_keys` has a row for each person who signed in online on each laptop.
- [ ] The entries you made while the backend was down are `applied` with flag `offline`. (This is the first time a signature made in the app is checked by the C# code. If instead the purchases arrived the normal way and `sync_commands` is empty, the signed path was refused and it fell back: tell me.)

---

## 7. Turn on the hub

1. On **B** (the hub): My settings → This device → **Make this computer the hub** (needs a manager/director sign-in) → give it a name.
2. Windows Firewall asks about the app: tick **Private networks** (and Public if your Wi-Fi is set to Public), then Allow. If you missed it, in an Administrator PowerShell on B:
```
New-NetFirewallRule -DisplayName "Gilded hub (test)" -Direction Inbound -Protocol TCP -LocalPort 47600 -Action Allow -Profile Any
```
3. Click **Add a computer**. A line appears: `192.168.x.x:47600#123456#A1B2C3D4E5F60718`.
4. On **A** (the app, signed in as a manager): My settings → This device → **Join a hub** → type or paste the line → **Join**. (It works once, for 10 minutes.)
- [ ] B shows a **Hub** pill in the header and lists A under the paired computers.
- [ ] A shows a **Shared** pill.

If joining says "Cannot reach the hub computer": firewall on B (47600) or Wi-Fi isolation. If it says "not the one this computer was paired with": you typed the line wrongly or are not reaching B.

---

## 8. The shared drawer

Both laptops open **Cash drawer**. Note the number of 100s on each (same).
- [ ] On B: Cash in or out → Withdrawal → take **most** of the 100s (leave 3). Record.
- [ ] Within ~5 seconds A's drawer shows the withdrawal too (same balance).
- [ ] On A: try to take 10 × 100s. **Expect:** it is refused with "Another computer just used some of those notes (short by 7 × GHS 100). Choose the notes again." and nothing is saved.
- [ ] On A: take 2 × 100s. It goes through. B's drawer shows it within seconds.
- [ ] Make a purchase on A paid in 100s with more than are left: refused with the same message; with fewer: saved. Both laptops agree on the balance every time.

Race test (the real one): stand both laptops side by side, each with a payout that needs the same last few 100s. Press Save on both at the same moment. **Expect:** exactly one saves; the other gets the message.

---

## 9. Failure tests

### 9.1 The hub laptop disappears
- [ ] Close the app on B (or turn B's Wi-Fi off). On A the pill changes to **Not shared** within ~10 seconds.
- [ ] On A: make a purchase. **Expect:** it saves (no blocking). Drawer shows it.
- [ ] Reopen the app on B (hub starts by itself). Within ~15 seconds A's pill says **Shared** again.
- [ ] On B, the drawer includes what A saved while B was away.

### 9.2 Backend down, laptops still together (your main scenario)
- [ ] Stop the backend (Ctrl+C on A's window).
- [ ] Make purchases and withdrawals on both laptops. **Expect:** both keep working, each sees the other's drawer changes, the racing test still refuses a double use of notes.
- [ ] Start the backend. **Expect:** both queues drain to 0, no "refused" badges, nothing in Review → **Offline entries** (or only a few with a clear reason).
- [ ] Compare: drawer on A = drawer on B = what the Cash drawer page shows from the server after a refresh. Tell me any difference.

### 9.3 A laptop alone, then back
- [ ] Turn B's Wi-Fi off. Sign out and in (offline sign-in). Work. Turn Wi-Fi on. **Expect:** catches up; pill goes to Shared.

### 9.4 Held entries (the manager's review screen)
- [ ] On B, stop B's Wi-Fi (or stop the backend). Record a cash withdrawal.
- [ ] On A (online), **close the day**.
- [ ] Bring B back online. **Expect:** B's withdrawal is not lost: it appears for a manager under Review → **Offline entries** as waiting ("the day is closed"), and managers get a notification. **Try again** (after opening a second session for the day) or **Dismiss** with a reason of at least 5 characters.

---

## 10. Things to try that are likely to go wrong in a shop
- Put a laptop to sleep with entries waiting; wake it later. 
- Pull the Wi-Fi mid-save.
- Restart A's backend repeatedly while B is saving.
- Sign out with entries waiting (the app warns). Sign in as someone else on that laptop: their entries must not go out under your name.

---

## 11. What to send back
For each section: ✔ / ✖ and, for each ✖, the exact message on the screen, what you did just before, and (if you can) the text file/screenshot. Useful extras:
- `select status, code, message, flags, type from gold.sync_commands order by received_at;`
- The files in `%APPDATA%\Gilded\hub` on the hub laptop exist (`hub.db`, `hub-cert.pem`, `hub-config.json`) — do not send `hub-key.pem`.
- The app version (My settings → This device).

## 12. Cleaning up / starting again
- To start a laptop fresh: close the app, delete `%APPDATA%\Gilded` (this removes the sign-in copy, stored data, hub files and the queue; anything not yet sent is lost, so only do it when the queue is empty). Or My settings → "Forget this device".
- Remove the firewall rules (`Remove-NetFirewallRule -DisplayName "Gilded API (test)"` and `"Gilded hub (test)"`).
- Restore `desktop/assets/defaults.json` (no `allowSelfSigned`).

## Known limits you will meet (not bugs in your setup)
- Opening and closing the day while offline is not available yet; do both while the backend is reachable.
- The hub does not relay for a member that has no connection to the server; each laptop sends its own entries.
- The installer is unsigned (Windows warning) and thermal receipt printers need their Windows driver.
- Live notifications (the bell) over the development certificate are not verified; refresh if one does not arrive and tell me.