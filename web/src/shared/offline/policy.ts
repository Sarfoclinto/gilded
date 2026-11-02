/**
 * How long a device may keep working with no connection. One place, so the cache, the customer list and
 * offline sign-in all agree. A later slice lets the Director change these per company.
 */
export const OFFLINE_DAYS = 7;
export const OFFLINE_MAX_AGE_MS = OFFLINE_DAYS * 24 * 60 * 60 * 1000;

/** "just now", "5 min ago", "3 h ago", "2 days ago": for showing how old a stored copy is. */
export function ageLabel(at: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - at) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** Query-key roots kept on the device between visits (and through sign-out). Everything else is dropped on sign-out. */
export const PERSISTED_ROOTS: ReadonlySet<string> = new Set(['prices', 'branches', 'days']);