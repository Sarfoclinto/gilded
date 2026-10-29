import { describe, expect, it } from "vitest";
import { goldTotals, paymentMix, receiptText, timeline } from "./receipt";
import type { TransactionView } from "./view";

const item = (net: string, pounds: string, price: string) => ({
  id: net,
  label: null,
  top: "10",
  down: "9",
  price,
  result: {
    density: "15",
    karat: "22",
    purity: "0.9",
    netWeight: net,
    pounds,
    amount: "1000",
  },
});
const base = (over: Partial<TransactionView> = {}): TransactionView => ({
  id: "t",
  branchId: "b",
  reference: "KSI-1",
  customerName: "Kofi",
  customerPhone: null,
  items: [],
  calculatedAmount: "1000",
  payout: { payable: "1000", difference: "0", lines: {}, totalNotes: 0 },
  payments: [],
  customerId: null,
  representative: null,
  capturedAt: "2026-10-20T10:00:00Z",
  status: "paid",
  flags: [],
  sync: "synced",
  ...over,
});

describe("gold totals", () => {
  it("adds the items and finds the price range", () => {
    const g = goldTotals({
      items: [item("5.5", "1", "11000"), item("3", "0.5", "11200")],
    });
    expect(g).toMatchObject({
      netGrams: 8.5,
      pounds: 1.5,
      items: 2,
      priceMin: 11000,
      priceMax: 11200,
    });
  });
  it("copes with nothing", () =>
    expect(goldTotals({ items: [] })).toMatchObject({
      netGrams: 0,
      items: 0,
      priceMin: 0,
      priceMax: 0,
    }));
});

describe("payment mix", () => {
  it("splits by method and ignores failed ones", () => {
    const mix = paymentMix({
      payments: [
        { id: "1", method: "cash", amount: "750", status: "confirmed" },
        { id: "2", method: "mobile_money", amount: "250", status: "confirmed" },
        { id: "3", method: "mobile_money", amount: "999", status: "failed" },
      ],
    });
    expect(mix.map((m) => [m.key, m.share])).toEqual([
      ["cash", 75],
      ["mobileMoney", 25],
    ]);
  });
});

describe("timeline", () => {
  it("is oldest first and shows when an offline purchase reached the server", () => {
    const ev = timeline(
      base({
        priceAsOf: "2026-10-20T09:00:00Z",
        createdAt: "2026-10-20T12:00:00Z",
        createdBy: "Ama",
        formulaVersion: "ExcelV1",
      }),
    );
    expect(ev.map((e) => e.key)).toEqual(["price", "captured", "synced"]);
  });
  it("does not report a sync gap for a purchase saved straight away", () => {
    expect(
      timeline(base({ createdAt: "2026-10-20T10:00:05Z" })).map((e) => e.key),
    ).toEqual(["captured"]);
  });
  it("ends with the cancellation, who did it and why", () => {
    const ev = timeline(
      base({
        status: "void",
        createdAt: "2026-10-20T10:00:05Z",
        cancelled: {
          at: "2026-10-21T08:00:00Z",
          by: "Kojo",
          reason: "Wrong customer",
        },
      }),
    );
    expect(ev.at(-1)).toMatchObject({
      key: "void",
      tone: "bad",
      detail: "By Kojo · Wrong customer",
    });
  });
  it("shows a waiting purchase as waiting", () => {
    expect(timeline(base({ sync: "waiting" })).map((e) => e.key)).toContain(
      "waiting",
    );
  });
});

describe("receipt text", () => {
  it("lists who, what and how it was paid", () => {
    const t = base({
      items: [item("5", "1", "11000")],
      payments: [
        { id: "1", method: "cash", amount: "1000", status: "confirmed" },
      ],
    });
    const text = receiptText(
      t,
      () => "20 Oct, 10:00",
      (n) => `GHS ${n}`,
    );
    expect(text).toContain("Receipt KSI-1");
    expect(text).toContain("Kofi · 20 Oct, 10:00");
    expect(text).toContain("Paid: GHS 1000");
    expect(text).toContain("Cash: GHS 1000");
    expect(text).not.toContain("CANCELLED");
  });
});
