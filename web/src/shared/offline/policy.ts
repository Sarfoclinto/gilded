/**
 * How long a device may keep working with no connection. One place, so the cache, the customer list and
 * offline sign-in all agree. The company sets the number (Settings > Working offline); each device remembers the value
 * it last heard, because the rules must still apply when there is no connection to ask.
 */
export const DEFAULT_OFFLINE_DAYS = 7;
const KEY = "gold.offlineDays.v1";
const DAY = 24 * 60 * 60 * 1000;

export const clampDays = (n: unknown): number => {
  const v =
    typeof n === "number" && Number.isFinite(n)
      ? Math.round(n)
      : DEFAULT_OFFLINE_DAYS;
  return Math.min(30, Math.max(1, v));
};

export function offlineDays(): number {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? DEFAULT_OFFLINE_DAYS : clampDays(Number(raw));
  } catch {
    return DEFAULT_OFFLINE_DAYS;
  }
}

/** Remember what the company decided (called whenever the settings load). */
export function rememberOfflineDays(n: unknown) {
  try {
    localStorage.setItem(KEY, String(clampDays(n)));
  } catch {
    /* storage blocked: the default applies */
  }
}

export const offlineMaxAgeMs = () => offlineDays() * DAY;

/** "just now", "5 min ago", "3 h ago", "2 days ago": for showing how old a stored copy is. */
export function ageLabel(at: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - at) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** Query-key roots kept on the device between visits (and through sign-out). Everything else is dropped on sign-out. */
export const PERSISTED_ROOTS: ReadonlySet<string> = new Set([
  "prices",
  "branches",
  "days",
  "settings",
  "transactions",
  "debts",
  "collateral",
]);
