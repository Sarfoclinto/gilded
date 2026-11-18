import type { DailyBought, PricePoint } from "./api";

/** One troy ounce in grams: world gold prices are quoted per troy ounce of pure gold. */
export const TROY_OUNCE_GRAMS = 31.1034768;

export const RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "3 months" },
  { days: 365, label: "1 year" },
] as const;

export interface LinePoint {
  /** Seconds since 1970 (what the chart library wants). */
  time: number;
  value: number;
}

const seconds = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

/**
 * The price as a line through time. Each change is a point; the line starts where the period starts (with the price that was already
 * in force then) and runs on to "now" with the last price, because a price stays in force until it is changed.
 * Times are strictly increasing, as the chart requires: when several changes fall in the same second the last one wins.
 */
export function priceLine(
  points: PricePoint[],
  from: string,
  now: string,
  pick: (p: PricePoint) => string = (p) => p.price,
): LinePoint[] {
  const start = seconds(from);
  const end = Math.max(seconds(now), start);
  const out: LinePoint[] = [];
  for (const p of points) {
    const time = Math.min(Math.max(seconds(p.at), start), end);
    const value = Number(pick(p));
    if (!Number.isFinite(value)) continue;
    const last = out[out.length - 1];
    if (last && time <= last.time) last.value = value;
    else out.push({ time, value });
  }
  const last = out[out.length - 1];
  if (last && end > last.time) out.push({ time: end, value: last.value });
  return out;
}

export interface PriceStats {
  current: number;
  base: number;
  margin: number;
  /** When the current price came into force. */
  since: string;
  /** The price before the current one, and the difference; null when there was no other price in the period. */
  previous: number | null;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  /** How many times the price changed in the period. */
  changes: number;
  provisional: boolean;
}

/** The figures beside the chart. Null when the branch has no price in the period at all. */
export function priceStats(points: PricePoint[]): PriceStats | null {
  const last = points[points.length - 1];
  if (!last) return null;
  const current = Number(last.price);
  // the last point whose price differs from the current one: the price before this one
  let previous: number | null = null;
  let since = last.at;
  for (let i = points.length - 2; i >= 0; i--) {
    const v = Number(points[i]!.price);
    if (v !== current) {
      previous = v;
      break;
    }
    since = points[i]!.at;
  }
  const values = points.map((p) => Number(p.price));
  let changes = 0;
  for (let i = 1; i < values.length; i++)
    if (values[i] !== values[i - 1]) changes++;
  const change = previous === null ? 0 : current - previous;
  return {
    current,
    base: Number(last.base),
    margin: Number(last.margin),
    since,
    previous,
    change,
    changePercent: previous ? (change / previous) * 100 : 0,
    high: Math.max(...values),
    low: Math.min(...values),
    changes,
    provisional: last.status !== "approved",
  };
}

/** The price changes, newest first, each with the step from the one before. Rows where nothing changed are left out. */
export function priceChanges(
  points: PricePoint[],
  limit = 12,
): (PricePoint & { step: number | null })[] {
  const out: (PricePoint & { step: number | null })[] = [];
  let before: number | null = null;
  for (const p of points) {
    const v = Number(p.price);
    if (before === null || v !== before)
      out.push({ ...p, step: before === null ? null : v - before });
    before = v;
  }
  return out.reverse().slice(0, limit);
}

export interface BoughtTotals {
  purchases: number;
  top: number;
  amount: number;
  /** Average price per pound over the whole period, weighted by weight. */
  avgPrice: number | null;
  days: number;
}

export function boughtTotals(daily: DailyBought[]): BoughtTotals {
  let purchases = 0;
  let top = 0;
  let amount = 0;
  let weighted = 0;
  let weight = 0;
  for (const d of daily) {
    purchases += d.purchases;
    top += Number(d.top);
    amount += Number(d.amount);
    if (d.avgPrice) {
      weighted += Number(d.avgPrice) * Number(d.top);
      weight += Number(d.top);
    }
  }
  return {
    purchases,
    top,
    amount,
    avgPrice: weight > 0 ? weighted / weight : null,
    days: daily.length,
  };
}

/**
 * A world price (US dollars per troy ounce of pure gold) as cedis per pound of pure gold, to hold against the branch's price.
 * A rough guide only: the branch's price is set from GoldBod, for the purity its formula refers to, not from this.
 */
export function worldToPound(
  usdPerOunce: number,
  cedisPerDollar: number,
  poundGrams: number,
): number | null {
  if (!(usdPerOunce > 0) || !(cedisPerDollar > 0) || !(poundGrams > 0))
    return null;
  return (usdPerOunce / TROY_OUNCE_GRAMS) * poundGrams * cedisPerDollar;
}

export interface WorldMove {
  /** GoldBod's world price when it published (USD per ounce). */
  goldbod: number;
  /** The world price now. */
  live: number;
  change: number;
  percent: number;
  direction: "up" | "down" | "flat";
}

/** How far the world price has moved since GoldBod published its figure. Null when either number is missing. Under a cent is "flat". */
export function worldMove(
  goldbod: string | null | undefined,
  live: string | null | undefined,
): WorldMove | null {
  const g = Number(goldbod);
  const l = Number(live);
  if (!goldbod || !live || !(g > 0) || !(l > 0)) return null;
  const change = Math.round((l - g) * 100) / 100;
  const direction =
    Math.abs(change) < 0.01 ? "flat" : change > 0 ? "up" : "down";
  return {
    goldbod: g,
    live: l,
    change: direction === "flat" ? 0 : change,
    percent: direction === "flat" ? 0 : (change / g) * 100,
    direction,
  };
}

/** "USD 3,759.35" */
export const usd = (n: number) =>
  `USD ${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
