import { DENOMINATIONS, type NoteLimits } from "@gold/core";

export type Counts = Record<string, number>;

export interface ManualCheck {
  total: number;
  /** Still to be given (positive) or given too much (negative). */
  remaining: number;
  /** Notes asked for that the drawer does not have: denomination → how many are missing. */
  overStock: Record<string, number>;
  /** Only when the notes add up exactly to the cash part and the drawer has them all. */
  valid: boolean;
  lines: Counts;
}

/** The notes a teller picked by hand, checked against the cash to give and the notes in the drawer. */
export function checkManual(
  counts: Counts,
  cash: number,
  limits: NoteLimits,
): ManualCheck {
  const lines: Counts = {};
  const overStock: Record<string, number> = {};
  let total = 0;
  for (const d of DENOMINATIONS) {
    const n = Math.max(0, Math.floor(counts[`${d}`] ?? 0));
    if (n === 0) continue;
    lines[`${d}`] = n;
    total += d * n;
    const have = limits[`${d}`];
    // `undefined` = this note is not in the drawer; `null` = no limit known (no open day).
    if (have === undefined) overStock[`${d}`] = n;
    else if (have !== null && n > have) overStock[`${d}`] = n - have;
  }
  const remaining = cash - total;
  return {
    total,
    remaining,
    overStock,
    valid: remaining === 0 && Object.keys(overStock).length === 0 && total > 0,
    lines,
  };
}

/** Set how many notes of one value are given. Zero removes the row. */
export function setCount(counts: Counts, d: number, n: number): Counts {
  const next = { ...counts };
  const v = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
  if (v === 0) delete next[`${d}`];
  else next[`${d}`] = v;
  return next;
}
