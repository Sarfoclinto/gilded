import { describe, expect, it } from "vitest";
import { ageLabel, clampDays } from "./policy";

describe("ageLabel", () => {
  const now = 1_000_000_000_000;
  it("speaks in minutes, hours, days", () => {
    expect(ageLabel(now - 10_000, now)).toBe("just now");
    expect(ageLabel(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(ageLabel(now - 3 * 3_600_000, now)).toBe("3 h ago");
    expect(ageLabel(now - 72 * 3_600_000, now)).toBe("3 days ago");
  });

  it("keeps the allowance between 1 and 30 days", () => {
    expect(clampDays(7)).toBe(7);
    expect(clampDays(0)).toBe(1);
    expect(clampDays(400)).toBe(30);
    expect(clampDays("x")).toBe(7);
    expect(clampDays(2.6)).toBe(3);
  });
});
