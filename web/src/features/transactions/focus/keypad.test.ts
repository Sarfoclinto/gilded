import { describe, expect, it } from "vitest";
import { applyKey, nextField } from "./keypad";

describe("the on-screen keypad", () => {
  it("types digits and a single dot", () => {
    let v = "";
    for (const k of ["6", "1", ".", "5", "5"] as const) v = applyKey(v, k);
    expect(v).toBe("61.55");
    expect(applyKey("61.5", ".")).toBe("61.5");
  });
  it("starts a decimal from nothing as 0.", () => {
    expect(applyKey("", ".")).toBe("0.");
    expect(applyKey("0.", "5")).toBe("0.5");
  });
  it("does not pile up leading zeros", () => {
    expect(applyKey("0", "5")).toBe("5");
    expect(applyKey("", "00")).toBe("0");
    expect(applyKey("0", "00")).toBe("0");
  });
  it("00 adds two zeros to a price", () => {
    expect(applyKey("108", "00")).toBe("10800");
    expect(applyKey("1", "00")).toBe("100");
  });
  it("backspace removes one character and is safe on empty", () => {
    expect(applyKey("61.55", "back")).toBe("61.5");
    expect(applyKey("", "back")).toBe("");
  });
  it("stops at a sensible length", () => {
    expect(applyKey("123456789012", "5")).toBe("123456789012");
  });
});

describe("Next", () => {
  const ids = ["a", "b"];
  it("walks top, down, price, then the next item", () => {
    expect(nextField(ids, { id: "a", field: "top" })).toEqual({
      id: "a",
      field: "down",
    });
    expect(nextField(ids, { id: "a", field: "down" })).toEqual({
      id: "a",
      field: "price",
    });
    expect(nextField(ids, { id: "a", field: "price" })).toEqual({
      id: "b",
      field: "top",
    });
  });
  it("finishes after the last price", () => {
    expect(nextField(ids, { id: "b", field: "price" })).toBeNull();
  });
});
