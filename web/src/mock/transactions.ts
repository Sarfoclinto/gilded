
import { calculate, solveNotes, type NoteLimits } from '@gold/core';
import type { Transaction } from '@/features/transactions/schemas';
import { branches } from './data';
import { recordPayout } from './days';

/**
 * Server-side behaviour of /transactions, as the real API must implement it:
 * - idempotent on the transaction id (replay returns the stored one)
 * - recomputes every figure with the same ExcelV1 rules and keeps ITS numbers, flagging disagreement
 * - never rejects a late (offline) entry, only flags it
 */
const KEY = 'mock.transactions.v1';
const load = (): Transaction[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Transaction[];
  } catch {
    return [];
  }
};
const save = (rows: Transaction[]) => localStorage.setItem(KEY, JSON.stringify(rows));

export type Fail = (status: number, code: string, message: string, fieldErrors?: Record<string, string[]>) => Promise<never>;
export interface Caller {
  id: string;
  displayName: string;
  branchIds: string[];
  permissions: string[];
}

const STALE_PRICE_MS = 12 * 60 * 60 * 1000;
const OFFLINE_MS = 2 * 60 * 1000;

export function listTransactions(branchId: string, limit: number) {
  return load()
    .filter((t) => t.branchId === branchId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export function getTransaction(id: string) {
  return load().find((t) => t.id === id);
}

export async function createTransaction(
  body: Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  caller: Caller,
  fail: Fail,
): Promise<{ status: 200 | 201; data: Transaction }> {
  const rows = load();
  const existing = rows.find((t) => t.id === body.id);
  if (existing) return { status: 200, data: existing };

  if (!caller.branchIds.includes(body.branchId)) {
    return fail(403, 'BRANCH_NOT_ASSIGNED', 'You are not assigned to this branch.');
  }
  const fieldErrors: Record<string, string[]> = {};
  if (!String(body.customerName ?? '').trim()) fieldErrors.customerName = ['Enter the customer name'];
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20) fieldErrors.items = ['Add 1 to 20 items'];
  if (Object.keys(fieldErrors).length) return fail(422, 'VALIDATION_FAILED', 'Check the highlighted fields.', fieldErrors);

  const items: Transaction['items'] = [];
  let total = 0;
  for (const [i, it] of (body.items as any[]).entries()) { // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = calculate({ top: it.top, down: it.down, price: it.price });
    if (r.errors.length || r.amount === null || r.karat === null || r.purity === null || r.netWeight === null || r.pounds === null || r.density === null) {
      return fail(422, 'VALIDATION_FAILED', `Item ${i + 1} cannot be calculated.`, {
        [`items.${i}`]: r.errors.map((e) => e.message).concat(r.errors.length ? [] : ['Fill in top, down and price']),
      });
    }
    total += Number(r.amount);
    items.push({
      id: it.id,
      label: it.label ?? null,
      top: it.top,
      down: it.down,
      price: it.price,
      result: { density: r.density, karat: r.karat, purity: r.purity, netWeight: r.netWeight, pounds: r.pounds, amount: r.amount },
    });
  }

  const payable = Number(body.payout?.payable);
  const lines = (body.payout?.lines ?? {}) as Record<string, number>;
  const linesTotal = Object.entries(lines).reduce((s, [d, n]) => s + Number(d) * Number(n), 0);
  if (!Number.isInteger(payable) || payable < 0 || payable % 5 !== 0 || linesTotal !== payable) {
    return fail(422, 'PAYOUT_MISMATCH', 'The notes do not add up to the amount to pay.');
  }
  // Sanity: the notes must be makeable at all (guards against tampered or corrupted queued data).
  const limits: NoteLimits = Object.fromEntries(Object.keys(lines).map((d) => [d, null]));
  if (payable > 0 && !solveNotes(payable, limits).ok) return fail(422, 'PAYOUT_MISMATCH', 'The notes cannot make this amount.');

  const now = new Date();
  const flags: Transaction['flags'] = [];
  if (String(total) !== String(body.clientAmount)) flags.push('CALC_MISMATCH');
  if (now.getTime() - new Date(body.capturedAt).getTime() > OFFLINE_MS) flags.push('OFFLINE_ENTRY');
  if (now.getTime() - new Date(body.priceAsOf).getTime() > STALE_PRICE_MS) flags.push('PRICE_STALE');

  if (!recordPayout(body.branchId, body.id, lines)) flags.push('NO_OPEN_DAY');

  const branch = branches.find((b) => b.id === body.branchId);
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  const seq = rows.filter((t) => t.branchId === body.branchId && t.reference.includes(`-${day}-`)).length + 1;

  const tx: Transaction = {
    id: body.id,
    branchId: body.branchId,
    reference: `${branch?.code ?? 'BR'}-${day}-${String(seq).padStart(4, '0')}`,
    customerName: String(body.customerName).trim(),
    customerPhone: body.customerPhone ?? null,
    status: 'saved',
    items,
    formulaVersion: 'ExcelV1',
    calculatedAmount: String(total),
    payout: {
      policy: body.payout.policy,
      strategy: body.payout.strategy,
      payable: String(payable),
      lines,
      difference: String(payable - total),
      totalNotes: Object.values(lines).reduce((s, n) => s + Number(n), 0),
    },
    capturedAt: body.capturedAt,
    createdAt: now.toISOString(),
    createdBy: { id: caller.id, displayName: caller.displayName },
    flags,
  };
  save([tx, ...rows]);
  return { status: 201, data: tx };
}

