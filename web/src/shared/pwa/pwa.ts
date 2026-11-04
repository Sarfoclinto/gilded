import { create } from "zustand";

/**
 * The installable, works-without-internet side of the web app (a service worker stores the whole app on the first visit).
 * - offlineReady: the app is now stored and will open with no connection
 * - needRefresh:  a newer version has been downloaded and waits for the person to agree (so it never lands mid-purchase)
 * - installEvent: the browser offers to install the app as its own window / home-screen icon
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface PwaState {
  offlineReady: boolean;
  needRefresh: boolean;
  installEvent: BeforeInstallPromptEvent | null;
  installed: boolean;
  persisted: boolean | null;
  apply: (() => Promise<void>) | null;
  dismissUpdate: () => void;
}

export const usePwa = create<PwaState>((set) => ({
  offlineReady: false,
  needRefresh: false,
  installEvent: null,
  installed:
    typeof window !== "undefined" &&
    window.matchMedia?.("(display-mode: standalone)").matches,
  persisted: null,
  apply: null,
  dismissUpdate: () => set({ needRefresh: false }),
}));

const HOUR = 60 * 60 * 1000;

/** Call once at start. Does nothing in development or where service workers do not exist. */
export async function startPwa(onOfflineReady?: () => void) {
  if (typeof window === "undefined") return;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    usePwa.setState({ installEvent: e as BeforeInstallPromptEvent });
  });
  window.addEventListener("appinstalled", () =>
    usePwa.setState({ installed: true, installEvent: null }),
  );

  void requestPersistentStorage();

  if (!("serviceWorker" in navigator) || import.meta.env.DEV || window.gilded)
    return; // the desktop app carries the files itself
  const { registerSW } = await import("virtual:pwa-register");
  const update = registerSW({
    immediate: true,
    onNeedRefresh: () => usePwa.setState({ needRefresh: true }),
    onOfflineReady: () => {
      usePwa.setState({ offlineReady: true });
      onOfflineReady?.();
    },
    onRegisteredSW: (_url, reg) => {
      // Look for a new version every hour while the app stays open (a till can stay open all week).
      if (reg)
        setInterval(() => void reg.update().catch(() => undefined), HOUR);
    },
  });
  usePwa.setState({ apply: () => update(true) });
}

/** Asks the browser not to evict our stored data when the disk is short. Returns whether it is protected. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    const ok =
      (await navigator.storage.persisted()) ||
      (await navigator.storage.persist());
    usePwa.setState({ persisted: ok });
    return ok;
  } catch {
    return false;
  }
}

export async function promptInstall() {
  const e = usePwa.getState().installEvent;
  if (!e) return;
  await e.prompt();
  const { outcome } = await e.userChoice;
  if (outcome === "accepted") usePwa.setState({ installEvent: null });
}
