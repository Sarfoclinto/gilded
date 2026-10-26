import { describe, expect, it } from "vitest";
import { readPrefill } from "./carryOver";

describe("readPrefill", () => {
  it("reads the values a calculator carries over", () => {
    expect(
      readPrefill({
        prefill: { top: "10", down: "9", price: "3000", priceTouched: true },
      }),
    ).toEqual({ top: "10", down: "9", price: "3000", priceTouched: true });
  });
  it("ignores anything else", () => {
    expect(readPrefill(null)).toBeNull();
    expect(readPrefill({ prefill: { top: 10 } })).toBeNull();
    expect(readPrefill({})).toBeNull();
  });
});
