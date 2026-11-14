import type { Permission } from "@/config/permissions";
import paths from "@/config/paths";
import type { Dashboard } from "./api";

export type HomeView = "teller" | "manager" | "director";

/** Which home screen a person gets, decided by what they may do, not by the role's name (companies can add roles). */
export function viewFor(permissions: readonly string[]): HomeView {
  const has = (p: Permission) => permissions.includes(p);
  if (has("prices:approve")) return "director";
  if (has("reports:read")) return "manager";
  return "teller";
}

export interface Change {
  /** Whole percent, or null when there is nothing to compare with. */
  pct: number | null;
  dir: "up" | "down" | "flat";
}

export function change(now: number, before: number): Change {
  if (!(before > 0)) return { pct: null, dir: now > 0 ? "up" : "flat" };
  const pct = Math.round(((now - before) / before) * 100);
  return { pct, dir: pct > 0 ? "up" : pct < 0 ? "down" : "flat" };
}

export const num = (v: string | number | undefined) => Number(v ?? 0);

/** Average paid per purchase; 0 when there were none. */
export const average = (paid: string | number, count: number) =>
  count > 0 ? num(paid) / count : 0;

export interface WindowTotals {
  paid: number;
  count: number;
  pounds: number;
  /** Mean per calendar day in the window. */
  perDay: number;
  best: { date: string; paid: number } | null;
}

export function windowTotals(series: Dashboard["series"]): WindowTotals {
  let paid = 0,
    count = 0,
    pounds = 0;
  let best: WindowTotals["best"] = null;
  for (const d of series) {
    const p = num(d.paid);
    paid += p;
    count += d.count;
    pounds += num(d.pounds);
    if (p > 0 && (!best || p > best.paid)) best = { date: d.date, paid: p };
  }
  return {
    paid,
    count,
    pounds,
    perDay: series.length ? paid / series.length : 0,
    best,
  };
}

export interface Segment {
  key: "cash" | "mobileMoney" | "owed";
  label: string;
  value: number;
  share: number;
}

/** The payment mix as shares that add up to 100 (zero parts left out). */
export function paymentSegments(p: Dashboard["payments"]): Segment[] {
  const parts = [
    { key: "cash" as const, label: "Cash", value: num(p.cash) },
    {
      key: "mobileMoney" as const,
      label: "Mobile money",
      value: num(p.mobileMoney),
    },
    { key: "owed" as const, label: "Owed to the customer", value: num(p.owed) },
  ].filter((s) => s.value > 0);
  const total = parts.reduce((s, x) => s + x.value, 0);
  return parts.map((s) => ({
    ...s,
    share: total ? (s.value / total) * 100 : 0,
  }));
}

export interface Attention {
  key: string;
  tone: "bad" | "warn" | "info";
  text: string;
  to: string;
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** What a manager or director should look at first, most serious first. Empty when all is calm. */
export function attention(
  d: Dashboard,
  opts: { canSignoff: boolean },
): Attention[] {
  const out: Attention[] = [];
  const cash = d.cashDifferences;
  if (cash && cash.days > 0)
    out.push({
      key: "cash",
      tone: "bad",
      text: `${plural(cash.days, "day")} closed with a cash difference (net GHS ${Math.round(num(cash.net)).toLocaleString("en-GH")})`,
      to: paths.review.cases.href,
    });
  if (opts.canSignoff && d.signoffPending > 0)
    out.push({
      key: "signoff",
      tone: "warn",
      text: `${plural(d.signoffPending, "day")} waiting for your sign-off`,
      to: paths.drawer.history.href,
    });
  if (d.pendingMoney > 0)
    out.push({
      key: "money",
      tone: "warn",
      text: `${plural(d.pendingMoney, "mobile money payment")} not confirmed yet`,
      to: paths.payments.href,
    });
  const odd = [
    "CALC_MISMATCH",
    "PRICE_STALE",
    "NO_OPEN_DAY",
    "AFTER_CLOSE",
    "CLOCK_AHEAD",
  ].reduce((s, f) => s + (d.flags[f] ?? 0), 0);
  if (odd > 0)
    out.push({
      key: "flags",
      tone: "warn",
      text: `${plural(odd, "purchase")} flagged (price or total looked wrong)`,
      to: paths.transactions.list.href + "?flagged=1",
    });
  if (d.today.voided > 0)
    out.push({
      key: "voids",
      tone: "info",
      text: `${plural(d.today.voided, "purchase")} cancelled today`,
      to: paths.transactions.list.href + "?status=void",
    });
  if (d.debts.overdue > 0)
    out.push({
      key: "debts",
      tone: "warn",
      text: `${plural(d.debts.overdue, "debt")} past the due date`,
      to: paths.debts.href,
    });
  const idle = d.branches.filter((b) => b.day === "none").map((b) => b.name);
  if (idle.length)
    out.push({
      key: "idle",
      tone: "info",
      text: `${idle.join(", ")} ${idle.length === 1 ? "has" : "have"} not opened today`,
      to: paths.drawer.history.href,
    });
  if (d.transfers.onTheRoad > 0)
    out.push({
      key: "road",
      tone: "info",
      text: `${plural(d.transfers.onTheRoad, "transfer")} on the road`,
      to: paths.transfers.list.href,
    });
  const rank = { bad: 0, warn: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

/** "2026-10-20" -> "Tue 20 Oct". */
export function shortDate(iso: string): string {
  const [y, m, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, day!)).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** 12500 -> "12.5k", 1800000 -> "1.8M": for axis labels only. */
export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${+(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

/** A round upper bound for a chart axis: 4300 -> 5000. */
export function niceMax(max: number): number {
  if (!(max > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const f = max / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}
