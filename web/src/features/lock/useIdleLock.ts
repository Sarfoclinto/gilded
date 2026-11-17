import { useEffect } from "react";
import { useAuth } from "@/features/auth/store";
import { useSettings } from "@/features/settings/api";
import { lastActive, markActive, shouldLock, useLock } from "./store";

const EVENTS = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
  "scroll",
] as const;

/**
 * Locks the screen after the company's idle time (Company settings, 5 minutes unless changed; 0 never locks). Any tap, key, scroll or
 * wheel in any tab of the app counts as activity. A computer that slept is checked the moment it wakes.
 */
export function useIdleLock() {
  const userId = useAuth((s) => s.user?.id ?? null);
  const status = useAuth((s) => s.status);
  const minutes = useSettings()["session.lockMinutes"];
  const locked = useLock((s) => !!s.lock && s.lock.userId === userId);

  useEffect(() => {
    if (!userId || status !== "authenticated") return;
    if (!lastActive()) markActive();
    let lastWrite = 0;
    const seen = () => {
      if (useLock.getState().lock) return; // typing a PIN is not "activity" for the page behind it
      const now = Date.now();
      if (now - lastWrite > 5_000) {
        lastWrite = now;
        markActive(now);
      }
    };
    const check = () => {
      if (shouldLock(minutes, lastActive(), Date.now()))
        useLock.getState().lockNow(userId, "idle");
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === "gold.lock.v1") useLock.getState().sync();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    for (const ev of EVENTS)
      window.addEventListener(ev, seen, { passive: true, capture: true });
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    const t = setInterval(check, 10_000);
    check();
    return () => {
      for (const ev of EVENTS)
        window.removeEventListener(ev, seen, { capture: true });
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(t);
    };
  }, [userId, status, minutes]);

  return locked;
}
