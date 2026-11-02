import { describe, expect, it } from "vitest";
import { DEFAULT_PERSONAL, opensReceipt } from "./personal";

describe("opening the receipt after saving", () => {
  it("follows the company by default", () => {
    expect(opensReceipt("company", true)).toBe(true);
    expect(opensReceipt("company", false)).toBe(false);
  });
  it("lets a person choose either way for their desk", () => {
    expect(opensReceipt("always", false)).toBe(true);
    expect(opensReceipt("never", true)).toBe(false);
  });
});

describe("personal defaults for new purchases", () => {
  it("start as before: open the purchase after saving, prefer 100s", () => {
    expect(DEFAULT_PERSONAL.afterSave).toBe("detail");
    expect(DEFAULT_PERSONAL.noteStrategy).toBe("prefer-100s");
    expect(DEFAULT_PERSONAL.notifySound).toBe(true);
    expect(DEFAULT_PERSONAL.purchaseLayout).toBe("classic");
    expect(DEFAULT_PERSONAL.keypad).toBe(true);
  });
});
