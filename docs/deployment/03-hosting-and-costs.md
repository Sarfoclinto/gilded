# 03 - Hosting options and what to ask for

**Prices were looked up on 27 Oct 2026, are excluding tax (VAT) where relevant, and change often. Check each provider's page before paying.** Converted at about **GHS 11.5 per US$1** (the rate shown on the GoldBod page). Euro prices are converted at roughly 1 EUR = 1.15 USD (an assumption). Treat every figure as an estimate within about 20%.

## What the system needs
Small: one database, one API, one web server. For 1-5 branches and a few dozen staff, **2 vCPU and 4 GB RAM and 40-80 GB disk** is comfortable. 2 GB works for a pilot but leaves little room while Docker builds the images.

## Where to host - the options

| Option | Typical plan | About per month | Notes |
|---|---|---|---|
| **Hetzner Cloud** (Germany/Finland) | 2 vCPU / 4 GB (CX33 class), about EUR 5.5-9.5 | **US$7-11** | Best value. No African location, so ~150-250 ms from Ghana; fine for this app, and it works offline anyway. Backups option +20%. |
| **DigitalOcean** (Amsterdam/London/Frankfurt) | 2 vCPU / 4 GB, $24; 2 GB, $12 | **US$24 + $4.80 backups** | Easier dashboard, good guides. No African location. |
| **AWS Lightsail** | 2 GB $12; 4 GB $24 | US$12-24 | Familiar name; closest region is Europe unless you use full EC2 in Cape Town. |
| **Microsoft Azure, South Africa North** | B2s 2 vCPU / 4 GB about $40; B2as_v2 / 8 GB about $71 | **US$40-71 + disk, traffic, backup** | Nearest big cloud to Ghana (lower delay). Compute only; add roughly $10-25 for disk, bandwidth and backups. More complicated billing. |
| **A Ghanaian host / local data centre** | quote needed | ask | Good if your company requires data to stay in Ghana. Ask for: a Linux VM, 4 GB RAM, daily backups, a public IP, support hours. Prices were not available to me. |
| **Your own server at the office** | hardware + UPS + internet | high effort | Not advised: power cuts, internet, no backup site, nobody on call. |

Payment: foreign hosts take Visa/Mastercard in USD/EUR. Ask the bank to enable international online payments on a company card, and keep a small buffer for exchange-rate movement.

## Other costs

| Item | Price | Notes |
|---|---|---|
| **Domain `.com`** | about US$10-15/year (Cloudflare Registrar sells at cost; Namecheap/Porkbun similar) | Example: `gilded-yourcompany.com`. Keep it in the company's name, not yours. |
| **Domain `.com.gh`** | about GHS 150-300/year | Needs the company's registration documents; takes a few business days; via a GHNIC-accredited registrar. Looks local and trusted. |
| **HTTPS certificate** | Free | Caddy fetches and renews it from Let's Encrypt. |
| **DNS and protection (Cloudflare Free)** | Free | Optional. |
| **Off-site backup storage** (Backblaze B2 or similar) | about US$6 per TB per month; our data is tiny, so under US$1 | Copies of the nightly backup stored away from the server. |
| **Server snapshots/backups** | +20% of server price at the host | Easy extra safety. |
| **Uptime alerts** (UptimeRobot free plan) | Free | Emails/phone alert if the site is down. |
| **Data Protection Commission registration (Ghana, Act 843)** | check the Commission's current fee | You hold customer names and phones, so the company, as data controller, must register. Ask legal/compliance. |
| **Code-signing certificate** for the Windows desktop app (OV) | about US$150-300/year (GHS 1,700-3,500) plus maybe US$30-80 token courier | Only needed to remove Windows' "protected your PC" warning; not needed for a one-branch pilot. Not available from Microsoft's cheap Azure service for Ghana. Details in guide 07. |
| **Desktop app hosting** | 0 | Installers live on the same server (about 400 MB, small traffic). No extra server: the branch hub is a computer you already have. |
| **Setup labour** | 0 if you or a colleague follow guide 04 | If you hire an engineer, ask for a fixed quote for "one server, Docker, HTTPS, backups". I have no reliable price. |

## Three plans, for the funding request

Contingency of 20% is included in the "Ask" row to absorb price changes and exchange rates.

| | **A. Demo** | **B. Pilot (recommended)** | **C. Standard** | **D. Africa region** |
|---|---|---|---|---|
| Where | Your laptop | Hetzner 4 GB + backups | DigitalOcean 4 GB + backups | Azure South Africa North |
| Server per month (US$) | 0 | ~11 | ~29 | ~71 |
| Backup / storage per month (US$) | 0 | ~3.5 | ~3 | ~14 |
| Domain per month (US$) | 0 | ~1.2 | ~1.2 | ~1.2 |
| **Total per month (US$)** | **0** | **~16** | **~33** | **~86** |
| Total per month (GHS) | 0 | ~180 | ~380 | ~990 |
| **Per year (GHS)** | **0** | **~2,200** | **~4,600** | **~11,900** |
| **Ask for (year + 20%)** | **GHS 0** | **GHS 2,700** | **GHS 5,500** | **GHS 14,300** |

(Plan D uses the 8 GB size; the 4 GB size at about $40 brings the ask to roughly GHS 9,100.)

**Recommendation:** ask for plan B, **GHS 2,700 for the first year**, and mention plan D as the later option if distance or data-location rules matter. Moving between hosts later is straightforward: backup, restore (guide 05).

## If branches use the desktop app
Add one line to the request: **code signing, about GHS 3,500 for the first year** (high end), separate from the 20% contingency. Everything else in guide 07 costs nothing extra. A pilot without signing adds 0.

## What the money does not cover
Staff phones/PCs, an optional UPS for each branch's hub computer, and internet at the branches; SMS/e-mail (Gilded does not send them); any paid support; the company's time to train staff.

## Sources (checked Oct 2026)
- Hetzner Cloud pricing: https://www.hetzner.com/cloud/ and https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/
- DigitalOcean Droplets: https://www.digitalocean.com/pricing/droplets
- AWS Lightsail: https://aws.amazon.com/lightsail/pricing/
- Azure virtual machines: https://azure.microsoft.com/pricing/details/virtual-machines/linux/
- Backblaze B2: https://www.backblaze.com/cloud-storage/pricing
- UptimeRobot: https://uptimerobot.com/pricing/
- GHNIC (.gh domains): https://www.nic.gh