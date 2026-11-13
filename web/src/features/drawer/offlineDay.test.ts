import { describe, expect, it } from "vitest";
import { clockBehind, mustQueue } from "./offlineDay";

describe("mustQueue", () => {
  it("sends straight away only when online, the day is known to the server and nothing is waiting", () => {
    expect(mustQueue({ local: false, pendingCount: 0 }, true)).toBe(false);
    expect(mustQueue({ local: false, pendingCount: 0 }, false)).toBe(true);
    expect(mustQueue({ local: true, pendingCount: 1 }, true)).toBe(true);
    expect(mustQueue({ local: false, pendingCount: 2 }, true)).toBe(true);
  });
});

describe("clockBehind", () => {
  it("catches a computer whose date is before the last day it knows", () => {
    expect(clockBehind("2026-11-10", "2026-11-12")).toBe(true);
    expect(clockBehind("2026-11-12", "2026-11-12")).toBe(false);
    expect(clockBehind("2026-11-13", "2026-11-12")).toBe(false);
    expect(clockBehind("2026-11-13", null)).toBe(false);
  });
});
