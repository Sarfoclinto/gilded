import { contextBridge, ipcRenderer } from 'electron';

/** The only things the web app may ask of the computer. Nothing else of Node or Electron is visible to it. */
const api = {
  isDesktop: true as const,
  version: ipcRenderer.sendSync('app:version') as string,
  apiUrl: ipcRenderer.sendSync('server:get') as string | null,
  printers: {
    list: () => ipcRenderer.invoke('printers:list') as Promise<Array<{ name: string; displayName: string; isDefault: boolean }>>,
    print: (opts: { deviceName?: string; silent?: boolean }) => ipcRenderer.invoke('printers:print', opts) as Promise<boolean>,
  },
  updater: {
    status: () => ipcRenderer.invoke('updater:status'),
    check: () => ipcRenderer.invoke('updater:check'),
    install: () => ipcRenderer.invoke('updater:install'),
    onStatus: (cb: (s: unknown) => void) => {
      const h = (_e: unknown, s: unknown) => cb(s);
      ipcRenderer.on('updater:status', h);
      return () => ipcRenderer.removeListener('updater:status', h);
    },
  },
  /** Branch computers: one is the hub, the others join it with a code. */
  hub: {
    state: () => ipcRenderer.invoke('hub:state'),
    become: (branchId: string, name: string) => ipcRenderer.invoke('hub:become', branchId, name),
    off: () => ipcRenderer.invoke('hub:off'),
    newCode: () => ipcRenderer.invoke('hub:newCode'),
    revoke: (id: string) => ipcRenderer.invoke('hub:revoke', id),
    join: (text: string) => ipcRenderer.invoke('hub:join', text),
    share: {
      submit: (r: unknown) => ipcRenderer.invoke('hub:share:submit', r),
      since: (after: number) => ipcRenderer.invoke('hub:share:since', after),
      snapshot: (state: unknown, asOf: string) => ipcRenderer.invoke('hub:share:snapshot', state, asOf),
    },
    onState: (cb: (s: unknown) => void) => {
      const h = (_e: unknown, s: unknown) => cb(s);
      ipcRenderer.on('hub:state', h);
      return () => ipcRenderer.removeListener('hub:state', h);
    },
  },
  /** For the landing page only. */
  launch: {
    info: () => ipcRenderer.invoke('launch:info') as Promise<{ companyName: string; version: string; configured: boolean }>,
    check: () => ipcRenderer.invoke('launch:check') as Promise<{ online: boolean }>,
    open: () => ipcRenderer.invoke('launch:open') as Promise<void>,
    server: () => ipcRenderer.invoke('launch:server') as Promise<string | null>,
    setServer: (text: string) => ipcRenderer.invoke('launch:setServer', text) as Promise<{ ok: true; url: string } | { ok: false; message: string }>,
  },
};

contextBridge.exposeInMainWorld('gilded', api);