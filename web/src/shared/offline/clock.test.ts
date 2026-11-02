import { describe, expect, it } from "vitest";
import { clockIsOff, describeSkew, skewOf } from "./clock";

const now = Date.parse("2026-11-02T12:00:00Z");
describe("device clock check", () => {
  it("reads the server time from the Date header", () => {
    expect(skewOf("Mon, 02 Nov 2026 12:10:00 GMT", now)).toBe(10 * 60_000);
    expect(skewOf(undefined, now)).toBeNull();
    expect(skewOf("nonsense", now)).toBeNull();
  });
  it("only complains past five minutes, either way", () => {
    expect(clockIsOff(4 * 60_000)).toBe(false);
    expect(clockIsOff(6 * 60_000)).toBe(true);
    expect(clockIsOff(-6 * 60_000)).toBe(true);
    expect(clockIsOff(null)).toBe(false);
  });
  it("says which way and by how much", () => {
    expect(describeSkew(-3 * 3_600_000)).toBe(
      "about 3 hours ahead of the server",
    );
    expect(describeSkew(20 * 60_000)).toBe(
      "about 20 minutes behind the server",
    );
    expect(describeSkew(3 * 86_400_000)).toBe("about 3 days behind the server");
  });
});
