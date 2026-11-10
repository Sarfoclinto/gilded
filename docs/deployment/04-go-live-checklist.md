# 04 - Going live on a rented server (Hetzner example)

Other hosts are the same from step 4 on (any Ubuntu 24.04 server). Allow half a day. Do it with funding approved and the domain bought.

## 1. Buy the domain
Register the company domain (Cloudflare Registrar, Namecheap, Porkbun, or a .com.gh registrar). Use a company e-mail for the account and turn on two-factor login. Write the login in the company's password manager.

## 2. Make an SSH key (your safe key to the server)
In PowerShell on your laptop:
```
ssh-keygen -t ed25519 -C "gilded-admin"
```
Press Enter for the default place and set a passphrase. Show the public half: `type $env:USERPROFILE\.ssh\id_ed25519.pub` - you will paste this line into the host. Never share the file without `.pub`.

## 3. Create the server
Hetzner Cloud console > new project > **Add server**: location nearest (Helsinki or Falkenstein), image **Ubuntu 24.04**, type 2 vCPU / 4 GB (CX33 class), enable **Backups**, add your **SSH key**, name `gilded-1`. Note the public IP address, say `203.0.113.10`.

## 4. Cloud firewall
In the host's *Firewalls* section create rules (inbound): TCP **22** (SSH; ideally only from your own IP), TCP **80**, TCP **443**. Everything else closed. Apply it to the server. (Use the host firewall, not just `ufw`: Docker bypasses `ufw` for published ports. The database port is not published at all.)

## 5. Point the domain at the server
At the DNS provider add an **A record**: name `@` (or `gilded`) > the server IP. Wait 5-30 minutes. Check from PowerShell: `nslookup gilded.yourcompany.com`.

## 6. Install Docker on the server
```
ssh root@203.0.113.10
apt update && apt -y upgrade
curl -fsSL https://get.docker.com | sh
adduser deploy                 # choose a password
usermod -aG docker deploy
apt -y install git unattended-upgrades
exit
ssh deploy@203.0.113.10
```
(Later you can disable root login and password login for SSH.)

## 7. Get the code
Put the project in a private Git repository (GitHub/GitLab) and on the server:
```
git clone <your repository address> gilded
cd gilded/deploy
```
(Private repo: create a read-only "deploy key" on the repository and add it on the server, or use a personal access token.)

## 8. Settings
```
cp .env.example .env
nano .env
```
Set the three database passwords and the signing key to long random text. Generate each with `openssl rand -hex 24`. Set:
```
COMPANY_SLUG=yourcompany
SITE_ADDRESS=gilded.yourcompany.com
COOKIE_SECURE=true
```
Save with `Ctrl+O`, Enter, `Ctrl+X`. Store a copy of `.env` in the company password manager - without it a restored database cannot be used.

## 9. Start
```
docker compose up -d --build
docker compose ps
bash ./scripts/first-company.sh "Your Company Ltd" director KSI "Kumasi Main"
```
Open `https://gilded.yourcompany.com`. The padlock should appear within a minute (Caddy requests the certificate when the first visitor arrives; DNS must already be correct and ports 80 and 443 open).

## 10. Backups (do not skip)
Nightly backup at 02:00 by cron:
```
crontab -e
```
add:
```
0 2 * * * cd /home/deploy/gilded/deploy && bash ./scripts/backup.sh >> backups/backup.log 2>&1
```
Also turn on the host's server backups. Then copy `deploy/backups/` off the server regularly (Backblaze B2 with `rclone`, or download weekly). **Do a test restore** on your laptop once (guide 05) - a backup you have never restored is a hope, not a backup.

## 11. Monitoring
Create a free UptimeRobot account; add an HTTPS monitor for `https://gilded.yourcompany.com/health/ready`, 5-minute interval, alerting your e-mail/phone and one colleague.

## 12. Before staff use it
- Directors: log in, change the first password (*Choose a new password*).
- Add branches, users and roles; staff log in once to confirm.
- Set the price feed schedule and check "See what the page says now".
- Load history and opening balances (*Bring in data*), then open the first day.
- If branches will use the desktop app, continue with guide 07 after this one (installer, hub, router, firewall).
- Staff devices: open the site once while online so it can work offline later.
- Register with the Data Protection Commission (Ghana) and tell staff what customer data is held and why.

## Going-live checklist
- [ ] Domain bought, company-owned
- [ ] Server created, backups on, firewall applied
- [ ] DNS A record correct, HTTPS padlock shows
- [ ] `.env` saved in password manager; root/password SSH login disabled
- [ ] Nightly backup works; one restore tested
- [ ] Uptime monitor alerts reach two people
- [ ] First director password changed
- [ ] Data imported and checked against paper totals
- [ ] Staff trained; a support contact named
- [ ] Desktop app: guide 07 checklist (only if used)