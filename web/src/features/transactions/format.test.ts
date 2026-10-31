import { describe, expect, it } from "vitest";
import { recently } from "./format";

describe("recently", () => {
  const now = new Date(2026, 9, 31, 12, 0, 0);
  const at = (mins: number) =>
    new Date(now.getTime() - mins * 60_000).toISOString();
  it("counts minutes then hours", () => {
    expect(recently(at(0), now)).toBe("just now");
    expect(recently(at(5), now)).toBe("5 min ago");
    expect(recently(at(125), now)).toBe("2 h ago");
  });
  it("gives the time after a few hours", () => {
    expect(recently(at(400), now)).toMatch(/\d/);
  });
});
