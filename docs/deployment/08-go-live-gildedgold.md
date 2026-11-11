# 08 - Going live: Namecheap + Hetzner + the apps (for app.gildedgold.org)

A click-by-click version of guide 04 for this company's real accounts. Allow 2-3 hours the first time. Do the steps in order. Words in **bold** are things you click or type. Anything in `code` is typed exactly.

Names used: domain `gildedgold.org`, system address **`app.gildedgold.org`**, server name `gilded-1`, company short code `gildedgold`.

---
## Part A - Hetzner: get a server (you need its IP address for Part B)

### A1. Check your account is ready
1. Open the Hetzner Console. Top left shows **Select a project**; you already have a project called **Default**.
2. At the top there is a yellow notice "Important status messages: Maintenance 1, Warning 1". Click the arrow beside it and read both. Maintenance in one location is a reason to choose the other location in A3. A warning about your account (identity or payment) must be fixed before you can create a server.
3. If Hetzner asks you to verify identity or payment (new accounts often do), do it now. It can take hours.

### A2. Make your SSH key (your safe key to the server) - on your Windows laptop
1. Open **PowerShell**.
2. Type: `ssh-keygen -t ed25519 -C "gilded-admin"`
3. Press **Enter** to accept the default place. Type a passphrase (write it in the company password manager). Press Enter.
4. Show the public half: `type $env:USERPROFILE\.ssh\id_ed25519.pub`
5. Copy the whole line (it starts `ssh-ed25519`). Never share the file without `.pub`.

### A3. Create the server
1. In the **Default** project card click **+ CREATE SERVER**.
2. **Location:** Helsinki or Falkenstein (whichever has no maintenance notice).
3. **Image:** Ubuntu 24.04.
4. **Type:** Shared vCPU, **2 vCPU / 4 GB RAM** (the "CX33" class; the name may differ). Choose the **x86** kind, not Arm.
5. **Networking:** keep **Public IPv4** ticked (the domain needs it). IPv6 is optional.
6. **SSH keys:** click **Add SSH key**, paste the line from A2, name it `gilded-admin`, save, and make sure it is ticked.
7. **Backups:** tick **Backups** (adds about 20% to the price; worth it).
8. **Firewalls:** click **Create firewall** (or do it in A4 first). Name `gilded-fw`. Inbound rules only:
   - TCP **22** (SSH). Source: your own public IP if it rarely changes; otherwise "Any" for now.
   - TCP **80** from Any.
   - TCP **443** from Any.
   Nothing else. Apply it to this server.
9. **Name:** `gilded-1`. Leave "Cloud config" empty.
10. Click **Create & Buy now**. After about a minute the server appears with a **public IPv4 address** like `203.0.113.10`. **Write it down.**

---
## Part B - Namecheap: point the name at the server

Your screenshot shows **Domain List > gildedgold.org > Advanced DNS**, with two parking records. Do this:

### B1. Remove the parking records
1. Tick the box next to **CNAME Record - www - parkingpage.namecheap.com** and click the dustbin icon at the right. Confirm.
2. Do the same for **URL Redirect Record - @ - http://www.gildedgold.org/**.
(They only send visitors to Namecheap's parking page. You can add a company website to `@` and `www` later.)

### B2. Add the record for Gilded
1. Click **ADD NEW RECORD**.
2. **Type:** A Record
3. **Host:** `app`
4. **Value:** the server IP from A3 (e.g. `203.0.113.10`)
5. **TTL:** Automatic
6. Click the green tick to save.

### B3. Check it worked (wait 5-30 minutes)
In PowerShell: `nslookup app.gildedgold.org`. It must show your server IP. If it says "can't find", wait and try again; do not go on until it shows the IP, or the certificate in Part C will fail.

### B4. Housekeeping at Namecheap (while you are here)
- **Domain** tab: confirm **Auto-Renew** is on and **WHOIS privacy** (shown as "Withheld for Privacy"/"Domain privacy") is on.
- Check your e-mail for Namecheap's **"Verify your contact information"** message and click the link (otherwise the domain is suspended after about 15 days).
- Account profile > Security: turn on **two-factor authentication**.
- The domain is in the account named **clintonsarfo**. Decide who should own it. For a company system the company should own it: either open the account in the company's name and use **Sharing & Transfer** to move the domain there later, or at least put the company's e-mail on the account. Doing this after the pilot is fine.
- Do **not** buy Namecheap's SSL Certificates (left menu); the server gets a free certificate by itself.

---
## Part C - Set the server up (about 45 minutes)

### C1. Log in
PowerShell: `ssh root@203.0.113.10` (use your IP). Type `yes` the first time, then your passphrase.

### C2. Install Docker and a safe user
Copy these in, one block at a time:
```
apt update && apt -y upgrade
curl -fsSL https://get.docker.com | sh
adduser deploy
usermod -aG docker deploy
apt -y install git unattended-upgrades
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/ && chown -R deploy:deploy /home/deploy/.ssh
exit
```
(`adduser` asks for a password: choose a long one and save it. Press Enter for the other questions.) Then log in as that user: `ssh deploy@203.0.113.10`.

### C3. Put the code on the server
Best way: a **private GitHub repository** with the project.
1. On GitHub create a **private** repository `gilded` and push your project to it.
2. On the server: `ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519` then `cat ~/.ssh/id_ed25519.pub`.
3. GitHub repository > **Settings > Deploy keys > Add deploy key**: paste it, leave write access off.
4. On the server: `git clone git@github.com:YOUR-NAME/gilded.git` then `cd gilded/deploy`.

No GitHub? From your laptop: `scp -r C:\path\to\gold-valuation deploy@203.0.113.10:/home/deploy/gilded`. It works but you must repeat it for every update, so Git is better.

### C4. The settings file
```
cp .env.example .env
nano .env
```
Set these (generate each secret by running `openssl rand -hex 24` in another window, once per line):
```
POSTGRES_PASSWORD=<random>
GOLD_APP_PASSWORD=<random>
GOLD_MIGRATOR_PASSWORD=<random>
AUTH_SIGNING_KEY=<run: openssl rand -hex 32>
COMPANY_SLUG=gildedgold
SITE_ADDRESS=app.gildedgold.org
COOKIE_SECURE=true
```
Save: **Ctrl+O**, Enter, **Ctrl+X**. Then `chmod 600 .env`. Copy the whole file's contents into the company password manager (without it a restored backup is useless).

### C5. Start it
```
docker compose up -d --build
docker compose ps
```
The first build takes several minutes. All of `db`, `api`, `web` should say running (`migrate` says exited: that is correct).
Create the company and first director (run once):
```
bash ./scripts/first-company.sh "Gilded Gold Enterprise" director KSI "Kumasi Main"
```
It asks you to choose the director's password. Use your real branch code/name instead of the examples.

### C6. Check
1. Browser: `https://app.gildedgold.org`. A padlock should appear within a minute (the certificate is fetched on the first visit). If not: `docker compose logs web --tail 40`; usually DNS (Part B3) or the Hetzner firewall (A3 step 8).
2. Browser: `https://app.gildedgold.org/health/ready` shows "Healthy"/ok.
3. Log in as `director`, company `gildedgold`. Change the password when asked.

### C7. Backups (do not skip)
```
crontab -e
```
add the line (then save):
```
0 2 * * * cd /home/deploy/gilded/deploy && bash ./scripts/backup.sh >> backups/backup.log 2>&1
```
Run one by hand now: `bash ./scripts/backup.sh` and check `ls backups`. Hetzner's own server backups (ticked in A3) are the second layer. Copy `backups/` somewhere off the server weekly until you automate it (guide 04 step 10). Do one test restore on your laptop before real data goes in (guide 05).

### C8. Monitoring
Free account at uptimerobot.com: **Add monitor**, HTTPS, URL `https://app.gildedgold.org/health/ready`, every 5 minutes, alert to your e-mail and one colleague.

---
## Part D - Wire up the apps

### D1. The web app (browsers, phones)
Nothing to build. Everyone opens **https://app.gildedgold.org**. On a phone: open it once while online, then **Add to Home screen**. On a computer: browser menu > **Install** (so it works offline later). The server address is the page's own address, so nothing to set.

### D2. The Windows desktop app
1. On your Windows build computer, open `desktop/assets/defaults.json` and set exactly:
```
{ "companyName": "Gilded Gold Enterprise", "serverUrl": "https://app.gildedgold.org", "channel": "stable" }
```
(No `allowSelfSigned`.)
2. Build: `npm ci` then `npm run dist -w @gold/desktop`. The installer is in `desktop\release\`.
3. Put the installer on the server for updates (guide 07 step 6): copy the three files (.exe, .exe.blockmap, `latest.yml`, **latest.yml last**) to `deploy/updates/win/beta/` first, test on one computer, then to `stable/`.
4. Install on a computer, open it: the opening screen should say **Connected**, then the sign-in appears.
5. Already installed with another address (for example your local demo)? You do not need to rebuild: menu **Gilded > Change server address...**, type `https://app.gildedgold.org`, **Save and connect**.
6. Branch computers sharing a drawer: guide 07 steps 2, 3, 7, 8.

### D3. Your laptop demo vs the live server
They are separate. The demo laptop keeps `http://localhost` and its own demo data. The live server starts empty: do **not** type real customers into it until backups are tested (C7) and the data load (*Bring in data*) is planned.

### D4. Before staff use it
Guide 04 section 12: add branches, users and roles; price-feed schedule; opening balances; train staff; Data Protection Commission registration.

---
## If something does not work
| Symptom | Fix |
|---|---|
| `nslookup` shows nothing or an old address | Wait up to an hour; confirm the A record's Host is `app` and the IP has no typo. |
| No padlock / browser warning | DNS not right yet, or ports 80/443 closed in the Hetzner firewall; `docker compose logs web --tail 40`. |
| Login works then you are signed out at once | `COOKIE_SECURE` must be `true` with https. Edit `.env`, then `docker compose up -d`. |
| `docker: permission denied` | You are not the `deploy` user or have not logged in again after C2. |
| Desktop app says "No connection" | Server address typo in the app (Gilded > Change server address...), or the server is down: check the uptime monitor and `docker compose ps`. |
| Cannot SSH in | Wrong IP, wrong user (`root` first, then `deploy`), or the firewall's port 22 rule has a different source than your current IP. |

## Cost recap
Hetzner 4 GB server with backups about US$11-14 a month; domain about US$10-15 a year (renewal is higher than the first year at most sellers: check Namecheap's renewal price). Details and the code-signing certificate for the desktop app: guides 03 and 07.