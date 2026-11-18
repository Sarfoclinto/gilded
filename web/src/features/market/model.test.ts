import { describe, expect, it } from 'vitest';
import type { PricePoint } from './api';
import { boughtTotals, priceChanges, priceLine, priceStats, usd, worldMove, worldToPound } from './model';

const p = (at: string, base: number, margin: number, status = 'approved'): PricePoint => ({ at, base: String(base), margin: String(margin), price: String(base + margin), source: 'goldbod', status });
const FROM = '2026-11-01T00:00:00Z';
const NOW = '2026-11-13T12:00:00Z';
const points = [p('2026-10-20T08:00:00Z', 11000, 100), p('2026-11-03T08:00:00Z', 11200, 100), p('2026-11-03T08:00:00Z', 11200, 150), p('2026-11-10T09:30:00Z', 11150, 150)];

describe('the price as a line', () => {
  const line = priceLine(points, FROM, NOW);
  it('starts where the period starts, with the price already in force', () => {
    expect(line[0]).toEqual({ time: Date.parse(FROM) / 1000, value: 11100 });
  });
  it('runs on to now with the last price', () => {
    expect(line[line.length - 1]).toEqual({ time: Date.parse(NOW) / 1000, value: 11300 });
  });
  it('keeps times strictly increasing: two changes in the same second become the later one', () => {
    expect(line.map((x) => x.value)).toEqual([11100, 11350, 11300, 11300]);
    for (let i = 1; i < line.length; i++) expect(line[i]!.time).toBeGreaterThan(line[i - 1]!.time);
  });
  it('can draw the reference price instead', () => {
    expect(priceLine(points, FROM, NOW, (x) => x.base).map((x) => x.value)).toEqual([11000, 11200, 11150, 11150]);
  });
  it('is empty with no price, and survives a clock that is behind the last change', () => {
    expect(priceLine([], FROM, NOW)).toEqual([]);
    const behind = priceLine(points, FROM, '2026-11-05T00:00:00Z');
    for (let i = 1; i < behind.length; i++) expect(behind[i]!.time).toBeGreaterThan(behind[i - 1]!.time);
  });
});

describe('the figures beside the chart', () => {
  it('current price, where it came from, and the step from the price before', () => {
    expect(priceStats(points)).toMatchObject({ current: 11300, base: 11150, margin: 150, previous: 11350, change: -50, high: 11350, low: 11100, changes: 3, since: '2026-11-10T09:30:00Z', provisional: false });
    expect(priceStats(points)!.changePercent).toBeCloseTo(-0.4405, 3);
  });
  it('one price all along: no change, in force since the first point', () => {
    const flat = [p('2026-11-01T08:00:00Z', 11000, 100), p('2026-11-05T08:00:00Z', 11000, 100, 'provisional')];
    expect(priceStats(flat)).toMatchObject({ previous: null, change: 0, changePercent: 0, changes: 0, since: '2026-11-01T08:00:00Z', provisional: true });
  });
  it('nothing without a price', () => {
    expect(priceStats([])).toBeNull();
  });
});

describe('the list of changes', () => {
  it('newest first, each with its step, without rows where the price stayed the same', () => {
    const rows = priceChanges([...points, p('2026-11-11T08:00:00Z', 11150, 150)]);
    expect(rows.map((r) => [r.price, r.step])).toEqual([['11300', -50], ['11350', 50], ['11300', 200], ['11100', null]]);
  });
});

describe('what was bought', () => {
  it('adds the days up and averages the price by weight', () => {
    const t = boughtTotals([
      { date: '2026-11-12', purchases: 2, top: '10', amount: '15000', avgPrice: '11000' },
      { date: '2026-11-13', purchases: 1, top: '30', amount: '44000', avgPrice: '11400' },
      { date: '2026-11-14', purchases: 0, top: '0', amount: '0', avgPrice: null },
    ]);
    expect(t).toMatchObject({ purchases: 3, top: 40, amount: 59000, avgPrice: 11300, days: 3 });
    expect(boughtTotals([]).avgPrice).toBeNull();
  });
});

describe('the world price held against ours', () => {
  it('turns dollars per troy ounce into cedis per pound of pure gold', () => {
    // 3,110.35 USD/oz is 100 USD per gram; a 7.75 g pound is 775 USD; at 12 cedis to the dollar, 9,300
    expect(worldToPound(3110.34768, 12, 7.75)).toBeCloseTo(9300, 4);
  });
  it('needs all three numbers', () => {
    expect(worldToPound(0, 12, 7.75)).toBeNull();
    expect(worldToPound(4000, 0, 7.75)).toBeNull();
    expect(worldToPound(Number.NaN, 12, 7.75)).toBeNull();
  });
});

describe('worldMove (GoldBod world price against the price now)', () => {
  it('up, down and flat, with the change and percent', () => {
    expect(worldMove('3759.35', '3781.20')).toMatchObject({ direction: 'up', change: 21.85 });
    expect(worldMove('3759.35', '3781.20')!.percent).toBeCloseTo(0.581, 3);
    expect(worldMove('3759.35', '3740')).toMatchObject({ direction: 'down', change: -19.35 });
    expect(worldMove('3759.35', '3759.354')).toMatchObject({ direction: 'flat', change: 0, percent: 0 });
  });
  it('nothing to compare when a number is missing or broken', () => {
    expect(worldMove(null, '3781')).toBeNull();
    expect(worldMove('3759.35', undefined)).toBeNull();
    expect(worldMove('0', '3781')).toBeNull();
    expect(worldMove('abc', '3781')).toBeNull();
  });
  it('formats dollars like GoldBod', () => {
    expect(usd(3759.35)).toBe('USD 3,759.35');
    expect(usd(4000)).toBe('USD 4,000.00');
  });
});