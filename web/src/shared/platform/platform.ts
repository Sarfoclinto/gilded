import { create } from "zustand";

/**
 * What the desktop app (Electron) offers the web app. In a normal browser `window.gilded` does not exist and every helper
 * here falls back to the browser's own behaviour, so the same code runs in both.
 */
export interface PrinterInfo {
  name: string;
  displayName: string;
  isDefault: boolean;
}
export type DesktopUpdate =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "downloading"; version: string; percent: number }
  | { state: "ready"; version: string };

export interface GildedBridge {
  isDesktop: true;
  version: string;
  apiUrl: string | null;
  printers: {
    list(): Promise<PrinterInfo[]>;
    print(opts: { deviceName?: string; silent?: boolean }): Promise<boolean>;
  };
  updater: {
    status(): Promise<DesktopUpdate>;
    check(): Promise<void>;
    install(): Promise<void>;
    onStatus(cb: (s: DesktopUpdate) => void): () => void;
  };
}

declare global {
  interface Window {
    gilded?: GildedBridge;
  }
}

export const desktop = (): GildedBridge | null =>
  typeof window === "undefined" ? null : (window.gilded ?? null);

/**
 * Prints the page the person is looking at. On the desktop app with a printer chosen for this computer it prints straight to it,
 * with no dialog; otherwise the browser's normal print window opens.
 */
export async function printPage(printerName: string): Promise<void> {
  const d = desktop();
  if (d && printerName) {
    const ok = await d.printers
      .print({ deviceName: printerName, silent: true })
      .catch(() => false);
    if (ok) return;
  }
  if (d) {
    await d.printers.print({ silent: false }).catch(() => false); // desktop app: its own print dialog
    return;
  }
  window.print();
}

interface UpdateState {
  update: DesktopUpdate;
}
export const useDesktopUpdate = create<UpdateState>(() => ({
  update: { state: "idle" },
}));

/** Call once at start in the desktop app: follows the updater's progress. */
export function followDesktopUpdates() {
  const d = desktop();
  if (!d) return;
  void d.updater
    .status()
    .then((update) => useDesktopUpdate.setState({ update }));
  d.updater.onStatus((update) => useDesktopUpdate.setState({ update }));
}
