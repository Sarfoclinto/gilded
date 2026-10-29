import { describe, expect, it } from "vitest";
import {
  byUrgency,
  dateInDays,
  dueOf,
  matches,
  repaidShare,
  summarize,
} from "./model";
import type { Debt } from "./schemas";

const now = new Date(2026, 9, 29, 12, 0, 0);
const debt = (o: Partial<Debt> & { id: string }): Debt => ({
  branchId: "b",
  direction: "receivable",
  party: { type: "customer", name: "Ama" },
  principal: "1000",
  repaid: "0",
  outstanding: "1000",
  issuedAt: "2026-10-01T00:00:00Z",
  status: "open",
  repayments: [],
  ...o,
});

describe("debts model", () => {
  it("reads due dates", () => {
    expect(dueOf(debt({ id: "a" }), now).state).toBe("none");
    expect(dueOf(debt({ id: "a", dueDate: "2026-10-27" }), now)).toMatchObject({
      state: "overdue",
      text: "Overdue by 2 days",
    });
    expect(dueOf(debt({ id: "a", dueDate: "2026-10-29" }), now).text).toBe(
      "Due today",
    );
    expect(dueOf(debt({ id: "a", dueDate: "2026-10-31" }), now)).toMatchObject({
      state: "soon",
      text: "Due in 2 days",
    });
    expect(dueOf(debt({ id: "a", dueDate: "2026-12-01" }), now).state).toBe(
      "ok",
    );
    expect(
      dueOf(debt({ id: "a", dueDate: "2026-10-01", status: "settled" }), now)
        .state,
    ).toBe("none");
  });
  it("measures repayment", () => {
    expect(repaidShare({ principal: "1000", repaid: "250" })).toBe(0.25);
    expect(repaidShare({ principal: "0", repaid: "0" })).toBe(0);
  });
  it("summarises and orders", () => {
    const list = [
      debt({ id: "a", outstanding: "300" }),
      debt({
        id: "b",
        outstanding: "100",
        dueDate: "2026-10-20",
        collateral: { id: "c", topWeight: "5", status: "held" },
      }),
      debt({ id: "c", status: "settled", outstanding: "0" }),
    ];
    expect(summarize(list, now)).toEqual({
      open: 2,
      total: 400,
      overdue: 1,
      held: 1,
    });
    expect(byUrgency(list, now).map((d) => d.id)).toEqual(["b", "a", "c"]);
  });
  it("searches and picks dates", () => {
    expect(matches(debt({ id: "a", reason: "School fees" }), "school")).toBe(
      true,
    );
    expect(matches(debt({ id: "a" }), "kofi")).toBe(false);
    expect(dateInDays(7, now)).toBe("2026-11-05");
  });
});
