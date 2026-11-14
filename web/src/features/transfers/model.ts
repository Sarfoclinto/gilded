import type {
  ScaleLevel,
  TransferableItem,
  TransferRow,
  Transfer,
  TransferStatus,
} from "./schemas";

export const STAGES = ["Drafted", "On the way", "Received"] as const;

export interface Stage {
  /** Which step is current (0 to 2), or -1 when the transfer was cancelled. */
  index: number;
  tone: "normal" | "warn" | "cancelled";
}

export function stageOf(status: TransferStatus): Stage {
  switch (status) {
    case "draft":
      return { index: 0, tone: "normal" };
    case "released":
      return { index: 1, tone: "normal" };
    case "received":
      return { index: 2, tone: "normal" };
    case "received_with_discrepancy":
      return { index: 2, tone: "warn" };
    default:
      return { index: -1, tone: "cancelled" };
  }
}

const dayNumber = (d: Date) =>
  Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);

export interface RoadAge {
  days: number;
  /** ok: less than two days; late: two days; stale: three or more. */
  tone: "ok" | "late" | "stale";
  text: string;
}

/** How long a released transfer has been on the road. Null for anything else. */
export function roadAge(
  row: Pick<TransferRow, "status" | "releasedAt">,
  now: Date = new Date(),
): RoadAge | null {
  if (row.status !== "released" || !row.releasedAt) return null;
  const days = Math.max(
    0,
    dayNumber(now) - dayNumber(new Date(row.releasedAt)),
  );
  return {
    days,
    tone: days >= 3 ? "stale" : days === 2 ? "late" : "ok",
    text:
      days === 0
        ? "Left today"
        : days === 1
          ? "On the road since yesterday"
          : `On the road for ${days} days`,
  };
}

export interface TransferSummary {
  coming: { count: number; value: number };
  going: { count: number; value: number };
  drafts: number;
  differences: number;
  stale: number;
}

/** The headline figures for one branch's transfers. */
export function summarize(
  rows: TransferRow[],
  branchId: string | null,
  now: Date = new Date(),
): TransferSummary {
  const s: TransferSummary = {
    coming: { count: 0, value: 0 },
    going: { count: 0, value: 0 },
    drafts: 0,
    differences: 0,
    stale: 0,
  };
  for (const r of rows) {
    const value = Number(r.declaredValue ?? 0);
    if (r.status === "released") {
      if (r.destinationBranchId === branchId) {
        s.coming.count++;
        s.coming.value += value;
      } else if (r.originBranchId === branchId) {
        s.going.count++;
        s.going.value += value;
      }
      if (roadAge(r, now)?.tone === "stale") s.stale++;
    }
    if (r.status === "draft" && r.originBranchId === branchId) s.drafts++;
    if (r.status === "received_with_discrepancy") s.differences++;
  }
  return s;
}

/** Search by receipt, branch or collector. */
export function matches(row: TransferRow, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return [
    row.reference,
    row.originBranchName,
    row.destinationBranchName,
    row.collectorName ?? "",
  ].some((v) => v.toLowerCase().includes(t));
}

export interface Difference {
  top: number;
  down: number;
  value: number;
  cash: number;
}

/** What was received minus what was sent (negative is short). Null until it has been received. */
export function differenceOf(
  t: Pick<Transfer, "declared" | "receipt">,
): Difference | null {
  if (!t.receipt) return null;
  const n = (v: string | null | undefined) => Number(v ?? 0);
  const d = t.declared;
  return {
    top: n(t.receipt.top) - n(d?.top),
    down: n(t.receipt.down) - n(d?.down),
    value: n(t.receipt.value) - n(d?.value),
    cash: n(t.receipt.cash) - n(d?.cash),
  };
}

export function pickedTotals(items: TransferableItem[], picked: string[]) {
  const set = new Set(picked);
  let top = 0,
    down = 0,
    value = 0,
    count = 0;
  for (const i of items)
    if (set.has(i.itemId)) {
      top += Number(i.top);
      down += Number(i.down);
      value += Number(i.value);
      count++;
    }
  return { count, top, down, value };
}

/** Search the gold a branch could send: customer, receipt or description. */
export function filterItems(
  items: TransferableItem[],
  q: string,
): TransferableItem[] {
  const t = q.trim().toLowerCase();
  if (!t) return items;
  return items.filter((i) =>
    [i.customerName, i.reference, i.label].some((v) =>
      v.toLowerCase().includes(t),
    ),
  );
}

// ---------------------------------------------------------------- the sender's scale against the books (B57)
// Mirrors gold.scale_check in migration 0058; the server's grade is the one recorded, this one only previews it.
const RANK: Record<ScaleLevel, number> = {
  ok: 0,
  notice: 1,
  alert: 2,
  critical: 3,
};
const worst = (a: ScaleLevel, b: ScaleLevel): ScaleLevel =>
  RANK[a] >= RANK[b] ? a : b;

export interface ScaleCheck {
  topLevel: ScaleLevel;
  downLevel: ScaleLevel;
  level: ScaleLevel;
  downAllowance: number;
}

/** Top: any gap is yellow up to 0.10 g, orange up to 0.50 g, red beyond. Down: the allowance grows with pieces and weight, never above 0.50 g. */
export function scaleCheck(
  topDiff: number,
  downDiff: number,
  booksTop: number,
  pieces: number,
): ScaleCheck {
  const allow = Math.min(
    0.5,
    0.02 + 0.01 * Math.max(pieces, 0) + 0.001 * Math.max(booksTop, 0),
  );
  const r = (n: number) => Math.round(n * 10_000) / 10_000;
  const t = r(Math.abs(topDiff)),
    d = r(Math.abs(downDiff));
  const topLevel: ScaleLevel =
    t === 0 ? "ok" : t <= 0.1 ? "notice" : t <= 0.5 ? "alert" : "critical";
  const downLevel: ScaleLevel =
    d <= allow / 2
      ? "ok"
      : d <= allow
        ? "notice"
        : d <= 0.5
          ? "alert"
          : "critical";
  return {
    topLevel,
    downLevel,
    level: worst(topLevel, downLevel),
    downAllowance: Math.round(allow * 1000) / 1000,
  };
}

export const SCALE_TEXT: Record<ScaleLevel, string> = {
  ok: "Matches the books",
  notice: "A small difference",
  alert: "Check the weighing",
  critical: "Too far from the books",
};

/** Classes for a level: a plain match, yellow, orange and a strong red. */
export const SCALE_TONE: Record<ScaleLevel, string> = {
  ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  notice:
    "border-yellow-500/60 bg-yellow-400/20 text-yellow-800 dark:text-yellow-200",
  alert:
    "border-orange-500/70 bg-orange-500/15 text-orange-800 dark:text-orange-200",
  critical: "border-red-600 bg-red-600/15 text-red-700 dark:text-red-300",
};

/** A signed gram figure: +0.05 g, -0.30 g, or "no difference". */
export function signedGrams(n: number): string {
  const v = Math.round(n * 100) / 100;
  return v === 0
    ? "no difference"
    : `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(2)} g`;
}
