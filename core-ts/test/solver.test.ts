import { describe, expect, it } from 'vitest';
import cases from '../../vectors/solver-cases.json';
import {
  DENOMINATIONS,
  describeCount,
  solveNotes,
  toPayable,
  type NoteLimits,
  type PayablePolicy,
  type SolveStrategy,
} from '../src';

describe('solver shared cases', () => {
  for (const c of cases.cases) {
    it(c.name, () => {
      const r = solveNotes(c.amount, c.limits as NoteLimits, c.strategy as SolveStrategy);
      const e = c.expect as Record<string, unknown>;
      expect(r.ok).toBe(e.ok);
      if (r.ok) {
        if ('totalNotes' in e) expect(r.totalNotes).toBe(e.totalNotes);
        if ('hundreds' in e) expect(r.hundreds).toBe(e.hundreds);
        if ('lines' in e) expect(r.lines).toEqual(e.lines);
        const sum = Object.entries(r.lines).reduce((s, [d, n]) => s + Number(d) * (n ?? 0), 0);
        expect(sum).toBe(c.amount);
      } else {
        expect(r.code).toBe(e.code);
        if ('nearestBelow' in e) expect(r.nearestBelow).toBe(e.nearestBelow);
        if ('nearestAbove' in e) expect(r.nearestAbove).toBe(e.nearestAbove);
      }
    });
  }
});

describe('toPayable', () => {
  for (const p of cases.payable) {
    it(`${p.amount} ${p.policy}`, () => {
      expect(toPayable(p.amount, p.policy as PayablePolicy)).toEqual({
        amount: p.amount,
        payable: p.payable,
        difference: p.difference,
      });
    });
  }
});

describe('describeCount', () => {
  it('1,688 notes is 1 pack, 6 bundles, 88 notes', () => {
    expect(describeCount(1688)).toEqual({ packs: 1, bundles: 6, loose: 88, total: 1688 });
  });
  it('zero', () => {
    expect(describeCount(0)).toEqual({ packs: 0, bundles: 0, loose: 0, total: 0 });
  });
});

describe('display of a solved payout', () => {
  it('168,800 in 100s is 1 pack, 6 bundles, 88 notes', () => {
    const r = solveNotes(168800, { '100': null });
    expect(r.ok && r.display).toEqual([{ denomination: 100, value: 168800, packs: 1, bundles: 6, loose: 88, total: 1688 }]);
  });
});

// Brute force reference: enumerate every combination for small amounts.
function brute(amount: number, limits: NoteLimits, strategy: SolveStrategy) {
  const denoms = DENOMINATIONS.filter((d) => limits[`${d}`] !== undefined);
  let best: { notes: number; hundreds: number } | null = null;
  const go = (i: number, left: number, notes: number, hundreds: number) => {
    if (i === denoms.length) {
      if (left !== 0) return;
      if (
        best === null ||
        (strategy === 'prefer-100s'
          ? hundreds > best.hundreds || (hundreds === best.hundreds && notes < best.notes)
          : notes < best.notes)
      ) {
        best = { notes, hundreds };
      }
      return;
    }
    const d = denoms[i]!;
    const raw = limits[`${d}`];
    const max = Math.min(raw === null || raw === undefined ? Infinity : raw, Math.floor(left / d));
    for (let n = 0; n <= max; n++) go(i + 1, left - n * d, notes + n, hundreds + (d === 100 ? n : 0));
  };
  go(0, amount, 0, 0);
  return best as { notes: number; hundreds: number } | null;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('solver agrees with brute force', () => {
  it('500 random drawers and amounts', () => {
    const rand = rng(12345);
    for (let t = 0; t < 500; t++) {
      const limits: NoteLimits = {};
      for (const d of DENOMINATIONS) {
        const r = rand();
        if (r < 0.25) continue;
        limits[`${d}`] = r < 0.4 ? null : Math.floor(rand() * 8);
      }
      const amount = Math.floor(rand() * 120) * 5;
      const strategy: SolveStrategy = rand() < 0.5 ? 'fewest-notes' : 'prefer-100s';
      const expected = brute(amount, limits, strategy);
      const got = solveNotes(amount, limits, strategy);
      if (expected === null) {
        expect(got.ok, JSON.stringify({ amount, limits })).toBe(false);
      } else {
        expect(got.ok, JSON.stringify({ amount, limits })).toBe(true);
        if (got.ok) {
          expect(got.totalNotes, JSON.stringify({ amount, limits, strategy })).toBe(expected.notes);
          expect(got.hundreds).toBe(expected.hundreds);
          for (const d of DENOMINATIONS) {
            const cap = limits[`${d}`];
            const used = got.lines[`${d}`] ?? 0;
            if (cap === undefined) expect(used).toBe(0);
            else if (cap !== null) expect(used).toBeLessThanOrEqual(cap);
          }
        }
      }
    }
  });
});

describe('solver input validation', () => {
  it('rejects negative, fractional and unknown notes', () => {
    expect(solveNotes(-5, { '100': null })).toMatchObject({ ok: false, code: 'INVALID_AMOUNT' });
    expect(solveNotes(10.5, { '100': null })).toMatchObject({ ok: false, code: 'INVALID_AMOUNT' });
    expect(solveNotes(100, { '1': null } as unknown as NoteLimits)).toMatchObject({ ok: false, code: 'INVALID_DENOMINATION' });
    expect(solveNotes(100, { '100': -1 })).toMatchObject({ ok: false, code: 'INVALID_LIMIT' });
  });

  it('is fast for a very large payout', () => {
    const t = Date.now();
    const r = solveNotes(2_000_000, { '200': null, '100': null, '50': null, '20': null, '10': null, '5': null });
    expect(r.ok).toBe(true);
    expect(Date.now() - t).toBeLessThan(5000);
  });
});
