# 07 - The desktop app and the branch hub: what changes in deployment, and what it costs

Read this after guide 04 (going live) and before you hand the first installer to a branch. It is written to be followed in order, like `docs/LOCAL-HARDWARE-TEST.md`. Do the local hardware test first: it proves the desktop app and hub work on your own two laptops. This guide takes that to a real company.

## The short answer

| Question | Answer |
|---|---|
| Does the server setup change? | **No.** Same four containers (`db`, `migrate`, `api`, `web`). The hub is not a server you rent; it is the desktop app running on one computer in each branch. |
| Do I need a bigger or second server? | **No.** The desktop app talks to the same API and uses the same database. The only extra load is the installer files served from `/updates` (see step 6). |
| What new work appears? | (1) Build one Windows installer per company. (2) Host it on the server. (3) Install it on each branch computer. (4) Pick one computer per branch to be the hub. (5) A small firewall/router step per branch. (6) A release routine for the installer. |
| What new money appears? | Mainly a **code-signing certificate**: about **US$150-300 per year (GHS 1,700-3,500)**. Everything else is zero or small (table in step 9). |
| Can I skip signing? | Yes for a pilot. Windows then shows "Windows protected your PC" on each computer's first install, and staff click *More info > Run anyway*. Sign before you roll out to more than one or two branches. |
| Does the web version still work? | Yes. Phones and any browser keep using `https://gilded.yourcompany.com` exactly as before. The desktop app is an addition, and the same login works on both. |

## What changes, piece by piece

| Part | Before the desktop app | With the desktop app |
|---|---|---|
| Server | 4 containers on one rented server | **Unchanged.** One extra folder, `deploy/updates/`, holds installers. Caddy already serves it at `/updates`. |
| Database | PostgreSQL | **Unchanged.** Offline entries arrive through the same signed `/sync/commands` endpoint (migration 0048). |
| Branch computers | A browser | The Gilded app installed like any program. Opens with no internet. |
| Between computers in a branch | Nothing | One computer is the **hub**. Others reach it over the branch wifi/cable (port 47600, encrypted). It keeps the shared cash drawer honest when the internet is down. |
| Releases | `bash ./scripts/update.sh` on the server | Same, **plus** a new installer when the desktop part changes (guide 06 has the new rule). |
| Backups | Database nightly | Unchanged. The hub keeps only a working copy of the last few days of branch entries; the database is the record. |

---

## Step by step

### Step 1 - Decide what you need to have first
Tick each before continuing:
- [ ] The server from guide 04 is live and `https://gilded.yourcompany.com` shows a padlock. **The desktop app needs this real HTTPS address.** Never ship the `allowSelfSigned` setting from the local test.
- [ ] You have done `docs/LOCAL-HARDWARE-TEST.md` successfully on two laptops.
- [ ] You have one **Windows 10/11 computer to build on** (your laptop is fine). The installer cannot be built on the Linux server or on a Mac.
- [ ] Each branch has: its computers (up to 5 per branch), a wifi router or switch they all share, and a named person who can restart a computer.

### Step 2 - Choose the hub computer in each branch
The hub is just "the computer that stays on". Choose with these rules:
1. The **most reliable** computer, plugged into mains (not a laptop on battery being carried home).
2. Switched on **before trading starts and until the last teller has finished**. If it is off, the other computers carry on alone (nothing stops), but they stop sharing the drawer until it returns.
3. Set it never to sleep: *Settings > System > Power > Screen and sleep* > "When plugged in, put my device to sleep after" = **Never**.
4. Ideal: a small UPS (battery box) so a power cut does not turn it off mid-sale. Optional. I have no local price; ask your supplier for a "line-interactive UPS 650-1000 VA" and note the quote in the funding request.
5. Write its name on the computer with a sticker: **HUB**.

If you have only one computer in a branch, do nothing here: it works alone, the hub is for branches with two or more.

### Step 3 - Give the hub a fixed address on the branch network
Other computers find the hub by its address. If the router hands out a different address after a restart, they lose it.
1. On the hub computer open PowerShell and run `ipconfig`. Note the **IPv4 Address** (e.g. `192.168.1.20`) and the **Physical Address / MAC** of the active adapter (`ipconfig /all`).
2. Open the router's page (the address on its sticker, usually `192.168.1.1`), log in.
3. Find **DHCP reservation** / **Address reservation** / **Static lease**. Add the hub's MAC with the address you noted.
4. Save, restart the hub, run `ipconfig` again and confirm it is the same address.
5. Write the address on the HUB sticker.

Cost: nothing. If the router has no reservation option, set a static IP in Windows instead (ask me for the steps for your model).

### Step 4 - Build the installer (on your Windows computer)
1. Open `desktop/assets/defaults.json` and set the company's details. For a real company it must read exactly like this (no `allowSelfSigned`):
```
{ "companyName": "Your Company Ltd", "serverUrl": "https://gilded.yourcompany.com", "channel": "stable" }
```
2. If you have a code-signing certificate (step 5), set it **before** building. In PowerShell:
```
$env:CSC_LINK = "C:\secure\company-signing.pfx"
$env:CSC_KEY_PASSWORD = "the password"
```
3. Build:
```
npm ci
npm run dist -w @gold/desktop
```
4. Open `desktop\release\`. You must see three files: `Gilded-Setup-<version>.exe`, `Gilded-Setup-<version>.exe.blockmap`, `latest.yml`.
5. Check the version: the number in the file name equals `version` in `desktop/package.json`. Raise it for every new build.
6. The installer is about 80-120 MB. That is normal (it contains the whole app and its own browser engine).

One installer per company, because the server address is inside it. Two companies = two builds with two different `defaults.json`.

### Step 5 - Get a code-signing certificate (do this early; it takes days)
Why: an unsigned installer makes Windows show a scary warning and can be blocked by antivirus. A signed one shows your company name as the publisher. A new signature still earns trust gradually (Microsoft's "reputation"), so the first few installs may show a smaller prompt; it fades as more computers install the same signed program.

What I found (checked Nov 2026; confirm before paying):
- **Azure Artifact Signing** (Microsoft's cheap cloud signing, about US$9.99/month) is **only open to organisations in the USA, Canada, EU and UK**. A company in Ghana cannot use it. It would only work if you set up a company in one of those places, which I do not recommend.
- So a Ghana company uses an **OV (organisation validated) certificate: about US$150-300 per year** from a certificate authority (DigiCert, Sectigo, SSL.com and resellers). EV (US$400+) no longer gives instant trust, so it is not worth it for this.
- The authority will verify the **company** (registration documents, a phone call to a listed number, sometimes a lawyer's letter). Allow **3-10 working days**, and have the company registration certificate and a director ready. The certificate must be in the **company's** name, bought with the company's card, and the account in a company e-mail.
- Since 2023 the private key must be kept on a **hardware token (USB)** or in a cloud signing service. Ask the seller: (a) does the price include the USB token and courier to Ghana? (b) is there a cloud-signing option so I can sign from a build computer without the token? Courier to Ghana can add US$30-80; ask.
- Renewal is yearly. Put the expiry date in the company calendar 30 days ahead. An expired certificate does not break installed apps; it only stops you signing new releases.

Hand-off: where the token or key is kept is a security decision. Keep it in the company safe, and name two people who know where it is.

If the certificate is not ready yet: build and install **unsigned** for the pilot (step 8 tells you what staff will see), and plan to sign from the next release.

### Step 6 - Put the installer on the server
1. In PowerShell on your Windows computer, copy the three files to the server (replace the address):
```
scp desktop\release\Gilded-Setup-0.2.0.exe desktop\release\Gilded-Setup-0.2.0.exe.blockmap desktop\release\latest.yml deploy@203.0.113.10:/home/deploy/gilded/deploy/updates/win/beta/
```
Always put **beta** first: copy to `updates/win/beta/` and test on one computer. Only when it works, copy the same three files to `updates/win/stable/`.
2. Check in a browser: `https://gilded.yourcompany.com/updates/win/stable/latest.yml` shows text beginning with `version:`. A "not found" page means the folder or file name is wrong.
3. **Important:** copy `latest.yml` **last**. Computers read it to learn there is a new version; if it appears before the .exe finishes copying, they would try to download a half file.
4. Keep the previous version's .exe in the folder for a week: it is your rollback.

Size and traffic: a first install of 20 computers = about 2 GB once. Each update downloads only changed blocks (the `.blockmap` file makes that possible), usually 10-40 MB per computer. The cheapest server plans include terabytes of traffic, so this adds no cost. Disk: keep the folder to the last 3 versions (about 400 MB).

### Step 7 - Open the firewall port at each branch (one time per hub computer)
Windows asks "Allow Gilded to communicate on private networks?" the first time the hub starts. Choose **Private networks only**, then **Allow**. If nobody clicked it, do it by hand on the hub computer (PowerShell as Administrator):
```
New-NetFirewallRule -DisplayName "Gilded branch hub" -Direction Inbound -Protocol TCP -LocalPort 47600 -Profile Private -Action Allow
```
Then make sure Windows treats the branch wifi as **Private**: *Settings > Network & internet > Wi-Fi > (the network) > Network profile type = Private network*. Do **not** open this port on the router or the internet; nothing outside the branch ever needs it. The hub talks only to the other computers in the room.

### Step 8 - Install on the first branch (pilot)
Do this with the branch manager present, outside trading hours.
1. On the **hub** computer: copy `Gilded-Setup-<version>.exe` from your Windows computer on a USB stick and run it. (Later installs can download it from your server if you give staff the direct link `https://gilded.yourcompany.com/updates/win/stable/Gilded-Setup-<version>.exe`.)
2. Unsigned only: Windows says "Windows protected your PC". Click **More info > Run anyway**. Show the manager once, then it never appears again on that computer.
3. Start Gilded. Sign in as the **branch manager** (or director). Wait for the first sync.
4. Open *Settings > Branch computers*. Click **Make this the hub**. A pairing code appears. It is good for a short time and for one use.
5. On each **other** computer: install the same way, sign in, open *Settings > Branch computers* > **Join the hub**, type the hub's address (the one on the sticker), and the code. The card changes to "Connected".
6. Test the drawer together (the same two-computer test as `docs/LOCAL-HARDWARE-TEST.md`, part on the drawer): both computers record a payout from the same drawer while the internet is cut; the second must be warned if the notes are already used.
7. Tellers do not set up hub or join: a manager does it once per computer, then tellers just sign in and sell as normal; the drawer is shared automatically. If a teller opens the card they see "Ask a manager".
8. Write down in the branch folder: hub address, which computer is the hub, who set it up, the date.

### Step 9 - What it costs (the answer to "any other cost?")
Prices excluding VAT, checked Nov 2026, GHS at about 11.5 per US$1; treat as +/-20%.

| Item | One-off | Per year | Required? |
|---|---|---|---|
| Extra server | 0 | 0 | No. The hub runs on a computer you already have. |
| Extra hosting traffic/storage for installers | 0 | 0 | No (fits in the pilot server). |
| **OV code-signing certificate** | maybe US$30-80 token courier | **US$150-300 (GHS 1,700-3,500)** | Recommended before wide rollout; not needed for a one-branch pilot. |
| Windows computer to build installers | 0 if you use your laptop | 0 | Yes, one. |
| Branch computers | 0 if they already have Windows 10/11 | 0 | You said 2+ per branch already. |
| UPS for the hub computer | quote (not priced) | 0 | Optional, recommended. |
| Router change | 0 | 0 | Only the free "address reservation" setting. |
| Staff time | about 1-2 hours per branch for install and test | about 30 min per release | Yes. |
| Extra support load | training the manager on the hub card (30 min) | - | Yes. |

**Effect on the funding request:** add **about GHS 3,500 for the first year** (the high end of the certificate plus courier) to plan B in guide 03. Pilot with no signing: add 0. The 20% contingency already in guide 03 does not cover this; put it as its own line.

### Step 10 - Daily life with the hub (give this to branch managers)
- Start of day: switch on the hub computer first, then the others. Sign in.
- If the internet fails: carry on selling. Nothing to do. Entries wait in each computer and go to the server when the internet is back.
- If the hub computer is off or broken: the other computers keep working alone. The pill at the top says the hub is away. Notes could be promised twice during that time; if so, the entry is **kept and flagged** for a manager under *Offline entries*, never lost.
- If the hub computer must be replaced: on the new one, *Make this the hub*; on the others, *Join* again with a new code; on the old one, remove it from the list.
- If a computer is stolen or a teller leaves: a manager opens *Branch computers* and **removes** it; its keys stop working. Also deactivate the user in the usual place.

### Step 11 - Release routine for the installer (adds to guide 06)
Rule: **the server and the desktop app are released together if the change touches both.** Otherwise they are independent.
1. Server change only (no new screens): `bash ./scripts/update.sh` as before. Installed apps keep working; the web inside them needs a new installer only if the change needs new screens.
2. Desktop or screen change: raise `version` in `desktop/package.json`, build (step 4), copy to **beta** (step 6), install on one computer, test a payout, then copy to **stable**.
3. Every computer checks for updates at start and every 4 hours, downloads quietly, shows "Restart now", and installs when closed. Offline computers do nothing and carry on.
4. Roll back: computers only move to a **higher** version number, so you cannot "go back" by swapping files. Fix the problem and release a new higher version. If it is urgent, delete `latest.yml` from `stable` (computers then stop updating) and reinstall the affected computers by hand from the previous .exe you kept.
5. Add a line to `CHANGELOG.md` for staff in plain words ("The branch drawer now warns if two computers use the same notes").

### Step 12 - Go-live checklist, desktop edition
- [ ] Server live with HTTPS (guide 04)
- [ ] `defaults.json` has the real https address, **no** `allowSelfSigned`
- [ ] Installer built on Windows; three files present; version raised
- [ ] Certificate bought, installer signed (or "unsigned pilot" agreed in writing with the manager)
- [ ] `latest.yml` opens in a browser from `/updates/win/stable/`
- [ ] Hub chosen, sticker on it, never sleeps, address reserved in the router
- [ ] Firewall rule for port 47600, wifi set to Private
- [ ] Every computer joined; drawer test passed with the internet cut
- [ ] Manager knows: hub off = others work alone; where *Offline entries* is
- [ ] Certificate expiry date in the company calendar
- [ ] Previous installer kept for a week

## Troubleshooting
| Symptom | Likely cause |
|---|---|
| Installer says "Windows protected your PC" | Unsigned. *More info > Run anyway*, or sign (step 5). |
| App shows a certificate error on start | `serverUrl` has a typo or the server certificate is not valid yet (guide 04, step 9). Fix `defaults.json`, rebuild. |
| Staff signed out after 15 minutes on the desktop app | The address is `http://` not `https://`. Use https. |
| "Join the hub" cannot find the hub | Wrong address on the sticker, hub off, wifi set to Public, firewall rule missing, or the router isolates wifi clients ("AP isolation"/"guest network"). Put all on the same non-guest network. |
| Pairing code rejected | Expired or used already; make a new one on the hub. |
| No update appears | `latest.yml` not in the right folder, the version is not higher, or the channel in `defaults.json` differs from the folder. |
| Update downloaded but not applied | Close and reopen the app, or press *Restart now*. |
| Antivirus quarantines the installer | Unsigned installer. Sign it, or add an exception on that computer and tell the antivirus vendor it is a false positive. |

## What I have not tested
I cannot run Windows or a real router from here, so the installer build, signing, firewall rule and router steps follow the vendors' documented behaviour but have not been executed by me. The hub logic itself is covered by tests (and a two-window run in the sandbox). Your first pilot branch is the real test; send me anything that differs from this guide and I will correct the guide.

## Sources (checked Nov 2026)
- Microsoft, code signing options for Windows apps (Artifact Signing about US$9.99/month; eligibility USA, Canada, EU, UK for organisations; OV US$150-300/year; EV no longer gives instant SmartScreen trust): https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options
- Microsoft, Artifact Signing pricing (Basic and Premium plans): https://azure.microsoft.com/en-us/pricing/details/trusted-signing/