import { describe, expect, it } from "vitest";
import { describeCarat } from "./expectations";

describe("describeCarat", () => {
  it("says nothing without history", () => {
    expect(describeCarat("Obuasi", null, "is usually")).toBeNull();
    expect(
      describeCarat("Obuasi", { n: 0, enough: false }, "is usually"),
    ).toBeNull();
  });
  it("shows only the count when there are too few pieces", () => {
    expect(
      describeCarat(
        "Obuasi",
        { n: 1, enough: false, usual: "19 mid" },
        "is usually",
      ),
    ).toBe("Obuasi: only 1 piece bought so far, too few to say what is usual.");
  });
  it("gives the usual carat and range", () => {
    expect(
      describeCarat(
        "Obuasi",
        { n: 47, enough: true, usual: "22 high", from: "22 mid", to: "23 low" },
        "is usually",
      ),
    ).toBe("Obuasi is usually 22 high (mostly 22 mid to 23 low) · 47 pieces");
  });
  it("leaves out a range that is a single value", () => {
    expect(
      describeCarat(
        "Kwesi",
        { n: 9, enough: true, usual: "21 low", from: "21 low", to: "21 low" },
        "usually brings",
      ),
    ).toBe("Kwesi usually brings 21 low · 9 pieces");
  });
});
