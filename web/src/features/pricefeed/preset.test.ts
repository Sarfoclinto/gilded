import { describe, expect, it } from "vitest";
import { PRESETS, sameWindows, windowProblems } from "./presets";

describe("check times", () => {
  it("every ready-made set is valid", () => {
    for (const p of PRESETS) expect(windowProblems(p.windows)).toEqual([]);
  });
  it("explains what is wrong", () => {
    expect(windowProblems([])).toHaveLength(1);
    expect(
      windowProblems([{ start: "11:00", end: "10:00", everyMinutes: 5 }])[0],
    ).toContain("end must be after");
    expect(
      windowProblems([{ start: "10:00", end: "11:00", everyMinutes: 0 }])[0],
    ).toContain("every 1 to 120");
    expect(
      windowProblems([
        { start: "10:00", end: "11:00", everyMinutes: 5 },
        { start: "10:30", end: "12:00", everyMinutes: 5 },
      ]),
    ).toContain("Two check times overlap. Join them into one.");
  });
  it("recognises a preset", () => {
    expect(sameWindows(PRESETS[0]!.windows, [...PRESETS[0]!.windows])).toBe(
      true,
    );
    expect(sameWindows(PRESETS[0]!.windows, PRESETS[1]!.windows)).toBe(false);
  });
});
