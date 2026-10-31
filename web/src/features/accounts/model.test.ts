import { describe, expect, it } from "vitest";
import type { ClosedAccount } from "./api";
import { closingFrom, combine, money, shiftDate, signed } from "./model";

const base: ClosedAccount = {
  branchId: "a",
  name: "Tarkwa",
  isMain: false,
  businessDate: "2026-10-30",
  status: "closed",
  day: {
    id: "d1",
    openedAt: "",
    closedAt: "",
    closedBy: null,
    signoff: "not_required",
    sessions: 1,
  },
  debtors: [{ id: "1", name: "Alex", amount: 100000, change: 0, isNew: false }],
  debtTotal: 100000,
  debtUnlisted: 0,
  cash: {
    bundles: [{ denomination: 100, count: 200, value: 20000 }],
    bundlesTotal: 20000,
    loose: [{ denomination: 100, count: 69, value: 6900 }],
    looseTotal: 6900,
    total: 26900,
  },
  goods: {
    total: 1000,
    days: [{ date: "2026-10-30", value: 1000 }],
    broughtForward: 0,
    lastSentOn: null,
    sent: [],
  },
  owedToCustomers: 0,
  allowance: { paid: 300, people: 3 },
  closing: 127900,
  previous: { date: "2026-10-29", closing: 128215 },
  change: -315,
};

describe("closing balance", () => {
  it("is cash + debts + goods, less what is owed to customers", () => {
    expect(closingFrom(base)).toBe(127900);
    expect(closingFrom({ ...base, owedToCustomers: 900 })).toBe(127000);
  });
  it("matches the A4 sheet of 30/10/26", () => {
    expect(33500 + 10245).toBe(43745);
    expect(43745 + 431824 + 1369655).toBe(1845224);
  });
});

describe("combine", () => {
  const other: ClosedAccount = {
    ...base,
    branchId: "b",
    name: "Kumasi",
    debtors: [{ id: "2", name: "Abu", amount: 50, change: null, isNew: true }],
    debtTotal: 50,
    cash: {
      bundles: [
        { denomination: 100, count: 100, value: 10000 },
        { denomination: 50, count: 100, value: 5000 },
      ],
      bundlesTotal: 15000,
      loose: [],
      looseTotal: 0,
      total: 15000,
    },
    goods: {
      total: 500,
      days: [
        { date: "2026-10-30", value: 200 },
        { date: "2026-10-29", value: 300 },
      ],
      broughtForward: 0,
      lastSentOn: null,
      sent: [],
    },
    closing: 15550,
    previous: { date: "2026-10-29", closing: 15550 },
    change: 0,
  };
  it("adds the figures and merges notes by denomination", () => {
    const c = combine([base, other])!;
    expect(c.cash.total).toBe(41900);
    expect(c.cash.bundles.map((b) => [b.denomination, b.count])).toEqual([
      [100, 300],
      [50, 100],
    ]);
    expect(c.closing).toBe(143450);
    expect(c.change).toBe(-315);
    expect(c.debtors.map((d) => d.branch)).toEqual(["Tarkwa", "Kumasi"]);
    expect(c.goods.days).toEqual([
      { date: "2026-10-30", value: 1200 },
      { date: "2026-10-29", value: 300 },
    ]);
    expect(c.allowance).toEqual({ paid: 600, people: 6 });
  });
  it("gives the one account back unchanged and nothing for none", () => {
    expect(combine([base])).toBe(base);
    expect(combine([])).toBeNull();
  });
  it("does not claim a change when a branch has no earlier day", () => {
    expect(
      combine([base, { ...other, previous: null, change: null }])!.change,
    ).toBeNull();
  });
});

describe("helpers", () => {
  it("moves dates across month ends", () => {
    expect(shiftDate("2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("formats money and signed changes", () => {
    expect(money(1845239)).toBe("GHS 1,845,239");
    expect(money(10.5)).toBe("GHS 10.5");
    expect(signed(-315)).toBe("−315");
    expect(signed(20)).toBe("+20");
    expect(signed(0)).toBe("0");
  });
});
