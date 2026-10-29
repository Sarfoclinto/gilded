import type { CurrentPrice } from "./api";

export const validPrice = (v: string) =>
  /^\d+(\.\d{1,2})?$/.test(v.trim()) && Number(v) > 0;
export const validMargin = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.trim());

export interface Change {
  /** Percent change from the current reference price (positive = higher). */
  pct: number;
  /** warn: 5% or more, worth a second look before publishing to every branch. */
  level: "same" | "note" | "warn";
}

export function priceChange(
  current: string | null | undefined,
  next: string,
): Change | null {
  const a = Number(current);
  const b = Number(next);
  if (!current || !(a > 0) || !validPrice(next)) return null;
  const pct = ((b - a) / a) * 100;
  return {
    pct,
    level:
      Math.abs(pct) < 0.005 ? "same" : Math.abs(pct) >= 5 ? "warn" : "note",
  };
}

/** What a branch would pay per pound with a margin: reference plus margin, to pesewas. */
export function effectiveWith(base: string, margin: string): string | null {
  if (!validMargin(margin) || !/^\d+(\.\d+)?$/.test(base)) return null;
  return (Math.round((Number(base) + Number(margin)) * 100) / 100).toFixed(2);
}

export const pendingBranches = (prices: (CurrentPrice | null | undefined)[]) =>
  prices.filter((p): p is CurrentPrice => !!p && p.status === "provisional");

/** Whole calendar days since the price was set. */
export function staleDays(asOf: string, now: Date = new Date()): number {
  const day = (d: Date) =>
    Math.floor(
      Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000,
    );
  return Math.max(0, day(now) - day(new Date(asOf)));
}

export const updatedText = (days: number) =>
  days === 0
    ? "Updated today"
    : days === 1
      ? "Updated yesterday"
      : `Updated ${days} days ago`;
