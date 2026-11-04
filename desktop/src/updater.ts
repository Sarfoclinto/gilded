import { autoUpdater } from "electron-updater";
import type { BrowserWindow } from "electron";

export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "downloading"; version: string; percent: number }
  | { state: "ready"; version: string }
  | { state: "error"; message: string };

const FOUR_HOURS = 4 * 60 * 60 * 1000;

/**
 * Updates come from the company's own server: <server>/updates/win/<channel>/latest.yml plus the installer next to it.
 * - downloads quietly in the background; nothing is installed while someone is working
 * - "ready" waits for the person to press Restart (otherwise it installs when the app is next closed)
 * - no connection is not an error worth showing: the check just tries again later
 */
export function startUpdater(
  getFeed: () => string | null,
  getWindow: () => BrowserWindow | null,
) {
  let status: UpdateStatus = { state: "idle" };
  const push = (s: UpdateStatus) => {
    status = s;
    getWindow()?.webContents.send("updater:status", s);
  };

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.on("checking-for-update", () => push({ state: "checking" }));
  autoUpdater.on("update-not-available", () => push({ state: "idle" }));
  autoUpdater.on("update-available", (i) =>
    push({ state: "downloading", version: i.version, percent: 0 }),
  );
  autoUpdater.on("download-progress", (p) =>
    push({
      state: "downloading",
      version: (status as { version?: string }).version ?? "",
      percent: Math.round(p.percent),
    }),
  );
  autoUpdater.on("update-downloaded", (i) =>
    push({ state: "ready", version: i.version }),
  );
  autoUpdater.on("error", () => push({ state: "idle" }));

  const check = async () => {
    const feed = getFeed();
    if (!feed) return;
    autoUpdater.setFeedURL({ provider: "generic", url: feed });
    try {
      await autoUpdater.checkForUpdates();
    } catch {
      push({ state: "idle" });
    }
  };

  setTimeout(() => void check(), 5_000);
  setInterval(() => void check(), FOUR_HOURS);

  return {
    check,
    status: () => status,
    install: () => autoUpdater.quitAndInstall(false, true),
  };
}
