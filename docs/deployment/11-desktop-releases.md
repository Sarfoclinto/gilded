# 11 - Releasing a desktop update (step by step)

Use this whenever the **desktop app** has to change, and also whenever the **screens** change (the installer carries its own copy of the web app, see below). It is separate from guide 09, which updates the server.

Server paths used here: `/home/deploy/gilded/deploy/updates/win/beta/` and `.../stable/` (on your laptop the same folders sit under `deploy/updates/win/`, but you never put installers in Git: they are ignored).

## 0. How it works, in five lines
1. Each branch computer has the Gilded program installed. On start (after 5 seconds) and every 4 hours it reads `https://app.gildedgold.org/updates/win/<channel>/latest.yml`.
2. If `latest.yml` names a **higher version** than the one installed, it downloads the new installer quietly. Nobody is interrupted.
3. Then it shows **Restart to update** (My settings > This device). If nobody presses it, it installs the next time the app is closed.
4. No connection = nothing happens; the app keeps working and tries again later.
5. `<channel>` is `stable` for every normal computer. One test computer of yours uses `beta`.

**Important: the installer contains a copy of the screens.** Updating the server with `update.sh` changes what browsers and phones see, but **not** what the desktop program shows. New screens (for example the Customer and Closing tabs, or the branch note setting) reach desktop computers only through a new installer. The server stays compatible with older installers for a few days, so the order is always **server first, then installer**.

## 1. Decide the version number
The desktop has its own number in `desktop/package.json` (`"version": "0.1.0"`), separate from the website tags (`v1.2.0`). It **must go up** every release, or computers ignore it (downgrades are switched off).
Look at My settings > This device on a computer (it says "Gilded desktop 0.1.0") to see what is installed, then choose the next one: `0.1.0` > `0.2.0` for new features, `0.2.1` for a small fix.

## 2. Make the release in Git (on your laptop, Git Bash)
```
git checkout master && git pull
git checkout -b release-desktop-0.2.0
```
1. Edit `desktop/package.json`: `"version": "0.2.0"`.
2. Open `desktop/assets/defaults.json` and check it says exactly:
   `{ "companyName": "Gilded", "serverUrl": "https://app.gildedgold.org", "channel": "stable" }`
   (no `allowSelfSigned`, and **channel stays `stable`**, see section 5 for why).
3. Add a plain line to `CHANGELOG.md` for staff (what is new in the desktop).
```
git status                      # read the list: only package.json (and defaults.json, CHANGELOG.md)
git add -A
git commit -m "Release desktop 0.2.0"
git push -u origin release-desktop-0.2.0
```
Pull request, green checks, merge, then:
```
git checkout master && git pull
git tag desktop-v0.2.0 && git push --tags
```

## 3. Build the installer (on a Windows computer, from master)
In Git Bash in the project folder:
```
npm install
npm run dist -w @gold/desktop
```
It takes a few minutes. Look in `desktop/release/`. You need exactly these three files (numbers follow your version):
- `Gilded-Setup-0.2.0.exe`
- `Gilded-Setup-0.2.0.exe.blockmap`
- `latest.yml`

Open `latest.yml` in Notepad: the first line must say `version: 0.2.0`. If it shows the old number you built before saving `package.json`: build again.
(Signing: if you have a code-signing certificate set `CSC_LINK` and `CSC_KEY_PASSWORD` before the build, see `desktop/README.md`. Without it Windows shows "Windows protected your PC > More info > Run anyway" on first installs. Updates still work.)
Do **not** commit anything from `desktop/release/`.

## 4. Copy to the server's beta channel (first, to test)
Run this on your **laptop**, not inside the ssh session. Go into the folder first and use only file names (never `C:\...` in an scp command: scp reads `C` as a computer name, see guide 10 section 3).

PowerShell:
```
cd <your repo>\desktop\release
scp Gilded-Setup-0.2.0.exe Gilded-Setup-0.2.0.exe.blockmap deploy@2.31.136.48:/home/deploy/gilded/deploy/updates/win/beta/
scp latest.yml deploy@2.31.136.48:/home/deploy/gilded/deploy/updates/win/beta/
```
Git Bash: the same two lines, after `cd /c/Users/<you>/.../desktop/release` (or wherever your repo is, with `/c/` for drive C).

**Always copy `latest.yml` last, in its own command.** It is the signpost; if it appeared before the installer, a computer could find a signpost pointing at a file that is not there yet.

Check from your laptop (any browser, or `curl -I`):
- `https://app.gildedgold.org/updates/win/beta/latest.yml` shows the text with `version: 0.2.0`.
- `https://app.gildedgold.org/updates/win/beta/Gilded-Setup-0.2.0.exe` starts a download (not a 404).
On the server, `ls -l ~/gilded/deploy/updates/win/beta` should list all three. If the browser says forbidden: `chmod 644 ~/gilded/deploy/updates/win/beta/*`.

## 5. Try it on one computer (the beta computer)
One test computer (yours) follows the beta folder. Do this once on it:
1. Open `%APPDATA%\Gilded\config.json` (paste that into the Windows Explorer address bar). If the file does not exist, create it with exactly: `{ "channel": "beta" }`. If it exists, add `"channel": "beta"` to it and keep the other lines.
2. Start Gilded. Within a minute (or press *Check for updates* in My settings > This device) it downloads 0.2.0; press **Restart to update**.
3. Use the new version for a day: sign in, make a purchase, check the screens you changed, check the hub computer behaviour if you changed the hub.

Why the installer says `stable` while the test computer says `beta`: the channel is chosen **per computer** by that `config.json`, so the very same installer file is tested on beta and then shipped to stable. Never build a separate "beta installer": if it were copied to stable, every branch computer would start reading the beta folder.

## 6. Promote to stable (on the server, after a good day on beta)
No rebuild, no new upload: the identical files move across. SSH in (`ssh deploy@2.31.136.48`), then:
```
cd ~/gilded/deploy/updates/win
cp -p beta/Gilded-Setup-0.2.0.exe beta/Gilded-Setup-0.2.0.exe.blockmap stable/
cp -p beta/latest.yml stable/latest.yml
ls -l stable
```
(`latest.yml` last again.) Check `https://app.gildedgold.org/updates/win/stable/latest.yml` shows `version: 0.2.0`.
From now on every branch computer picks it up within 4 hours of having a connection.

## 7. Tell the branches
- "A new version is coming. When you see **Restart to update**, press it when no customer is being served, or just close Gilded at the end of the day."
- **The hub computer of each branch restarts last and outside busy hours**: while it restarts, the other computers in the branch briefly lose the shared drawer.
- Nobody loses entries: everything waiting to be sent stays in the app and is sent after the restart.

## 8. New computers (first install)
A new computer has no updater yet, so install by hand: open `https://app.gildedgold.org/updates/win/stable/Gilded-Setup-0.2.0.exe` on it (or copy the file with a flash drive), run it, accept "Run anyway" if shown. It then keeps itself current. Server address and company are built in; nobody types anything.

## 9. Tidy and roll back
- Keep the **last two or three** installers in each folder; delete older ones (and their `.blockmap`) on the server with `rm`. Never delete the installer that `latest.yml` names.
- **A bad version reached stable?** Computers do not go back by themselves (downgrades are off). Do this in order: (1) put the previous version's `latest.yml` back in `stable/` (keep a copy of each release's `latest.yml`, e.g. `latest-0.1.0.yml`) so computers that have not updated yet stay where they are; (2) fix the problem and release a **higher** number (0.2.1) through sections 2 to 6. Computers already on the bad version get 0.2.1 as their next update.

## 10. Checklist (print this)
1. Server updated first (guide 09) and working.
2. Version raised in `desktop/package.json`; `defaults.json` correct; branch, PR, merge, tag `desktop-vX.Y.Z`.
3. Build on Windows from master; `latest.yml` shows the new version.
4. scp the `.exe` and `.blockmap`, then `latest.yml`, to `updates/win/beta/`; check the two web addresses.
5. Beta computer updates and is used for a day.
6. On the server copy beta > stable (`latest.yml` last); check the stable address.
7. Tell branches; hub computers restart last.

## If something goes wrong
| What you see | Why, and what to do |
|---|---|
| A computer never offers the update | The version in `latest.yml` is not higher than the installed one; or the app is a development copy (only installed copies update); or the computer has no connection; or `latest.yml` is not in the folder that computer's channel reads. Open `https://app.gildedgold.org/updates/win/stable/latest.yml` in a browser to see what the server really says. |
| `latest.yml` shows 404 | Wrong folder or file name on the server. Check `ls ~/gilded/deploy/updates/win/stable`. |
| "Forbidden" or the installer will not download | File permissions: `chmod 644` the files in that folder. |
| Download starts and then fails with a checksum error | The `.exe` was replaced after `latest.yml` was made. Rebuild, and upload all three files again from the same build. |
| `scp` says "No such file or directory" or tries a host called C | Go into `desktop\release` first and use bare file names (guide 10, section 3). The server folders `updates/win/beta` and `stable` already exist (they come with the repo). |
| After `git pull` on the server the installers vanish | They are ignored by Git so normal pulls leave them alone. Only `git clean -fdx` deletes them. Never run that in `~/gilded`. |
| Windows warns "protected your PC" | Normal for an unsigned installer; "More info > Run anyway". A code-signing certificate removes it. |