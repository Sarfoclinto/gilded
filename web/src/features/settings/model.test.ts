import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./api";
import {
  changes,
  dirtySections,
  SECTIONS,
  valueOf,
  wholeNumber,
} from "./model";

describe("settings model", () => {
  it("sends only what changed", () => {
    expect(
      changes(DEFAULT_SETTINGS, {
        "payout.twoStep": true,
        "payout.blindCheck": false,
      }),
    ).toEqual({ "payout.twoStep": true });
    expect(changes(DEFAULT_SETTINGS, {})).toEqual({});
  });
  it("shows the draft over what is saved", () => {
    expect(
      valueOf(
        DEFAULT_SETTINGS,
        { "allowance.perPerson": 150 },
        "allowance.perPerson",
      ),
    ).toBe(150);
    expect(valueOf(DEFAULT_SETTINGS, {}, "allowance.perPerson")).toBe(100);
  });
  it("knows which tabs hold unsaved changes", () => {
    expect(
      [
        ...dirtySections(DEFAULT_SETTINGS, {
          "receipt.phone": "024",
          "payout.twoStep": true,
        }),
      ].sort(),
    ).toEqual(["business", "payout"]);
  });
  it("reads whole numbers only, within a limit", () => {
    expect(wholeNumber("120", 10000)).toBe(120);
    expect(wholeNumber("12.5", 10000)).toBeNull();
    expect(wholeNumber("", 10000)).toBeNull();
    expect(wholeNumber("20000", 10000)).toBeNull();
  });
  it("lists every server setting exactly once, under one tab", () => {
    const keys = SECTIONS.flatMap((s) => s.fields.map((f) => f.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });
});
