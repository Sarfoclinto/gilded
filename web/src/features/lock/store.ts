import { create } from "zustand";

/**
 * The lock: per person, kept in browser storage so a reload or a second tab cannot get past it, and shared between tabs.
 * Activity in any tab counts (one shared "last seen" time), so working in one tab never locks another.
 */
const LOCK_KEY = "gold.lock.v1";
const SEEN_KEY = "gold.lastActive.v1";
export const MAX_PIN_TRIES = 5;

export interface LockState {
  userId: string;
  at: number;
  reason: "idle" | "manual";
  tries: number;
}

function readLock(): LockState | null {
  try {
    const v = JSON.parse(
      localStorage.getItem(LOCK_KEY) ?? "null",
    ) as LockState | null;
    return v && typeof v.userId === "string" ? v : null;
  } catch {
    return null;
  }
}
function writeLock(v: LockState | null) {
  try {
    if (v) localStorage.setItem(LOCK_KEY, JSON.stringify(v));
    else localStorage.removeItem(LOCK_KEY);
  } catch {
    /* storage blocked: the lock lives in this tab only */
  }
}

export function lastActive(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}
export function markActive(now = Date.now()) {
  try {
    localStorage.setItem(SEEN_KEY, String(now));
  } catch {
    /* ignore */
  }
}

/** True when the screen should lock now: a limit is set and nobody has touched the app (in any tab) for that long. */
export function shouldLock(
  minutes: number,
  lastSeen: number,
  now: number,
): boolean {
  if (!Number.isFinite(minutes) || minutes <= 0 || !lastSeen) return false;
  return now - lastSeen >= minutes * 60_000;
}

interface Store {
  lock: LockState | null;
  lockNow: (userId: string, reason: LockState["reason"]) => void;
  unlock: () => void;
  wrongPin: () => number;
  /** Re-read from storage (another tab locked or unlocked). */
  sync: () => void;
}

export const useLock = create<Store>((set, get) => ({
  lock: readLock(),
  lockNow: (userId, reason) => {
    if (get().lock?.userId === userId) return;
    const v: LockState = { userId, at: Date.now(), reason, tries: 0 };
    writeLock(v);
    set({ lock: v });
  },
  unlock: () => {
    writeLock(null);
    markActive();
    set({ lock: null });
  },
  wrongPin: () => {
    const cur = get().lock;
    if (!cur) return 0;
    const v = { ...cur, tries: cur.tries + 1 };
    writeLock(v);
    set({ lock: v });
    return MAX_PIN_TRIES - v.tries;
  },
  sync: () => set({ lock: readLock() }),
}));

/** Clears any lock (a full sign-in with the password, or signing out). */
export function clearLock() {
  writeLock(null);
  useLock.setState({ lock: null });
}
