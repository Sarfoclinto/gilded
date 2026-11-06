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

export type HubRole = "off" | "hub" | "member";
export type HubMemberState =
  | "connected"
  | "unreachable"
  | "different-hub"
  | "not-paired";
export interface HubDevice {
  id: string;
  name: string;
  pairedAt: string;
  lastSeen: string | null;
}
/** Which part this computer plays in its branch (see desktop/src/hub). */
export interface HubState {
  role: HubRole;
  hub?: {
    running: boolean;
    address: string;
    port: number;
    name: string;
    devices: HubDevice[];
    code: { text: string; code: string; expiresAt: string } | null;
    error?: string;
  };
  member?: {
    hubName: string;
    address: string;
    state: HubMemberState;
    lastOk: string | null;
  };
  /** This computer's own id in the hub's log. */
  selfId?: string;
}

/** The hub's answer to the screens, or why there was none. `unreachable` means: carry on alone. */
export type HubShare<T> =
  | { ok: true; data: T }
  | { ok: false; unreachable: boolean; message: string };
export interface HubSubmitResult {
  seq: number;
  covered: boolean;
  short: Record<string, number>;
  duplicate: boolean;
  taken?: boolean;
}
export interface HubLogEntry {
  seq: number;
  command: { id: string; type: string; payload: unknown };
  deviceId: string;
  userId: string;
}
export type HubResult =
  | { ok: true; state: HubState }
  | { ok: false; message: string; code: string };

export interface GildedBridge {
  isDesktop: true;
  version: string;
  apiUrl: string | null;
  printers: {
    list(): Promise<PrinterInfo[]>;
    print(opts: { deviceName?: string; silent?: boolean }): Promise<boolean>;
  };
  hub: {
    state(): Promise<HubState>;
    become(branchId: string, name: string): Promise<HubResult>;
    off(): Promise<HubResult>;
    newCode(): Promise<HubResult>;
    revoke(id: string): Promise<HubResult>;
    join(text: string): Promise<HubResult>;
    onState(cb: (s: HubState) => void): () => void;
    share: {
      submit(r: {
        command: { id: string; type: string; payload: unknown };
        userId: string;
        capturedAt: string;
        localSeq?: number;
        strict?: boolean;
      }): Promise<HubShare<HubSubmitResult>>;
      since(after: number): Promise<HubShare<HubLogEntry[]>>;
      snapshot(
        state: unknown,
        asOf: string,
      ): Promise<HubShare<{ accepted: boolean }>>;
    };
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

/** What this computer is in its branch. Shows as a plain computer (role 'off') in a browser and until the app says otherwise. */
export const useHubState = create<{ hub: HubState }>(() => ({
  hub: { role: "off" },
}));

export function followHub() {
  const d = desktop();
  if (!d?.hub) return;
  void d.hub
    .state()
    .then((hub) => useHubState.setState({ hub }))
    .catch(() => {});
  d.hub.onState((hub) => useHubState.setState({ hub }));
}

/** Runs a hub action and keeps the shared state in step; returns the message to show when it did not work. */
export async function runHub(
  fn: (h: GildedBridge["hub"]) => Promise<HubResult>,
): Promise<string | null> {
  const d = desktop();
  if (!d?.hub) return "This needs the Gilded desktop app.";
  const r = await fn(d.hub).catch(() => ({
    ok: false as const,
    message: "That did not work. Try again.",
    code: "ERROR",
  }));
  if (r.ok) {
    useHubState.setState({ hub: r.state });
    return null;
  }
  return r.message;
}
