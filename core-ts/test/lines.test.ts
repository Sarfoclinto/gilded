import { describe, expect, it } from 'vitest';
import { addLines, lineTotal, noteCount, shortfall, subtractLines } from '../src';

describe('note lines', () => {
  it('totals value and pieces', () => {
    expect(lineTotal({ '100': 1688, '20': 1, '10': 1, '5': 1 })).toBe(168835);
    expect(noteCount({ '100': 1688, '20': 1, '10': 1, '5': 1 })).toBe(1691);
    expect(lineTotal({})).toBe(0);
  });
  it('adds and drops zeros', () => {
    expect(addLines({ '100': 5 }, { '100': 3, '50': 2 })).toEqual({ '100': 8, '50': 2 });
    expect(addLines({ '100': 5 }, { '100': -5 })).toEqual({});
  });
  it('subtracts, allowing negatives', () => {
    expect(subtractLines({ '100': 10, '50': 2 }, { '100': 4, '20': 1 })).toEqual({ '100': 6, '50': 2, '20': -1 });
  });
  it('reports what is missing from the drawer', () => {
    expect(shortfall({ '100': 3, '50': 10 }, { '100': 5, '50': 4, '20': 2 })).toEqual({ '100': 2, '20': 2 });
    expect(shortfall({ '100': -2 }, { '100': 1 })).toEqual({ '100': 1 });
    expect(shortfall({ '100': 9 }, { '100': 9 })).toEqual({});
  });
});
