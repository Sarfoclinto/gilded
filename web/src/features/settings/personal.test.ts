import { describe, expect, it } from "vitest";
import { opensReceipt } from "./personal";

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
