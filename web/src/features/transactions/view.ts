import { calculate } from '@gold/core';
import type { OutboxEntry } from '@/shared/offline/outboxStore';
import type { CreateTransaction, Transaction, TransactionFlag } from './schemas';

/** One shape for the screens, whether the transaction is on the server or still only on this device. */
export interface TransactionView {
  id: string;
  branchId: string;
  reference: string | null;
  customerName: string;
  customerPhone: string | null;
  items: Array<{
    id: string;
    label: string | null;
    top: string;
    down: string;
    price: string;
    result: { density: string; karat: string; purity: string; netWeight: string; pounds: string; amount: string } | null;
  }>;
  calculatedAmount: string;
  payout: { payable: string; difference: string; lines: Record<string, number>; totalNotes: number };
  capturedAt: string;
  flags: TransactionFlag[];
  sync: 'synced' | 'waiting' | 'failed';
  error?: string;
  createdBy?: string;
}

export const fromServer = (t: Transaction): TransactionView => ({
  id: t.id,
  branchId: t.branchId,
  reference: t.reference,
  customerName: t.customerName,
  customerPhone: t.customerPhone ?? null,
  items: t.items.map((i) => ({ id: i.id, label: i.label ?? null, top: i.top, down: i.down, price: i.price, result: i.result })),
  calculatedAmount: t.calculatedAmount,
  payout: { payable: t.payout.payable, difference: t.payout.difference, lines: t.payout.lines, totalNotes: t.payout.totalNotes },
  capturedAt: t.capturedAt,
  flags: t.flags,
  sync: 'synced',
  createdBy: t.createdBy.displayName,
});

/** Rebuilds the figures from the saved inputs with the same engine, so a waiting entry looks like a real one. */
export const fromOutbox = (e: OutboxEntry): TransactionView => {
  const c = e.payload as CreateTransaction;
  const items = c.items.map((i) => {
    const r = calculate({ top: i.top, down: i.down, price: i.price });
    return {
      id: i.id,
      label: i.label ?? null,
      top: i.top,
      down: i.down,
      price: i.price,
      result:
        r.amount && r.density && r.karat && r.purity && r.netWeight && r.pounds
          ? { density: r.density, karat: r.karat, purity: r.purity, netWeight: r.netWeight, pounds: r.pounds, amount: r.amount }
          : null,
    };
  });
  const total = items.reduce((s, i) => s + Number(i.result?.amount ?? 0), 0);
  return {
    id: c.id,
    branchId: c.branchId,
    reference: null,
    customerName: c.customerName,
    customerPhone: c.customerPhone ?? null,
    items,
    calculatedAmount: String(total),
    payout: {
      payable: c.payout.payable,
      difference: String(Number(c.payout.payable) - total),
      lines: c.payout.lines,
      totalNotes: Object.values(c.payout.lines).reduce((s, n) => s + n, 0),
    },
    capturedAt: c.capturedAt,
    flags: [],
    sync: e.status === 'failed' ? 'failed' : 'waiting',
    error: e.lastError?.message,
  };
};

export const flagText: Record<TransactionFlag, string> = {
  OFFLINE_ENTRY: 'Saved offline, synced later',
  CALC_MISMATCH: 'Server amount differs from the device',
  PRICE_STALE: 'Price was old when used',
};
