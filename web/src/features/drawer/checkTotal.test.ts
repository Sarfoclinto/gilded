import { describe, expect, it } from 'vitest';
import { checkTotal } from './checkTotal';

describe('checkTotal', () => {
  it('says nothing when nothing usable is typed', () => {
    expect(checkTotal('', 500)).toEqual({ kind: 'none' });
    expect(checkTotal('abc', 500)).toEqual({ kind: 'none' });
  });
  it('matches', () => expect(checkTotal('1,500', 1500)).toEqual({ kind: 'match' }));
  it('shows what the notes are over or under', () => {
    expect(checkTotal('1500', 1400)).toEqual({ kind: 'differs', difference: -100 });
    expect(checkTotal('1500.50', 1600)).toEqual({ kind: 'differs', difference: 99.5 });
  });
});