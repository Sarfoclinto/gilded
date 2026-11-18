# 12 - The company website at gildedgold.org

This guide puts the company website on the bare address **https://gildedgold.org**. **https://www.gildedgold.org** sends people there too. The system stays at **https://app.gildedgold.org**.

The website is plain files in the `website/` folder of the repository. It is served by the same Hetzner server and the same front door (Caddy) as the system. There is nothing to build, no extra cost, and the HTTPS certificate is automatic.

Time: about 30 minutes, plus up to an hour waiting for the name records (DNS).

Names used below: server `gilded-1`, IP **2.31.136.48**, user `deploy`, folder `~/gilded/deploy` (as in guides 08–10). Use your own values if they differ.

---
## Part A - Fill in the facts (on your laptop, 10 minutes)

Every phone number, address and opening hour on the site comes from **one file: `website/content.js`**. Nothing else needs editing.

1. Open `website/content.js` in VS Code (or Notepad).
2. Some values are already filled in from the shop banner:
   - Phones `055 361 8944` and `025 717 1391`.
   - The Anyanso Branch, Ashanti Region.
   - The e-mail `gildedgoldent@gmail.com`. **Check it:** the photo of the banner cut it off after "gmail.co".
3. Fill in each line marked **TODO**:
   - `whatsapp`: the number that has WhatsApp, with the country code, digits only (for example `233553618944`). The site then shows "Message us on WhatsApp"; without it, it shows "Call us".
   - `hours`: for example `Monday to Saturday, 8:00 to 17:30`.
   - `licence`: the licence line exactly as on the banner ("Licensed by …").
   - `about`: one or two short paragraphs in your own words (who you are, since when, where). Leave a blank line between paragraphs.
   - `branches`: for each branch, the street or landmark, hours, phone, and a map link. For the map link, open the place in Google Maps, press **Share**, then **Copy link**, and paste it between the quotes. Copy the `{ … }` line to add another branch.
4. **Leave any value as `''` (two single quotes) to hide it.** The site never shows a blank or the word TODO; that part simply does not appear.
5. Look at it on your laptop: open the `website` folder and double-click `index.html`. It opens in your browser. Fix anything that reads wrong.
6. Save, then commit and push (from the repository folder):
   ```
   git checkout -b feat-website
   git add -A
   git commit -m "B72: company website at gildedgold.org"
   git push -u origin feat-website
   ```
   Merge it on GitHub (Pull request, Merge), as for every change (guide 09).

---
## Part B - Namecheap: point gildedgold.org and www at the server (5 minutes, then wait)

1. Sign in at namecheap.com, then **Domain List**, then **Manage** next to `gildedgold.org`, then the **Advanced DNS** tab.
2. Look at **Host Records**. You should see the `app` A record from guide 08. **Do not touch it.**
3. If parking records are still there (`CNAME  www  parkingpage.namecheap.com` or `URL Redirect  @  …`), delete them with the dustbin icon.
4. Click **ADD NEW RECORD** and add:

   | Type | Host | Value | TTL |
   |---|---|---|---|
   | **A Record** | `@` | `2.31.136.48` | Automatic |
   | **CNAME Record** | `www` | `gildedgold.org.` | Automatic |

   (`@` means the bare `gildedgold.org`. Namecheap may add the final dot itself.) Press the green tick after each one.
5. Wait 5 to 60 minutes. Then check in PowerShell on your laptop:
   ```
   nslookup gildedgold.org
   nslookup www.gildedgold.org
   ```
   Both must show `2.31.136.48`. **Do not go on until they do**, or the certificate step in Part C fails. If it fails anyway, it simply tries again later, but it is quicker to wait.

---
## Part C - The server (10 minutes)

1. Log in from PowerShell:
   ```
   ssh deploy@2.31.136.48
   cd ~/gilded/deploy
   ```
2. Get the new code: `git pull`
3. Open the settings file: `nano .env`. Go to the end with the arrow keys and add these two lines (they are also at the end of `.env.example`):
   ```
   WEBSITE_ADDRESS=gildedgold.org
   WEBSITE_WWW_ADDRESS=www.gildedgold.org
   ```
   Save with **Ctrl+O**, then Enter, then **Ctrl+X**.
4. Restart only the front door (the system keeps running; any break is a second or two):
   ```
   docker compose up -d web
   ```
5. Watch it get the certificates (press Ctrl+C to stop watching):
   ```
   docker compose logs -f web
   ```
   Look for lines with `certificate obtained successfully` for `gildedgold.org` and `www.gildedgold.org`.

---
## Part D - Check (5 minutes)

1. On your laptop and on a phone, open **https://gildedgold.org**. You should see the padlock and the website.
2. Open **https://www.gildedgold.org**. The address bar should change to `https://gildedgold.org`.
3. Open **https://app.gildedgold.org**. The system works exactly as before.
4. On a phone: tap a phone number (it should offer to call) and **Staff sign-in** (it opens the system).
5. Optional: add a second monitor in UptimeRobot for `https://gildedgold.org` (guide 08 Part D).

---
## Changing the website later

- **A phone number, hours, a new branch:** edit `website/content.js` on your laptop, commit, push, merge. Then on the server run `cd ~/gilded/deploy && git pull`. That is all: no restart, and the change shows at once (the server never lets browsers keep an old `content.js`).
- **Wording or design** (`index.html`, `styles.css`): the same steps. A visitor may see the old styling until they refresh.
- Never edit files directly on the server. The next `git pull` would clash with your edit (guide 09).

## Good next steps (optional)

- **Google Business Profile** (free): add each branch on business.google.com, with the same phone numbers and a link to `https://gildedgold.org`. This is what people see when they search "gold buyer near me", and it matters more than the website for being found.
- **An e-mail at your own domain** (for example `info@gildedgold.org`): in Namecheap, Domain List, Manage, then **Redirect Email**, add `info` and forward it to the Gmail address. It is free, and you can then put `info@gildedgold.org` in `content.js`. (Sending *from* that address needs a mail service. Namecheap Private Email or Google Workspace are paid options, for later.)
- **Photos:** a picture of the shop front or the scale can replace the example reading later. Send me the photos and I will fit them in.

## If something goes wrong

| What you see | Why, and what to do |
|---|---|
| "This site can't be reached" on gildedgold.org | The DNS records are not there yet or are wrong. Check Part B step 5. |
| A certificate warning on gildedgold.org | Caddy could not get the certificate, usually because DNS was not ready. Wait until `nslookup` shows the IP, then `docker compose restart web`. Check `docker compose logs web --tail 50`. |
| www does not redirect | The `www` CNAME is missing, or `WEBSITE_WWW_ADDRESS` is not in `.env`. Fix it, then `docker compose up -d web`. |
| The system at app.gildedgold.org stopped working | Very unlikely (it is a separate block). Remove the two `WEBSITE_` lines from `.env`, run `docker compose up -d web`, and send me `docker compose logs web --tail 80`. |
| A change to `content.js` does not show | Did the server `git pull`? Run `git log --oneline -1` on the server and compare with your laptop. |