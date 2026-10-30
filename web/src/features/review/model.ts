import type { Case, PositionRow } from "./schemas";

// ---------------------------------------------------------------- between branches
export type Direction = {
  from: string;
  to: string;
  cash: number;
  goods: number;
  mobile: number;
  failed: number;
  total: number;
};
export type Pair = {
  key: string;
  a: string;
  b: string;
  aToB: Direction | null;
  bToA: Direction | null;
  net: number;
};

const dir = (r: PositionRow): Direction => {
  const cash = Number(r.cashSent),
    goods = Number(r.goodsValueSent),
    mobile = Number(r.mobileMoneyPaidOnBehalf),
    failed = Number(r.mobileMoneyFailedCoveredByCash);
  return {
    from: r.senderName ?? "?",
    to: r.receiverName ?? "?",
    cash,
    goods,
    mobile,
    failed,
    total: cash + goods + mobile,
  };
};

/**
 * Rows are one-way (sender → receiver). Pair the two directions of each couple of branches, so the page can show what moved each way
 * and which way more value has gone. `net` > 0 means branch `a` has handed over more than `b`. It is value moved, not a debt.
 */
export function pairUp(rows: PositionRow[]): Pair[] {
  const pairs = new Map<string, Pair>();
  for (const r of rows) {
    const [x, y] = [r.senderBranchId, r.receiverBranchId].sort();
    const key = `${x}|${y}`;
    const p = pairs.get(key) ?? {
      key,
      a: "",
      b: "",
      aToB: null,
      bToA: null,
      net: 0,
    };
    const d = dir(r);
    const first = r.senderBranchId === x;
    if (first) {
      p.a = d.from;
      p.b = d.to;
      p.aToB = d;
    } else {
      p.b = d.from;
      p.a = d.to;
      p.bToA = d;
    }
    pairs.set(key, p);
  }
  return [...pairs.values()]
    .map((p) => ({ ...p, net: (p.aToB?.total ?? 0) - (p.bToA?.total ?? 0) }))
    .sort(
      (p, q) => Math.abs(q.net) - Math.abs(p.net) || p.a.localeCompare(q.a),
    );
}

/** "Takoradi has handed over GHS 5,000 more than Kumasi", or "Even". */
export function netSentence(p: Pair, money: (n: number) => string): string {
  if (Math.abs(p.net) < 0.5) return "About even";
  return `${p.net > 0 ? p.a : p.b} has handed over ${money(Math.abs(p.net))} more than ${p.net > 0 ? p.b : p.a}`;
}

export const stillToHandOver = (p: Pair) =>
  (p.aToB?.failed ?? 0) + (p.bToA?.failed ?? 0);

// ---------------------------------------------------------------- differences (cases)
export const isClosed = (c: Pick<Case, "status">) =>
  c.status === "resolved" || c.status === "written_off";
const money = (c: Case) =>
  c.asset === "cash" ||
  c.asset === "goods_value" ||
  c.asset === "debt" ||
  c.asset === "payable";

/** "short" when the count was below the books, "over" when above. */
export const direction = (c: Case): "short" | "over" | "none" => {
  const d = Number(c.difference ?? 0);
  return d < 0 ? "short" : d > 0 ? "over" : "none";
};

export function summarizeCases(cases: Case[], now: Date = new Date()) {
  const live = cases.filter((c) => !isClosed(c));
  const cash = live
    .filter((c) => c.asset === "cash")
    .reduce((s, c) => s + Number(c.difference ?? 0), 0);
  const oldest = live.reduce<number | null>((m, c) => {
    const d = Math.floor(
      (now.getTime() - new Date(c.openedAt).getTime()) / 864e5,
    );
    return m == null || d > m ? d : m;
  }, null);
  return {
    live: live.length,
    untouched: live.filter((c) => c.status === "open").length,
    beingLookedAt: live.filter((c) => c.status === "under_review").length,
    netCash: cash,
    oldestDays: oldest,
  };
}

export type CaseSort = "newest" | "oldest" | "biggest";
export type CaseFilters = {
  q: string;
  branch: string;
  kind: string;
  sort: CaseSort;
};
export const NO_CASE_FILTERS: CaseFilters = {
  q: "",
  branch: "",
  kind: "",
  sort: "newest",
};

/** Size of a difference for ranking: money counts as itself, grams are scaled so a few grams of gold outrank small cash. */
export const weight = (c: Case) =>
  Math.abs(Number(c.difference ?? 0)) * (money(c) ? 1 : 500);

export function filterCases(cases: Case[], f: CaseFilters): Case[] {
  const q = f.q.trim().toLowerCase();
  const out = cases.filter((c) => {
    if (f.branch && c.branchId !== f.branch) return false;
    if (f.kind && c.kind !== f.kind) return false;
    if (
      q &&
      ![
        c.branchName ?? "",
        c.transferReference ?? "",
        c.assignedTo?.displayName ?? "",
        c.openedBy?.displayName ?? "",
        c.reportedExplanation ?? "",
      ].some((s) => s.toLowerCase().includes(q))
    )
      return false;
    return true;
  });
  return out.sort((a, b) =>
    f.sort === "biggest"
      ? weight(b) - weight(a)
      : f.sort === "oldest"
        ? a.openedAt.localeCompare(b.openedAt)
        : b.openedAt.localeCompare(a.openedAt),
  );
}

/** "3 days open" / "opened today", for cases still waiting. */
export function openFor(iso: string, now: Date = new Date()): string {
  const d = Math.floor((now.getTime() - new Date(iso).getTime()) / 864e5);
  return d < 1 ? "Opened today" : `${d} day${d === 1 ? "" : "s"} open`;
}
