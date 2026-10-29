import { describe, expect, it } from "vitest";
import {
  canHandBack,
  filterHeld,
  heldDays,
  heldText,
  summarizeHeld,
} from "./collateralModel";
import type { Collateral } from "./schemas";

const now = new Date(2026, 9, 29, 12);
const c = (id: string, o: Partial<Collateral> = {}): Collateral => ({
  id,
  branchId: "b",
  debtId: "d",
  status: "held",
  topWeight: "10",
  receivedAt: new Date(2026, 9, 25, 9).toISOString(),
  customer: { id: "x", name: "Kofi" },
  debtOutstanding: "500",
  ...o,
});

describe("collateral model", () => {
  it("counts days held", () => {
    expect(heldDays(new Date(2026, 9, 29, 8).toISOString(), now)).toBe(0);
    expect(heldDays(new Date(2026, 9, 25, 8).toISOString(), now)).toBe(4);
    expect(heldText(0)).toBe("Received today");
    expect(heldText(1)).toBe("Held since yesterday");
    expect(heldText(4)).toBe("Held for 4 days");
  });
  it("allows handing back only when paid", () => {
    expect(canHandBack(c("a"))).toBe(false);
    expect(canHandBack(c("a", { debtOutstanding: "0" }))).toBe(true);
    expect(canHandBack(c("a", { debtOutstanding: null }))).toBe(true);
    expect(
      canHandBack(c("a", { status: "returned", debtOutstanding: "0" })),
    ).toBe(false);
  });
  it("summarises held pieces only", () => {
    const list = [
      c("a"),
      c("b", {
        topWeight: "2.5",
        debtOutstanding: "0",
        receivedAt: new Date(2026, 9, 20).toISOString(),
      }),
      c("z", { status: "converted" }),
    ];
    expect(summarizeHeld(list, now)).toEqual({
      pieces: 2,
      weight: 12.5,
      owed: 500,
      longest: 9,
    });
  });
  it("filters, searches and orders oldest first", () => {
    const list = [
      c("a"),
      c("b", {
        customer: { id: "y", name: "Ama" },
        receivedAt: new Date(2026, 9, 20).toISOString(),
      }),
      c("z", { status: "returned" }),
    ];
    expect(filterHeld(list, "held", "").map((x) => x.id)).toEqual(["b", "a"]);
    expect(filterHeld(list, "all", "ama").map((x) => x.id)).toEqual(["b"]);
    expect(filterHeld(list, "returned", "").map((x) => x.id)).toEqual(["z"]);
  });
});
