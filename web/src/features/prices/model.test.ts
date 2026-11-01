import { describe, expect, it } from "vitest";
import {
  effectiveWith,
  priceAge,
  pendingBranches,
  priceChange,
  staleDays,
  updatedText,
  validMargin,
  validPrice,
} from "./model";
import type { CurrentPrice } from "./api";

const p = (status: "approved" | "provisional"): CurrentPrice => ({
  branchId: "b",
  basePrice: "100",
  margin: "1",
  effectivePrice: "101",
  source: "manual",
  status,
  asOf: "",
});

describe("prices model", () => {
  it("validates", () => {
    expect(validPrice("12345.50")).toBe(true);
    expect(validPrice("0")).toBe(false);
    expect(validPrice("12.345")).toBe(false);
    expect(validMargin("0")).toBe(true);
    expect(validMargin("")).toBe(false);
  });
  it("rates a price change", () => {
    expect(priceChange("1000", "1020")).toMatchObject({ level: "note" });
    expect(priceChange("1000", "1000")).toMatchObject({ level: "same" });
    expect(priceChange("1000", "900")).toMatchObject({ level: "warn" });
    expect(priceChange("1000", "1050")?.pct).toBeCloseTo(5);
    expect(priceChange(null, "1000")).toBeNull();
    expect(priceChange("1000", "abc")).toBeNull();
  });
  it("adds the margin", () => {
    expect(effectiveWith("1000", "12.5")).toBe("1012.50");
    expect(effectiveWith("1000", "")).toBeNull();
  });
  it("finds waiting approvals and age", () => {
    expect(
      pendingBranches([p("approved"), p("provisional"), null]),
    ).toHaveLength(1);
    const now = new Date(2026, 9, 29, 12);
    expect(staleDays(new Date(2026, 9, 27, 9).toISOString(), now)).toBe(2);
    expect(updatedText(0)).toBe("Updated today");
    expect(updatedText(1)).toBe("Updated yesterday");
    expect(updatedText(3)).toBe("Updated 3 days ago");
  });
});

describe("priceAge", () => {
  const now = new Date("2026-11-02T10:00:00");
  it("is fine for a price set a few hours ago", () => {
    const a = priceAge("2026-11-02T07:00:00", now);
    expect(a?.stale).toBe(false);
    expect(a?.text).toMatch(/^today at/);
  });
  it("questions a price older than 12 hours", () => {
    const a = priceAge("2026-11-01T15:00:00", now);
    expect(a?.stale).toBe(true);
    expect(a?.text).toMatch(/^yesterday at/);
    expect(priceAge("2026-10-28T09:00:00", now)?.text).toBe("5 days ago");
  });
  it("has nothing to say about an unusable time", () => {
    expect(priceAge(null, now)).toBeNull();
    expect(priceAge("nonsense", now)).toBeNull();
  });
});
