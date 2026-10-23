import { describe, expect, it } from "vitest";
import {
  compareCount,
  limitsFromBalance,
  projectDrawer,
  type Pending,
} from "./projection";
import type { Day, DayState } from "./schemas";

const person = { id: "u", displayName: "U" };
const openDay = (over: Partial<Day> = {}): Day => ({
  id: "d1",
  branchId: "b",
  businessDate: "2026-10-22",
  status: "open",
  opening: { lines: { "100": 100 }, source: "counted" },
  openedAt: "t",
  openedBy: person,
  closing: null,
  flags: [],
  ...over,
});
const state = (
  day: Day | null,
  balance: Record<string, number> | null,
  appliedIds: string[] = [],
  carryOver = null,
): DayState => ({
  day,
  balance,
  movements: [],
  appliedIds,
  carryOver,
  asOf: "t",
});
const pay = (id: string, lines: Record<string, number>): Pending => ({
  id,
  type: "transaction.create",
  payload: { branchId: "b", payout: { lines } },
});

describe("projectDrawer", () => {
  it("is unknown before anything loaded", () => {
    expect(projectDrawer(null, [], "b").status).toBe("unknown");
  });

  it("is none when the server has no day", () => {
    expect(projectDrawer(state(null, null), [], "b")).toMatchObject({
      status: "none",
      balance: null,
    });
  });

  it("uses the server balance when nothing is waiting", () => {
    const v = projectDrawer(state(openDay(), { "100": 90 }), [], "b");
    expect(v).toMatchObject({
      status: "open",
      balance: { "100": 90 },
      pendingCount: 0,
    });
  });

  it("takes waiting payouts off the balance, so one note is never promised twice", () => {
    const v = projectDrawer(
      state(openDay(), { "100": 90, "50": 10 }),
      [pay("t1", { "100": 40 }), pay("t2", { "100": 40, "50": 3 })],
      "b",
    );
    expect(v.balance).toEqual({ "100": 10, "50": 7 });
    expect(v.pendingCount).toBe(2);
  });

  it("does not count a command twice once the server has applied it", () => {
    const v = projectDrawer(
      state(openDay(), { "100": 50 }, ["t1"]),
      [pay("t1", { "100": 40 })],
      "b",
    );
    expect(v.balance).toEqual({ "100": 50 });
    expect(v.pendingCount).toBe(0);
  });

  it("applies top-ups and withdrawals in order", () => {
    const v = projectDrawer(
      state(openDay(), { "100": 10 }),
      [
        {
          id: "m1",
          type: "drawer.movement",
          payload: {
            id: "m1",
            dayId: "d1",
            branchId: "b",
            kind: "topup",
            lines: { "100": 5, "50": 2 },
            note: "x",
            capturedAt: "t",
          },
        },
        {
          id: "m2",
          type: "drawer.movement",
          payload: {
            id: "m2",
            dayId: "d1",
            branchId: "b",
            kind: "withdrawal",
            lines: { "50": 1 },
            note: "y",
            capturedAt: "t",
          },
        },
      ],
      "b",
    );
    expect(v.balance).toEqual({ "100": 15, "50": 1 });
  });

  it("ignores payouts once the day is closed", () => {
    const v = projectDrawer(
      state(openDay({ status: "closed" }), null),
      [pay("t1", { "100": 5 })],
      "b",
    );
    expect(v.status).toBe("closed");
    expect(v.balance).toBeNull();
  });

  it("flags a negative balance instead of hiding it", () => {
    const v = projectDrawer(
      state(openDay(), { "100": 1 }),
      [pay("t1", { "100": 3 })],
      "b",
    );
    expect(v.balance).toEqual({ "100": -2 });
    expect(v.negative).toBe(true);
  });
});

describe("limitsFromBalance", () => {
  it("only offers notes that are in the drawer, with their counts", () => {
    expect(
      limitsFromBalance({ "100": 12, "50": 0, "20": -2, "10": 3 }),
    ).toEqual({ "100": 12, "10": 3 });
  });
});

describe("compareCount", () => {
  it("reports counted minus expected, per note and in cedis", () => {
    expect(
      compareCount({ "100": 10, "50": 4 }, { "100": 9, "50": 4, "20": 1 }),
    ).toEqual({ variance: { "100": -1, "20": 1 }, amount: -80 });
    expect(compareCount({ "100": 3 }, { "100": 3 })).toEqual({
      variance: {},
      amount: 0,
    });
  });
});
