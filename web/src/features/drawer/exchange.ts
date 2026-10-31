import { DENOMINATIONS, lineTotal, type Lines } from "@gold/core";

export interface ExchangeCheck {
  gaveTotal: number;
  tookTotal: number;
  /** What is still missing from what is handed out (positive) or handed out too much (negative). */
  remaining: number;
  /** Notes in both lists: the customer must get different notes from the ones given back. */
  overlap: number[];
  /** Notes handed out that the drawer does not have: denomination to how many are missing. Empty when the drawer is unknown. */
  short: Record<string, number>;
  valid: boolean;
}

/** Changing notes: both sides worth exactly the same, different notes on each side, and the drawer must have what is handed out. */
export function checkExchange(
  gave: Lines,
  took: Lines,
  drawer: Lines | null,
): ExchangeCheck {
  const gaveTotal = lineTotal(gave);
  const tookTotal = lineTotal(took);
  const overlap = DENOMINATIONS.filter(
    (d) => (gave[`${d}`] ?? 0) > 0 && (took[`${d}`] ?? 0) > 0,
  );
  const short: Record<string, number> = {};
  if (drawer) {
    for (const d of DENOMINATIONS) {
      const need = took[`${d}`] ?? 0;
      // What the customer gives back goes into the drawer, but only the notes the drawer already holds can be handed out.
      const have = drawer[`${d}`] ?? 0;
      if (need > have) short[`${d}`] = need - have;
    }
  }
  const remaining = gaveTotal - tookTotal;
  return {
    gaveTotal,
    tookTotal,
    remaining,
    overlap,
    short,
    valid:
      gaveTotal > 0 &&
      remaining === 0 &&
      overlap.length === 0 &&
      Object.keys(short).length === 0,
  };
}
