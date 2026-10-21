/**
 * Note solver: decides which notes make up a payout, exactly.
 *
 * Works in units of 5 cedis. A bounded-knapsack dynamic programme finds the best combination that
 * adds up exactly to the amount without using more notes than the drawer holds. It never gives a
 * wrong answer where a greedy approach would (for example 60 from 50s and 20s is three 20s).
 */

export const DENOMINATIONS = [200, 100, 50, 20, 10, 5] as const;
export type Denomination = (typeof DENOMINATIONS)[number];

/** Maximum notes available per denomination. null means unlimited, a missing key means unavailable. */
export type NoteLimits = Partial<Record<`${Denomination}`, number | null>>;
export type NoteLines = Partial<Record<`${Denomination}`, number>>;

export type SolveStrategy = 'fewest-notes' | 'prefer-100s';

export const NOTES_PER_BUNDLE = 100;
export const BUNDLES_PER_PACK = 10;
export const NOTES_PER_PACK = NOTES_PER_BUNDLE * BUNDLES_PER_PACK;

export type SolveErrorCode =
  | 'INVALID_AMOUNT'
  | 'NOT_MULTIPLE_OF_5'
  | 'INVALID_DENOMINATION'
  | 'INVALID_LIMIT'
  | 'CANNOT_MAKE_AMOUNT';

export interface CountDisplay {
  packs: number;
  bundles: number;
  loose: number;
  total: number;
}

export interface SolveSuccess {
  ok: true;
  amount: number;
  lines: NoteLines;
  totalNotes: number;
  hundreds: number;
  display: Array<{ denomination: Denomination; value: number } & CountDisplay>;
}

export interface SolveFailure {
  ok: false;
  code: SolveErrorCode;
  message: string;
  /** Closest amounts the drawer can make, when the amount itself cannot be made. */
  nearestBelow?: number | null;
  nearestAbove?: number | null;
}

export type SolveResult = SolveSuccess | SolveFailure;

export function describeCount(notes: number): CountDisplay {
  const packs = Math.floor(notes / NOTES_PER_PACK);
  const afterPacks = notes - packs * NOTES_PER_PACK;
  const bundles = Math.floor(afterPacks / NOTES_PER_BUNDLE);
  return { packs, bundles, loose: afterPacks - bundles * NOTES_PER_BUNDLE, total: notes };
}

export type PayablePolicy = 'down' | 'up' | 'nearest';

export interface PayableResult {
  amount: number;
  payable: number;
  /** payable minus amount: negative when the customer is paid less, positive when the business absorbs it. */
  difference: number;
}

/** Rounds a calculated amount to something payable with the smallest note (5 cedis). */
export function toPayable(amount: number, policy: PayablePolicy = 'down'): PayableResult {
  if (!Number.isInteger(amount) || amount < 0) throw new RangeError('amount must be a whole number, zero or more');
  const rem = amount % 5;
  let payable = amount - rem;
  if (rem !== 0 && (policy === 'up' || (policy === 'nearest' && rem >= 3))) payable += 5;
  return { amount, payable, difference: payable - amount };
}

const BIG = 1_000_000_000;

interface Item {
  denom: Denomination;
  notes: number;
  units: number;
  cost: number;
}

function buildItems(limits: NoteLimits, maxUnits: number, strategy: SolveStrategy): Item[] {
  const items: Item[] = [];
  for (const d of DENOMINATIONS) {
    const raw = limits[`${d}`];
    if (raw === undefined) continue;
    const cap = Math.min(raw === null ? Infinity : raw, Math.floor((maxUnits * 5) / d));
    const unitsPerNote = d / 5;
    const perNoteCost = strategy === 'prefer-100s' && d === 100 ? 1 - BIG : 1;
    let remaining = cap;
    let chunk = 1;
    while (remaining > 0) {
      const n = Math.min(chunk, remaining);
      items.push({ denom: d, notes: n, units: n * unitsPerNote, cost: n * perNoteCost });
      remaining -= n;
      chunk *= 2;
    }
  }
  return items;
}

/** Runs the knapsack up to maxUnits and returns reachability plus a way to rebuild the notes. */
function run(items: Item[], maxUnits: number) {
  const INF = Number.POSITIVE_INFINITY;
  const dp = new Float64Array(maxUnits + 1).fill(INF);
  dp[0] = 0;
  const took = new Uint8Array(items.length * (maxUnits + 1));
  items.forEach((it, i) => {
    const base = i * (maxUnits + 1);
    for (let a = maxUnits; a >= it.units; a--) {
      const prev = dp[a - it.units]!;
      if (prev === INF) continue;
      const cand = prev + it.cost;
      if (cand < dp[a]!) {
        dp[a] = cand;
        took[base + a] = 1;
      }
    }
  });
  return { dp, took };
}

function validate(amount: number, limits: NoteLimits): SolveFailure | null {
  if (!Number.isInteger(amount) || amount < 0) {
    return { ok: false, code: 'INVALID_AMOUNT', message: 'Amount must be a whole number of cedis, zero or more.' };
  }
  if (amount % 5 !== 0) {
    return { ok: false, code: 'NOT_MULTIPLE_OF_5', message: 'Amount must be a multiple of 5. Round it first.' };
  }
  for (const [key, value] of Object.entries(limits)) {
    if (!(DENOMINATIONS as readonly number[]).includes(Number(key))) {
      return { ok: false, code: 'INVALID_DENOMINATION', message: `${key} is not a supported note.` };
    }
    if (value !== null && value !== undefined && (!Number.isInteger(value) || value < 0)) {
      return { ok: false, code: 'INVALID_LIMIT', message: `Limit for ${key} must be null or a whole number, zero or more.` };
    }
  }
  return null;
}

export function solveNotes(amount: number, limits: NoteLimits, strategy: SolveStrategy = 'fewest-notes'): SolveResult {
  const bad = validate(amount, limits);
  if (bad) return bad;

  const units = amount / 5;
  const available = DENOMINATIONS.filter((d) => limits[`${d}`] !== undefined && limits[`${d}`] !== 0);
  const smallest = available.length ? Math.min(...available) / 5 : 0;
  // Search a little beyond the amount so a nearest-above suggestion is possible.
  const maxUnits = units + smallest;

  const items = buildItems(limits, maxUnits, strategy);
  const { dp, took } = run(items, maxUnits);

  if (dp[units] !== Number.POSITIVE_INFINITY) {
    const counts = new Map<Denomination, number>();
    let a = units;
    for (let i = items.length - 1; i >= 0; i--) {
      if (took[i * (maxUnits + 1) + a]) {
        const it = items[i]!;
        counts.set(it.denom, (counts.get(it.denom) ?? 0) + it.notes);
        a -= it.units;
      }
    }
    const lines: NoteLines = {};
    let totalNotes = 0;
    for (const d of DENOMINATIONS) {
      const n = counts.get(d);
      if (n) {
        lines[`${d}`] = n;
        totalNotes += n;
      }
    }
    const display = DENOMINATIONS.filter((d) => counts.get(d)).map((d) => ({
      denomination: d,
      value: d * counts.get(d)!,
      ...describeCount(counts.get(d)!),
    }));
    return { ok: true, amount, lines, totalNotes, hundreds: counts.get(100) ?? 0, display };
  }

  let below: number | null = null;
  for (let a = units - 1; a >= 0; a--) {
    if (dp[a] !== Number.POSITIVE_INFINITY) {
      below = a * 5;
      break;
    }
  }
  let above: number | null = null;
  for (let a = units + 1; a <= maxUnits; a++) {
    if (dp[a] !== Number.POSITIVE_INFINITY) {
      above = a * 5;
      break;
    }
  }
  return {
    ok: false,
    code: 'CANNOT_MAKE_AMOUNT',
    message: 'The drawer cannot make this exact amount with the notes available.',
    nearestBelow: below,
    nearestAbove: above,
  };
}
