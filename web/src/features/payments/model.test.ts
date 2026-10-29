import { describe, expect, it } from 'vitest';
import type { PendingPayment } from './api';
import { matches, oldestFirst, summarize, waitOf } from './model';

const now = new Date('2026-10-29T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const p = (id: string, h: number, amount = '100', customerName = 'Ama'): PendingPayment => ({ paymentId: id, transactionId: 't', reference: 'TX-1', purchaseBranchId: 'b1', purchaseBranchName: 'Accra', sendingBranchId: 'b2', sendingBranchName: 'Kumasi', customerName, amount, externalRef: null, createdAt: hoursAgo(h) });

describe('payments model', () => {
  it('reads the wait', () => {
    expect(waitOf(hoursAgo(0.2), now)).toMatchObject({ tone: 'ok', text: 'Just now' });
    expect(waitOf(hoursAgo(5), now)).toMatchObject({ tone: 'ok', text: '5 hours' });
    expect(waitOf(hoursAgo(30), now)).toMatchObject({ tone: 'late', text: '1 day' });
    expect(waitOf(hoursAgo(72), now)).toMatchObject({ tone: 'stale', text: '3 days' });
  });
  it('summarises and sorts', () => {
    const list = [p('a', 2, '150.50'), p('b', 60, '200'), p('c', 30)];
    expect(summarize(list, now)).toMatchObject({ count: 3, total: 450.5, late: 2, oldest: hoursAgo(60) });
    expect(oldestFirst(list).map((x) => x.paymentId)).toEqual(['b', 'c', 'a']);
  });
  it('searches', () => {
    expect(matches(p('a', 1, '1', 'Kofi Boateng'), 'boat')).toBe(true);
    expect(matches(p('a', 1), 'kumasi')).toBe(true);
    expect(matches(p('a', 1), 'zzz')).toBe(false);
  });
});