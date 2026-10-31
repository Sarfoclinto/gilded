import { calculate } from "@gold/core";
import type { OutboxEntry } from "@/shared/offline/outboxStore";
import type {
  CreateTransaction,
  Payment,
  Transaction,
  TransactionFlag,
} from "./schemas";

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
    result: {
      density: string;
      karat: string;
      purity: string;
      netWeight: string;
      pounds: string;
      amount: string;
    } | null;
  }>;
  calculatedAmount: string;
  payout: {
    payable: string;
    difference: string;
    lines: Record<string, number>;
    totalNotes: number;
    /** to_pay: saved, the cash is still to be handed over. */
    stage: "paid" | "to_pay";
    cashDue: string;
    suggestedLines: Record<string, number> | null;
    paidBy: string | null;
    paidAt: string | null;
  };
  /** How it was paid: cash, mobile money, owed, gold against a debt. While waiting on this device they are not confirmed yet. */
  payments: Payment[];
  customerId: string | null;
  representative: { name: string; phone: string | null } | null;
  capturedAt: string;
  /** saved, paid or void. A waiting entry is saved. */
  status: string;
  flags: TransactionFlag[];
  sync: "synced" | "waiting" | "failed";
  error?: string;
  createdBy?: string;
  /** When it reached the server (a purchase recorded offline reaches it later than it was captured). */
  createdAt?: string;
  priceAsOf?: string;
  formulaVersion?: string;
  payoutPolicy?: string;
  /** Set when the purchase was cancelled. */
  cancelled?: { at: string | null; reason: string | null; by: string | null };
}

export const fromServer = (t: Transaction): TransactionView => ({
  id: t.id,
  branchId: t.branchId,
  reference: t.reference,
  customerName: t.customerName,
  customerPhone: t.customerPhone ?? null,
  customerId: t.customerId ?? null,
  representative: t.representative?.name
    ? { name: t.representative.name, phone: t.representative.phone ?? null }
    : null,
  payments: t.payments,
  items: t.items.map((i) => ({
    id: i.id,
    label: i.label ?? null,
    top: i.top,
    down: i.down,
    price: i.price,
    result: i.result,
  })),
  calculatedAmount: t.calculatedAmount,
  payout: {
    payable: t.payout.payable,
    difference: t.payout.difference,
    lines: t.payout.lines,
    totalNotes: t.payout.totalNotes,
    stage: t.payout.stage,
    cashDue: t.payout.cashDue,
    suggestedLines: t.payout.suggestedLines ?? null,
    paidBy: t.payout.paidBy?.displayName ?? null,
    paidAt: t.payout.paidAt ?? null,
  },
  capturedAt: t.capturedAt,
  status: t.status,
  flags: t.flags,
  sync: "synced",
  createdBy: t.createdBy.displayName,
  createdAt: t.createdAt,
  priceAsOf: t.priceAsOf ?? undefined,
  formulaVersion: t.formulaVersion,
  payoutPolicy: t.payout.policy,
  cancelled:
    t.status === "void"
      ? {
          at: t.voidedAt ?? null,
          reason: t.voidReason ?? null,
          by: t.voidedBy?.displayName ?? null,
        }
      : undefined,
});

const localPayments = (c: CreateTransaction): Payment[] => {
  const split = c.payout.split ?? [];
  const cash =
    Number(c.payout.payable) - split.reduce((s, p) => s + Number(p.amount), 0);
  return [
    ...(cash > 0
      ? [
          {
            id: `${c.id}-cash`,
            method: "cash",
            amount: String(cash),
            status: "confirmed",
          },
        ]
      : []),
    ...split.map((p, i) => ({
      id: `${c.id}-${i}`,
      method: p.method,
      amount: p.amount,
      status: p.method === "mobile_money" ? "pending" : "confirmed",
      paidByBranchId: p.paidByBranchId ?? null,
      externalRef: p.externalRef ?? null,
      debtId: p.debtId ?? null,
    })),
  ];
};

const cashPart = (c: CreateTransaction) =>
  Number(c.payout.payable) -
  (c.payout.split ?? []).reduce((s, p) => s + Number(p.amount), 0);

/** Rebuilds the figures from the saved inputs with the same engine, so a waiting entry looks like a real one. */
export const fromOutbox = (
  e: OutboxEntry,
  twoStep = false,
): TransactionView => {
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
          ? {
              density: r.density,
              karat: r.karat,
              purity: r.purity,
              netWeight: r.netWeight,
              pounds: r.pounds,
              amount: r.amount,
            }
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
    customerId: c.customerId ?? null,
    representative: c.representative?.name
      ? { name: c.representative.name, phone: c.representative.phone ?? null }
      : null,
    payments: localPayments(c).filter((p) => !(twoStep && p.method === "cash")),
    items,
    calculatedAmount: String(total),
    payout: {
      payable: c.payout.payable,
      difference: String(Number(c.payout.payable) - total),
      lines: twoStep ? {} : c.payout.lines,
      totalNotes: twoStep
        ? 0
        : Object.values(c.payout.lines).reduce((s, n) => s + n, 0),
      // In two-step mode the cash part waits to be paid once this reaches the server.
      stage: twoStep && cashPart(c) > 0 ? "to_pay" : "paid",
      cashDue: twoStep ? String(cashPart(c)) : "0",
      suggestedLines: twoStep && cashPart(c) > 0 ? c.payout.lines : null,
      paidBy: null,
      paidAt: null,
    },
    capturedAt: c.capturedAt,
    status: "saved",
    flags: [],
    sync: e.status === "failed" ? "failed" : "waiting",
    error: e.lastError?.message,
  };
};

export const flagText: Record<string, string> = {
  OFFLINE_ENTRY: "Saved offline, synced later",
  CALC_MISMATCH: "Server amount differs from the device",
  PRICE_STALE: "Price was old when used",
  HISTORICAL: "Imported from a past record. No cash or gold was moved.",
  AFTER_CLOSE:
    "Made before its day closed but reached the server after. That day's count will be off by this amount.",
  CLOCK_AHEAD: "The device clock was ahead, so the server's time was used.",
  NO_OPEN_DAY:
    "No open day when this reached the server. The cash still left the books.",
};

export const paymentMethodText: Record<string, string> = {
  cash: "Cash",
  mobile_money: "Mobile money",
  owed: "Owed to the customer",
  debt_offset: "Gold settles a debt",
};

export function paymentStatusLabel(method: string, status: string): string {
  if (status === "pending") return "Waiting for confirmation";
  if (status === "failed") return "Failed";
  return method === "mobile_money"
    ? "Received"
    : method === "owed"
      ? "Recorded as owed"
      : "Done";
}
