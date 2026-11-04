import { contextBridge, ipcRenderer } from "electron";

/** The only things the web app may ask of the computer. Nothing else of Node or Electron is visible to it. */
const api = {
  isDesktop: true as const,
  version: ipcRenderer.sendSync("app:version") as string,
  apiUrl: ipcRenderer.sendSync("server:get") as string | null,
  printers: {
    list: () =>
      ipcRenderer.invoke("printers:list") as Promise<
        Array<{ name: string; displayName: string; isDefault: boolean }>
      >,
    print: (opts: { deviceName?: string; silent?: boolean }) =>
      ipcRenderer.invoke("printers:print", opts) as Promise<boolean>,
  },
  updater: {
    status: () => ipcRenderer.invoke("updater:status"),
    check: () => ipcRenderer.invoke("updater:check"),
    install: () => ipcRenderer.invoke("updater:install"),
    onStatus: (cb: (s: unknown) => void) => {
      const h = (_e: unknown, s: unknown) => cb(s);
      ipcRenderer.on("updater:status", h);
      return () => ipcRenderer.removeListener("updater:status", h);
    },
  },
  /** For the landing page only. */
  launch: {
    info: () =>
      ipcRenderer.invoke("launch:info") as Promise<{
        companyName: string;
        version: string;
        configured: boolean;
      }>,
    check: () =>
      ipcRenderer.invoke("launch:check") as Promise<{ online: boolean }>,
    open: () => ipcRenderer.invoke("launch:open") as Promise<void>,
  },
};

contextBridge.exposeInMainWorld("gilded", api);
