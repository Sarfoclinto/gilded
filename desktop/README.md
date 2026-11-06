# Gilded desktop (Windows)

The web app inside a window, packaged as an installer. It carries its own copy of the app, so it **opens with no internet, from the first launch**; data lives in the window's own storage on the computer (same offline behaviour as the web app: stored price/customers, offline sign-in, outbox). It talks to your company server when there is a connection.

## Build the installer (on a Windows machine)
```
npm install                      # at the repo root, once
npm run dist -w @gold/desktop    # builds the web app, the desktop code, then the installer
```
Result in `desktop/release/`: `Gilded-Setup-<version>.exe`, `Gilded-Setup-<version>.exe.blockmap`, `latest.yml`.
For a quick look without installing: `npm run start -w @gold/desktop` (uses `web/dist`; run `npm run build -w @gold/web` first).

## One installer per company
Each company has its own server and its own installer. Before building, put that company's details in `desktop/assets/defaults.json`:
```
{ "companyName": "Gilded", "serverUrl": "https://gilded.yourcompany.com", "channel": "stable" }
```
Nobody types an address. On every start the app shows a short landing page (company name, "Connecting…" then **Connected** or **No connection**) and opens the app by itself: with no connection it opens straight away from the data stored on the computer.

**What is the server address?** The address of the **backend**: the one that answers `/api/v1/...` and `/health/live`. In production the Caddy front door serves the website *and* the API on one address, so it is simply the company's web address (e.g. `https://gilded.yourcompany.com`, no path). In development the backend is `http://localhost:5080`; `localhost:5173` is only Vite's page server and is **not** what the desktop app needs. To try the desktop app against your dev backend: `GILDED_SERVER_URL=http://localhost:5080 npm run start -w @gold/desktop`.

## Trying it on a local network before there is a real certificate
For a server on a private address (192.168.x.x, 10.x.x.x) with a development HTTPS certificate, add `"allowSelfSigned": true` to `desktop/assets/defaults.json` (or set `GILDED_ALLOW_SELF_SIGNED=1`). The app then trusts that one server's certificate, and only when its address is private and it is `https`; a company server on the internet is never affected. Plain `http://192.168.x.x` does **not** work for sign-in: browsers refuse to keep the "Secure" refresh cookie from http, so people would be signed out after 15 minutes. Use https. Never ship an installer with `allowSelfSigned` set. Step-by-step: `docs/LOCAL-HARDWARE-TEST.md`.

## Updates (auto-update)
Computers check `<server>/updates/win/<channel>/latest.yml` at start and every 4 hours, download new versions quietly, and show "Restart now" (it also installs by itself the next time the app is closed). No connection = nothing happens, the app keeps working.
To release a version:
1. Raise `version` in `desktop/package.json` (e.g. 0.2.0), build the installer.
2. Copy the three files from `desktop/release/` to `deploy/updates/win/stable/` on the server (`deploy/updates` is mounted into the web container; no restart needed).
Use `deploy/updates/win/beta/` and `"channel": "beta"` on a test computer to try a version on your own branch first.
The installer contains the web app of that moment and that company's server address. If a server release needs a newer app, release both together.

## Printing
My settings → This device → **Receipt printer**: pick any printer Windows knows (A4, or a thermal receipt printer once its Windows driver is installed). Receipts then print without a dialog. Reports (e.g. the daily account) always open the print dialog.
Direct ESC/POS to a thermal printer that has no Windows driver is not built yet.

## Windows SmartScreen
An unsigned installer shows "Windows protected your PC → More info → Run anyway". To remove it, sign the installer with a code-signing certificate: set `CSC_LINK` (path/URL to the .pfx) and `CSC_KEY_PASSWORD` in the environment before `npm run dist`. Updates then also verify the publisher.

## How it works (for developers)
- `src/main.ts` serves the bundled web build at `app://gilded/` (secure origin: IndexedDB, crypto and storage work), loads it in a locked-down window (no Node in the page, navigation limited to the app, links open in the browser).
- `src/cors.ts`: calls to the configured server get the headers a cross-site call needs and the refresh cookie is made `SameSite=None; Secure`, only inside this app and only for that server. The server needs no change.
- `src/preload.ts` is the whole interface the web app gets (`window.gilded`: version, server address, printers, updater).
- Tests: `npm test -w @gold/desktop`.