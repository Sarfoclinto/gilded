/**
 * Arithmetic on note counts, e.g. { "100": 1688, "20": 1 }. Used by the drawer (opening, payouts, expected, counted).
 * Keys are denominations as strings; values are whole numbers of notes. Zero entries are dropped from results.
 */
export type Lines = Record<string, number>;

const clean = (l: Lines): Lines => Object.fromEntries(Object.entries(l).filter(([, n]) => n !== 0));

/** Value in cedis. */
export function lineTotal(lines: Lines): number {
  return Object.entries(lines).reduce((s, [d, n]) => s + Number(d) * n, 0);
}

/** Number of physical notes. */
export function noteCount(lines: Lines): number {
  return Object.values(lines).reduce((s, n) => s + n, 0);
}

export function addLines(a: Lines, b: Lines): Lines {
  const out: Lines = { ...a };
  for (const [d, n] of Object.entries(b)) out[d] = (out[d] ?? 0) + n;
  return clean(out);
}

/** a minus b. Entries can go negative; use shortfall() to see what is missing. */
export function subtractLines(a: Lines, b: Lines): Lines {
  const out: Lines = { ...a };
  for (const [d, n] of Object.entries(b)) out[d] = (out[d] ?? 0) - n;
  return clean(out);
}

/** For each denomination where `needed` exceeds `available`, how many notes are missing. */
export function shortfall(available: Lines, needed: Lines): Lines {
  const out: Lines = {};
  for (const [d, n] of Object.entries(needed)) {
    const missing = n - Math.max(0, available[d] ?? 0);
    if (missing > 0) out[d] = missing;
  }
  return out;
}
