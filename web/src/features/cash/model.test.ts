import { describe, expect, it } from "vitest";
import { grandTotal, noteRows, noteTotal, sinceText } from "./model";

const now = new Date("2026-10-29T12:00:00Z");
const ago = (mins: number) =>
  new Date(now.getTime() - mins * 60_000).toISOString();

describe("cash model", () => {
  it("says how long ago", () => {
    expect(sinceText(ago(0.2), now)).toBe("just now");
    expect(sinceText(ago(1), now)).toBe("1 minute ago");
    expect(sinceText(ago(45), now)).toBe("45 minutes ago");
    expect(sinceText(ago(120), now)).toBe("2 hours ago");
    expect(sinceText(ago(60 * 49), now)).toBe("2 days ago");
  });
  it("totals branches", () => {
    expect(grandTotal([{ cashValue: "600" }, { cashValue: "1250.5" }])).toBe(
      1850.5,
    );
  });
  it("lists notes biggest first and skips empty ones", () => {
    expect(noteRows({ "100": 5, "200": 2, "50": 0 })).toEqual([
      { denomination: 200, count: 2, value: 400 },
      { denomination: 100, count: 5, value: 500 },
    ]);
    expect(noteTotal({ "100": 5, "200": 2 })).toBe(7);
  });
});
