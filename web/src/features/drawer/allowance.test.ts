import { describe, expect, it } from "vitest";
import { allowanceDue } from "./allowance";
import { movementCommandSchema } from "./schemas";

const base = {
  id: "a",
  dayId: "d",
  branchId: "b",
  lines: { "100": 3 },
  capturedAt: "2026-10-30T10:00:00Z",
};

describe("office allowance", () => {
  it("is the rate times the people", () => {
    expect(allowanceDue(3)).toBe(300);
    expect(allowanceDue(0)).toBe(0);
    expect(allowanceDue(2.5)).toBe(0);
  });
  it("needs the number of people but no note", () => {
    expect(
      movementCommandSchema.safeParse({ ...base, kind: "allowance", note: "" })
        .success,
    ).toBe(false);
    expect(
      movementCommandSchema.safeParse({
        ...base,
        kind: "allowance",
        note: "",
        people: 3,
      }).success,
    ).toBe(true);
  });
  it("other movements still need a note", () => {
    expect(
      movementCommandSchema.safeParse({ ...base, kind: "topup", note: "" })
        .success,
    ).toBe(false);
    expect(
      movementCommandSchema.safeParse({
        ...base,
        kind: "withdrawal",
        note: "float",
      }).success,
    ).toBe(true);
  });
});
