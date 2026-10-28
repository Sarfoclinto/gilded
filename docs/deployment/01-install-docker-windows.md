# 01 - Install everything from zero (Windows)

Time: about 45 minutes, plus restarts. You need: Windows 10 (22H2) or Windows 11, 8 GB RAM or more (16 GB is comfortable), 20 GB free disk, administrator rights, internet.

Docker is free for personal use, education and small businesses (under 250 staff and under US$10 million yearly revenue). Check with your boss if your company is larger.

## Step 1 - Switch on virtualization (usually already on)
1. Press `Ctrl+Shift+Esc` to open Task Manager, open the **Performance** tab, click **CPU**.
2. Look for **Virtualization: Enabled**. If it says Disabled, restart the laptop, enter the BIOS (usually `F2`, `F10`, `Del` or `Esc` right at power-on - search your laptop model), find "Intel Virtualization Technology" / "SVM Mode" / "VT-x" and enable it, save, boot.

## Step 2 - Install WSL2 (Windows' built-in Linux, which Docker uses)
1. Click Start, type `PowerShell`, right-click **Windows PowerShell**, choose **Run as administrator**.
2. Run: `wsl --install`
3. Restart when asked. After the restart a window may open asking you to create a Linux username and password: choose any, and remember them.
4. Check: open PowerShell and run `wsl --status`. It should mention "Default Version: 2".

## Step 3 - Install Docker Desktop
1. Go to https://www.docker.com/products/docker-desktop/ and download **Docker Desktop for Windows**.
2. Run the installer. Keep "Use WSL 2 instead of Hyper-V" ticked. Restart if asked.
3. Start **Docker Desktop**. Accept the terms. You can skip signing in.
4. Wait until the whale icon at the bottom-left says **Engine running** (green).
5. Check, in a normal PowerShell: `docker --version` and `docker compose version`. Both should print a version.

Tip: Docker Desktop > Settings > Resources: if the laptop is short of memory, give Docker 4 GB.

## Step 4 - Install Git (to get and update the code)
1. Download from https://git-scm.com/download/win and install, accepting all defaults.
2. Check in a new PowerShell: `git --version`.

## Step 5 - Put the project on the laptop
You already have the project folder (`gold-valuation`). Make sure it is somewhere simple, for example `C:\gilded\gold-valuation`. Do not keep it in OneDrive or on the Desktop (synced folders cause odd errors).

Then open PowerShell and go into the deploy folder:

```
cd C:\gilded\gold-valuation\deploy
```

Important for Windows: the file `deploy/db-init/00_roles.sh` must have Linux line endings (LF). The repository's `.gitattributes` handles this when you clone with Git. If you copied the folder from a zip instead, open that file in VS Code, click `CRLF` at the bottom-right and change it to `LF`, then save.

## Step 6 - Make your secrets
In PowerShell, inside `deploy`:

```
copy .env.example .env
```

Open `.env` in Notepad. Replace the three passwords and the signing key with long random text of **letters and digits only**. You can generate each one with this command (run it four times, copy each result):

```
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | % {[char]$_})
```

For the demo keep: `COMPANY_SLUG=demo`, `SITE_ADDRESS=:80`, `COOKIE_SECURE=false`. If port 80 is busy on your laptop set `HTTP_PORT=8080` and open `http://localhost:8080` later.

Go on to `02-run-demo-on-laptop.md`.