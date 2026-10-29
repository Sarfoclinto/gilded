import { paymentMethodText, type TransactionView } from "./view";
import type { Segment } from "@/features/dashboard/model";

export interface GoldTotals {
  netGrams: number;
  pounds: number;
  items: number;
  /** Lowest and highest price per pound used; equal when every item used the same one. */
  priceMin: number;
  priceMax: number;
}

export function goldTotals(t: Pick<TransactionView, "items">): GoldTotals {
  let netGrams = 0,
    pounds = 0;
  const prices: number[] = [];
  for (const i of t.items) {
    netGrams += Number(i.result?.netWeight ?? 0);
    pounds += Number(i.result?.pounds ?? 0);
    if (Number(i.price) > 0) prices.push(Number(i.price));
  }
  return {
    netGrams,
    pounds,
    items: t.items.length,
    priceMin: prices.length ? Math.min(...prices) : 0,
    priceMax: prices.length ? Math.max(...prices) : 0,
  };
}

export const payoutRuleText: Record<string, string> = {
  down: "Rounded down to a whole note",
  up: "Rounded up to a whole note",
  nearest: "Rounded to the nearest note",
};

/** Cash, mobile money and owed as shares of what was to be paid. Failed payments are left out. */
export function paymentMix(t: Pick<TransactionView, "payments">): Segment[] {
  const sum = { cash: 0, mobileMoney: 0, owed: 0 };
  for (const p of t.payments) {
    if (p.status === "failed") continue;
    const a = Number(p.amount);
    if (p.method === "cash") sum.cash += a;
    else if (p.method === "mobile_money") sum.mobileMoney += a;
    else if (p.method === "owed") sum.owed += a;
  }
  const parts: Segment[] = [
    { key: "cash", label: "Cash", value: sum.cash, share: 0 },
    {
      key: "mobileMoney",
      label: "Mobile money",
      value: sum.mobileMoney,
      share: 0,
    },
    { key: "owed", label: "Owed to the customer", value: sum.owed, share: 0 },
  ];
  const live = parts.filter((s) => s.value > 0);
  const total = live.reduce((s, x) => s + x.value, 0);
  return live.map((s) => ({
    ...s,
    share: total ? (s.value / total) * 100 : 0,
  }));
}

export interface TimelineEvent {
  key: string;
  at: string;
  title: string;
  detail?: string;
  tone: "normal" | "good" | "bad" | "wait";
}

const OFFLINE_GAP_MS = 2 * 60_000;

/** What happened to this purchase, oldest first. */
export function timeline(t: TransactionView): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  if (t.priceAsOf)
    out.push({
      key: "price",
      at: t.priceAsOf,
      title: "Price fixed",
      detail: t.formulaVersion ? `Formula ${t.formulaVersion}` : undefined,
      tone: "normal",
    });
  out.push({
    key: "captured",
    at: t.capturedAt,
    title: "Gold weighed and recorded",
    detail: t.createdBy ? `By ${t.createdBy}` : undefined,
    tone: "normal",
  });
  if (t.sync === "waiting")
    out.push({
      key: "waiting",
      at: t.capturedAt,
      title: "Waiting to reach the server",
      detail: "Saved on this device",
      tone: "wait",
    });
  if (t.sync === "failed")
    out.push({
      key: "failed",
      at: t.capturedAt,
      title: "The server refused it",
      detail: t.error,
      tone: "bad",
    });
  if (
    t.createdAt &&
    new Date(t.createdAt).getTime() - new Date(t.capturedAt).getTime() >
      OFFLINE_GAP_MS
  )
    out.push({
      key: "synced",
      at: t.createdAt,
      title: "Reached the server",
      detail: "Recorded without a connection and sent later",
      tone: "normal",
    });
  for (const p of t.payments)
    if (p.confirmedAt && p.method === "mobile_money")
      out.push({
        key: `pay-${p.id}`,
        at: p.confirmedAt,
        title:
          p.status === "failed"
            ? "Mobile money failed"
            : "Mobile money confirmed",
        detail: `${paymentMethodText[p.method]} · GHS ${Number(p.amount).toLocaleString("en-GH")}`,
        tone: p.status === "failed" ? "bad" : "good",
      });
  if (t.cancelled?.at)
    out.push({
      key: "void",
      at: t.cancelled.at,
      title: "Cancelled",
      detail:
        [t.cancelled.by ? `By ${t.cancelled.by}` : null, t.cancelled.reason]
          .filter(Boolean)
          .join(" · ") || undefined,
      tone: "bad",
    });
  return out.sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );
}

/** A short text version to paste into WhatsApp or a message. */
export function receiptText(
  t: TransactionView,
  when: (iso: string) => string,
  money: (n: string | number) => string,
): string {
  const g = goldTotals(t);
  const lines = [
    `Receipt ${t.reference ?? "(not numbered yet)"}`,
    `${t.customerName} · ${when(t.capturedAt)}`,
    `Gold: ${t.items.length} item${t.items.length === 1 ? "" : "s"}, net ${g.netGrams.toLocaleString("en-GH", { maximumFractionDigits: 2 })} g`,
    `Paid: ${money(t.payout.payable)}`,
    ...t.payments.map(
      (p) => `  ${paymentMethodText[p.method] ?? p.method}: ${money(p.amount)}`,
    ),
  ];
  if (t.status === "void") lines.push("CANCELLED");
  return lines.join("\n");
}
