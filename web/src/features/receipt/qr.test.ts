import { describe, expect, it } from "vitest";
import { qrMatrix, qrPath, receiptPayload } from "./qr";

describe("receipt qr", () => {
  it("names the purchase and its number", () => {
    expect(receiptPayload({ id: "abc", reference: "GB-0012" })).toBe(
      "gilded:tx:abc:GB-0012",
    );
    expect(receiptPayload({ id: "abc", reference: null })).toBe(
      "gilded:tx:abc",
    );
  });
  it("makes a square code with a drawable path", () => {
    const m = qrMatrix("gilded:tx:abc:GB-0012");
    expect(m.dark).toHaveLength(m.size * m.size);
    expect(m.size).toBeGreaterThanOrEqual(21);
    expect(qrPath(m)).toMatch(/^M\d+ \d+h\d+v1h-\d+z/);
  });
});
