import { describe, expect, it } from "vitest";
import { liveAccountSchema } from "@/features/accounts/api";

const base = {
  branchId: "b",
  name: "Tarkwa",
  asOf: "2026-11-11T17:00:00Z",
  day: { id: "d", status: "open", businessDate: "2026-11-11" },
  debtors: [{ id: "x", name: "Kofi", amount: "500.00" }],
  debtTotal: "500.00",
  debtUnlisted: "0.00",
  goods: {
    total: "1000.00",
    top: "7.77",
    down: "7.40",
    transactions: [
      {
        id: "t",
        reference: "TKW-1",
        customerName: "Kwesi",
        capturedAt: "2026-11-11T10:00:00Z",
        top: "7.77",
        down: "7.40",
        value: "1000.00",
      },
    ],
    count: 1,
    listedTotal: "1000.00",
    broughtForward: "0.00",
  },
  owedToCustomers: "0.00",
  closing: "15600.00",
};

describe("the live closing account shape from the server", () => {
  it("reads sound notes as bundles and loose", () => {
    const a = liveAccountSchema.parse({
      ...base,
      cash: {
        total: "14100.00",
        notesSound: true,
        bundles: [{ denomination: 100, count: 100, value: "10000.00" }],
        bundlesTotal: "10000.00",
        loose: [{ denomination: 100, count: 35, value: "3500.00" }],
        looseTotal: "3500.00",
      },
    });
    expect(a.cash.bundlesTotal).toBe(10000);
    expect(a.goods.transactions[0]!.down).toBe(7.4);
  });
  it("reads unsound notes as amount only (the breakdown is null)", () => {
    const a = liveAccountSchema.parse({
      ...base,
      cash: {
        total: "13100.00",
        notesSound: false,
        bundles: null,
        bundlesTotal: null,
        loose: null,
        looseTotal: null,
      },
    });
    expect(a.cash.notesSound).toBe(false);
    expect(a.cash.bundles).toBeNull();
    expect(a.cash.total).toBe(13100);
  });
  it("allows no day yet", () => {
    expect(
      liveAccountSchema.parse({
        ...base,
        day: null,
        cash: {
          total: "0",
          notesSound: true,
          bundles: [],
          bundlesTotal: "0",
          loose: [],
          looseTotal: "0",
        },
      }).day,
    ).toBeNull();
  });
});
