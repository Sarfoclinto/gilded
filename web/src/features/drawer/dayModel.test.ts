import { describe, expect, it } from "vitest";
import { drawerFlow, filterDays, summarizeDays } from "./dayModel";
import type { Day, Movement } from "./schemas";

const p = { id: "u", displayName: "A" };
const day = (
  id: string,
  cashDiff: string | null,
  status: "pending" | "approved" | "not_required" = "not_required",
): Day => ({
  id,
  branchId: "b",
  businessDate: "2026-10-01",
  status: cashDiff === null ? "open" : "closed",
  opening: { lines: {}, source: "counted" },
  openedAt: "",
  openedBy: p,
  flags: [],
  closing:
    cashDiff === null
      ? null
      : {
          closedAt: "",
          closedBy: p,
          confirmation: { version: "v", text: "t" },
          cash: { expected: {}, counted: {} },
          signoff: { status },
          figures: [
            {
              asset: "cash",
              expected: "100",
              actual: "100",
              difference: cashDiff,
              outcome:
                cashDiff === "0"
                  ? "balanced"
                  : Number(cashDiff) < 0
                    ? "shortage"
                    : "surplus",
            },
          ],
        },
});

describe("day history", () => {
  const days = [
    day("1", "-50", "pending"),
    day("2", "0"),
    day("3", "20", "approved"),
    day("4", null),
  ];
  it("summarises", () =>
    expect(summarizeDays(days)).toEqual({
      days: 4,
      waiting: 1,
      withDifferences: 2,
      cashNet: -30,
    }));
  it("filters", () => {
    expect(filterDays(days, "pending").map((d) => d.id)).toEqual(["1"]);
    expect(filterDays(days, "differences").map((d) => d.id)).toEqual([
      "1",
      "3",
    ]);
    expect(filterDays(days, "all")).toHaveLength(4);
  });
});

describe("drawerFlow", () => {
  const mv = (
    kind: "topup" | "withdrawal",
    lines: Record<string, number>,
  ): Movement => ({
    id: kind,
    dayId: "d",
    kind,
    lines,
    note: "n",
    capturedAt: "",
    createdBy: p,
  });
  it("splits opening, in, out and the rest", () => {
    const f = drawerFlow(
      { "100": 10 },
      [mv("topup", { "100": 5 }), mv("withdrawal", { "50": 2 })],
      { "100": 12, "50": 0 },
    );
    expect(f).toEqual({
      opened: 1000,
      cashIn: 500,
      cashOut: 100,
      other: -200,
      now: 1200,
    });
  });
});
