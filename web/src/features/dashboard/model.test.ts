import { describe, expect, it } from "vitest";
import { dashboardSchema, type Dashboard } from "./api";
import {
  attention,
  average,
  change,
  compact,
  niceMax,
  paymentSegments,
  viewFor,
  windowTotals,
} from "./model";

const base = (over: Partial<Dashboard> = {}): Dashboard => ({
  asOf: "2026-10-20T12:00:00Z",
  days: 14,
  today: { count: 0, paid: "0", voided: 0, flagged: 0, pounds: "0" },
  yesterday: { count: 0, paid: "0" },
  series: [],
  branches: [],
  payments: { cash: "0", mobileMoney: "0", owed: "0" },
  pendingMoney: 0,
  signoffPending: 0,
  stock: { onHand: "0", inTransit: "0" },
  transfers: { onTheRoad: 0, value: "0" },
  debts: { owedToUs: "0", count: 0, overdue: 0 },
  flags: {},
  mine: { todayCount: 0, todayPaid: "0", periodCount: 0, recent: [] },
  ...over,
});

describe("which home a person gets", () => {
  it("goes by what they may do", () => {
    expect(viewFor(["transactions:create"])).toBe("teller");
    expect(viewFor(["transactions:create", "reports:read"])).toBe("manager");
    expect(viewFor(["reports:read", "prices:approve"])).toBe("director");
    expect(viewFor([])).toBe("teller");
  });
});

describe("change", () => {
  it("compares with yesterday", () => {
    expect(change(150, 100)).toEqual({ pct: 50, dir: "up" });
    expect(change(50, 100)).toEqual({ pct: -50, dir: "down" });
    expect(change(100, 100)).toEqual({ pct: 0, dir: "flat" });
  });
  it("has nothing to compare with when yesterday was empty", () => {
    expect(change(10, 0)).toEqual({ pct: null, dir: "up" });
    expect(change(0, 0)).toEqual({ pct: null, dir: "flat" });
  });
  it("averages safely", () => {
    expect(average("1000", 4)).toBe(250);
    expect(average("1000", 0)).toBe(0);
  });
});

describe("window totals", () => {
  it("adds up the period and finds the best day", () => {
    const t = windowTotals([
      { date: "2026-10-18", count: 1, paid: "1000", pounds: "2.5" },
      { date: "2026-10-19", count: 2, paid: "3000", pounds: "4" },
      { date: "2026-10-20", count: 0, paid: "0", pounds: "0" },
    ]);
    expect(t).toMatchObject({
      paid: 4000,
      count: 3,
      pounds: 6.5,
      best: { date: "2026-10-19", paid: 3000 },
    });
    expect(t.perDay).toBeCloseTo(1333.33, 1);
    expect(windowTotals([]).best).toBeNull();
  });
});

describe("payment mix", () => {
  it("gives shares that add up to 100 and drops empty parts", () => {
    const s = paymentSegments({ cash: "3000", mobileMoney: "1000", owed: "0" });
    expect(s.map((x) => x.key)).toEqual(["cash", "mobileMoney"]);
    expect(s.reduce((a, x) => a + x.share, 0)).toBeCloseTo(100);
    expect(s[0]!.share).toBe(75);
    expect(paymentSegments({ cash: "0", mobileMoney: "0", owed: "0" })).toEqual(
      [],
    );
  });
});

describe("what needs attention", () => {
  it("is empty when all is calm", () =>
    expect(attention(base(), { canSignoff: true })).toEqual([]));
  it("puts cash differences first, and only offers sign-off to people who can do it", () => {
    const d = base({
      signoffPending: 2,
      pendingMoney: 1,
      cashDifferences: { days: 1, net: "-100", recent: [] },
    });
    const withRight = attention(d, { canSignoff: true });
    expect(withRight[0]!.key).toBe("cash");
    expect(withRight.map((a) => a.key)).toContain("signoff");
    expect(attention(d, { canSignoff: false }).map((a) => a.key)).not.toContain(
      "signoff",
    );
  });
  it("counts only suspicious flags, not offline entries", () => {
    expect(
      attention(base({ flags: { OFFLINE_ENTRY: 5 } }), { canSignoff: true }),
    ).toEqual([]);
    expect(
      attention(base({ flags: { CALC_MISMATCH: 1, PRICE_STALE: 2 } }), {
        canSignoff: true,
      })[0]!.text,
    ).toContain("3 purchases flagged");
  });
  it("mentions branches that have not opened", () => {
    const b = {
      branchId: "b",
      name: "Kumasi",
      todayCount: 0,
      todayPaid: "0",
      periodCount: 0,
      periodPaid: "0",
      flagged: 0,
      voided: 0,
      day: "none" as const,
      signoffPending: 0,
      goldOnHand: "0",
    };
    expect(
      attention(base({ branches: [b] }), { canSignoff: true })[0]!.text,
    ).toBe("Kumasi has not opened today");
  });
});

describe("axis helpers", () => {
  it("rounds the top of the axis up", () => {
    expect(niceMax(4300)).toBe(5000);
    expect(niceMax(0)).toBe(1);
    expect(niceMax(1)).toBe(1);
    expect(niceMax(120)).toBe(200);
  });
  it("shortens big numbers", () => {
    expect(compact(950)).toBe("950");
    expect(compact(12500)).toBe("12.5k");
    expect(compact(1800000)).toBe("1.8M");
  });
});

describe("the dashboard response", () => {
  it("is accepted when the weight today arrives as a number (as the database sends it)", () => {
    const wire = {
      ...base(),
      today: { count: 0, paid: "0", voided: 0, flagged: 0, pounds: 0 },
    };
    const parsed = dashboardSchema.parse(wire);
    expect(parsed.today.pounds).toBe("0");
    expect(
      dashboardSchema.parse({ ...wire, today: { ...wire.today, pounds: 6.5 } })
        .today.pounds,
    ).toBe("6.5");
  });
});
