import { app, BrowserWindow, ipcMain, Menu, net, protocol, session, shell } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveAsset } from './assets';
import { adjustResponseHeaders, APP_ORIGIN } from './cors';
import { readConfig, writeConfig, type Config } from './config';
import { isInsecure, mayTrustSelfSigned, normalizeServerUrl } from './serverUrl';
import { startUpdater } from './updater';
import { HubError } from './hub/client';
import { HubManager, type HubState } from './hub/manager';

// For testing and for IT: keep this app's data in a chosen folder.
if (process.env.GILDED_USER_DATA) app.setPath('userData', process.env.GILDED_USER_DATA);

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const webRoot = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', '..', 'web', 'dist');
const assetsDir = path.join(__dirname, '..', 'assets');

let win: BrowserWindow | null = null;
let config: Config;
let hubManager: HubManager;

let companyName = 'Gilded';
let allowSelfSigned = process.env.GILDED_ALLOW_SELF_SIGNED === '1';
const bakedDefaults = (): Partial<Config> => {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(assetsDir, 'defaults.json'), 'utf8')) as Partial<Config> & { companyName?: string };
    if (d.companyName?.trim()) companyName = d.companyName.trim();
    if ((d as { allowSelfSigned?: boolean }).allowSelfSigned === true) allowSelfSigned = true;
    return { serverUrl: (d.serverUrl && normalizeServerUrl(d.serverUrl)) || null, channel: d.channel === 'beta' ? 'beta' : 'stable' };
  } catch {
    return {};
  }
};

/**
 * Each company gets its own installer with its server built in (assets/defaults.json), so nobody types an address.
 * GILDED_SERVER_URL overrides it for development and testing (in development the API is http://localhost:5080).
 */
function loadConfig() {
  const baked = bakedDefaults();
  config = readConfig(app.getPath('userData'), baked);
  const fromEnv = process.env.GILDED_SERVER_URL && normalizeServerUrl(process.env.GILDED_SERVER_URL);
  // Order: the environment (testing), then an address chosen on this computer, then the one built into the installer.
  config = { ...config, serverUrl: fromEnv || config.serverUrl || null };
}

/** Every start shows the short landing page first (it checks the connection), then opens the app. */
function openLanding(change = false) {
  if (win) void win.loadFile(path.join(assetsDir, 'landing.html'), change ? { query: { change: '1' } } : undefined);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d1b2e',
    title: 'Gilded',
    icon: path.join(assetsDir, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.on('closed', () => (win = null));

  // Links that leave the app open in the normal browser; the app window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(`${APP_ORIGIN}/`) || url.startsWith('file://')) return;
    e.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });
  openLanding();
}

function installServerAccess() {
  // Testing on the branch network: trust the one private-address server's own certificate (see serverUrl.ts). Everything else is checked normally.
  session.defaultSession.setCertificateVerifyProc((req, cb) => cb(mayTrustSelfSigned(config.serverUrl, req.hostname, allowSelfSigned) ? 0 : -3));
  app.on('certificate-error', (event, _wc, url, _error, _cert, cb) => {
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      /* not a URL */
    }
    if (mayTrustSelfSigned(config.serverUrl, host, allowSelfSigned)) {
      event.preventDefault();
      cb(true);
    } else cb(false);
  });
  // See cors.ts: only answers from the configured server are touched.
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    const server = config.serverUrl;
    if (!server || !details.url.startsWith(`${server}/`)) return cb({});
    const r = adjustResponseHeaders(details.responseHeaders ?? {}, details.method, (details as unknown as { requestHeaders?: Record<string, string> }).requestHeaders);
    cb({ responseHeaders: r.headers, ...(r.statusLine ? { statusLine: r.statusLine } : {}) });
  });
}

function installAppProtocol() {
  protocol.handle('app', async (req) => {
    const file = resolveAsset(webRoot, new URL(req.url).pathname);
    if (!file) return new Response('Not found', { status: 404 });
    const res = await net.fetch(pathToFileURL(file).toString()).catch(() => null);
    if (!res || !res.ok) return new Response('Not found', { status: 404 });
    // index.html and the service-worker-free shell must always be read fresh from the installed files.
    return res;
  });
}

async function checkServer(): Promise<boolean> {
  if (!config.serverUrl) return false;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    return (await net.fetch(`${config.serverUrl}/health/live`, { signal: ctl.signal })).ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

function wireIpc(updater: ReturnType<typeof startUpdater>) {
  ipcMain.on('app:version', (e) => (e.returnValue = app.getVersion()));
  ipcMain.on('server:get', (e) => (e.returnValue = config.serverUrl ? `${config.serverUrl}/api/v1` : null));
  ipcMain.handle('printers:list', async () => (win ? (await win.webContents.getPrintersAsync()).map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!(p as { isDefault?: boolean }).isDefault })) : []));
  ipcMain.handle('printers:print', (_e, opts: { deviceName?: string; silent?: boolean }) =>
    new Promise<boolean>((resolve) => {
      if (!win) return resolve(false);
      win.webContents.print({ silent: opts.silent ?? true, deviceName: opts.deviceName, printBackground: true, margins: { marginType: 'none' } }, (ok) => resolve(ok));
    }),
  );
  // Branch computers (see hub/): which role this computer has, pairing, status.
  const hubResult = async (fn: () => Promise<HubState> | HubState) => {
    try {
      return { ok: true as const, state: await fn() };
    } catch (e) {
      return { ok: false as const, message: e instanceof HubError ? e.message : 'That did not work. Try again.', code: e instanceof HubError ? e.code : 'ERROR' };
    }
  };
  ipcMain.handle('hub:state', () => hubManager.state());
  ipcMain.handle('hub:become', (_e, branchId: string, name: string) => hubResult(() => hubManager.becomeHub(String(branchId), String(name))));
  ipcMain.handle('hub:off', () => hubResult(() => hubManager.turnOff()));
  ipcMain.handle('hub:newCode', () => hubResult(() => hubManager.newCode()));
  ipcMain.handle('hub:revoke', (_e, id: string) => hubResult(() => hubManager.revoke(String(id))));
  ipcMain.handle('hub:join', (_e, text: string) => hubResult(() => hubManager.join(String(text), os.hostname())));
  ipcMain.handle('hub:share:submit', (_e, r) => hubManager.share((a) => a.submit(r)));
  ipcMain.handle('hub:share:since', (_e, after: number) => hubManager.share((a) => a.since(Number(after) || 0)));
  ipcMain.handle('hub:share:snapshot', (_e, state, asOf: string) => hubManager.share((a) => a.snapshot(state, String(asOf))));
  hubManager.onChange((s) => win?.webContents.send('hub:state', s));
  ipcMain.handle('updater:status', () => updater.status());
  ipcMain.handle('updater:check', () => updater.check());
  ipcMain.handle('updater:install', () => updater.install());
  ipcMain.handle('launch:info', () => ({ companyName, version: app.getVersion(), configured: !!config.serverUrl }));
  ipcMain.handle('launch:server', () => config.serverUrl);
  // Choosing the company server on this computer (no new installer needed). Kept in this computer's settings file.
  ipcMain.handle('launch:setServer', (_e, text: string) => {
    const url = normalizeServerUrl(String(text ?? ''));
    if (!url) return { ok: false as const, message: 'That does not look like an address. Example: https://gilded.yourcompany.com or http://localhost' };
    config = { ...config, serverUrl: url };
    writeConfig(app.getPath('userData'), config);
    return { ok: true as const, url };
  });
  ipcMain.handle('launch:check', async () => ({ online: await checkServer() }));
  ipcMain.handle('launch:open', () => {
    if (win && config.serverUrl) void win.loadURL(`${APP_ORIGIN}/`);
  });
}

function buildMenu(updater: ReturnType<typeof startUpdater>) {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Gilded',
        submenu: [
          { label: 'Check for updates', click: () => void updater.check() },
          { label: 'Change server address…', click: () => openLanding(true) },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }] },
    ]),
  );
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  void app.whenReady().then(() => {
    loadConfig();
    installAppProtocol();
    installServerAccess();
    const updater = startUpdater(
      () => (app.isPackaged && config.serverUrl ? `${config.serverUrl}/updates/win/${config.channel}` : null),
      () => win,
    );
    hubManager = new HubManager({ dir: path.join(app.getPath('userData'), 'hub') });
    wireIpc(updater);
    void hubManager.start();
    buildMenu(updater);
    createWindow();
    if (config.serverUrl && isInsecure(config.serverUrl)) console.warn('Server address is plain http over the internet; use https.');
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => void hubManager?.stop());
}