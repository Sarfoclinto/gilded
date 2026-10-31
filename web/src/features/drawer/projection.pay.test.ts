import { describe, expect, it } from "vitest";
import { projectDrawer, type Pending } from "./projection";
import type { DayState } from "./schemas";

const state = (balance: Record<string, number>, applied: string[] = []) =>
  ({
    day: {
      id: "d1",
      status: "open",
      businessDate: "2026-10-31",
      opening: { lines: balance },
      closing: null,
    },
    balance,
    appliedIds: applied,
    carryOver: null,
  }) as unknown as DayState;

const create: Pending = {
  id: "tx1",
  type: "transaction.create",
  payload: { branchId: "b1", payout: { lines: { "200": 5 } } },
};
const pay: Pending = {
  id: "pay-tx1",
  type: "transaction.pay",
  payload: { transactionId: "tx1", branchId: "b1", lines: { "100": 10 } },
};

describe("the drawer with two-step payout", () => {
  it("takes the notes out when a purchase is saved, as before, when two-step is off", () => {
    expect(
      projectDrawer(state({ "200": 10 }), [create], "b1", false).balance,
    ).toEqual({ "200": 5 });
  });
  it("leaves the drawer alone when a purchase is only saved", () => {
    expect(
      projectDrawer(state({ "200": 10 }), [create], "b1", true).balance,
    ).toEqual({ "200": 10 });
  });
  it("takes the notes out when the cash is handed over", () => {
    expect(
      projectDrawer(state({ "100": 20 }), [create, pay], "b1", true).balance,
    ).toEqual({ "100": 10 });
  });
  it("does not count a payout the server has already applied", () => {
    expect(
      projectDrawer(state({ "100": 10 }, ["tx1"]), [pay], "b1", true).balance,
    ).toEqual({ "100": 10 });
  });
  it("ignores a payout for another branch", () => {
    expect(
      projectDrawer(
        state({ "100": 20 }),
        [{ ...pay, payload: { ...pay.payload, branchId: "b2" } } as Pending],
        "b1",
        true,
      ).balance,
    ).toEqual({ "100": 20 });
  });
});
