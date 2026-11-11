import { describe, expect, it } from "vitest";
import {
  checkFigures,
  closingProblems,
  closingProgress,
  figureState,
  sameNumber,
  validFigure,
  type Declared,
  type FigureCheck,
} from "./closing";
import type { ClosingPreview } from "./schemas";

const preview: ClosingPreview = {
  dayId: "d",
  branchId: "b",
  expected: {
    cash: { lines: { "100": 10, "50": 2 }, value: "1100" },
    goodsTop: "120.5",
    goodsDown: "118",
    goodsValue: "9000",
    debt: "300",
    payable: "0",
    custodyTop: "0",
  },
  pendingPayments: 0,
  confirmation: { version: "v3", text: "x" },
  asOf: "t",
};
const same: Declared = {
  cash: { "100": 10, "50": 2 },
  goodsTop: "120.50",
  goodsDown: "118",
  goodsValue: "9000.00",
  debt: "300",
  payable: "0",
  custodyTop: "0",
};

describe("closing checks", () => {
  it("compares numbers by value, not by spelling", () => {
    expect(sameNumber("7.7", "7.70", 4)).toBe(true);
    expect(sameNumber("7.7", "7.71", 4)).toBe(false);
    expect(sameNumber("abc", "1", 2)).toBe(false);
  });
  it("needs nothing when everything matches", () => {
    const checks = checkFigures(preview, same);
    expect(checks.every((c) => !c.needsReason && !c.invalid)).toBe(true);
    expect(closingProblems(checks, {}, true)).toEqual([]);
  });
  it("asks for a reason only for the figures that differ", () => {
    const checks = checkFigures(preview, {
      ...same,
      goodsTop: "119",
      debt: "250",
    });
    expect(checks.filter((c) => c.needsReason).map((c) => c.figure)).toEqual([
      "goods_top",
      "debt",
    ]);
    expect(
      closingProblems(checks, { goods_top: "weighed again" }, true),
    ).toHaveLength(1);
    expect(
      closingProblems(
        checks,
        { goods_top: "weighed again", debt: "paid by phone" },
        true,
      ),
    ).toEqual([]);
  });
  it("treats a different mix of notes of the same value as needing a reason, without a value difference", () => {
    const c = checkFigures(preview, { ...same, cash: { "100": 11 } })[0]!;
    expect(c.needsReason).toBe(true);
    expect(c.valueDiffers).toBe(false);
  });
  it("wants the confirmation ticked and readable numbers", () => {
    expect(
      closingProblems(checkFigures(preview, same), {}, false),
    ).toHaveLength(1);
    expect(checkFigures(preview, { ...same, debt: "" })[4]!.invalid).toBe(true);
    expect(validFigure("1.23456", "goods_top")).toBe(false);
    expect(validFigure("1.234", "debt")).toBe(false);
  });
});

describe("figure state and progress", () => {
  const base = {
    figure: "debt",
    expected: "100",
    declared: "100",
    difference: 0,
    needsReason: false,
    valueDiffers: false,
    invalid: false,
  } as FigureCheck;
  it("names each state", () => {
    expect(figureState(base, false)).toBe("empty");
    expect(figureState({ ...base, invalid: true }, true)).toBe("invalid");
    expect(figureState(base, true)).toBe("matches");
    expect(
      figureState(
        { ...base, valueDiffers: true, needsReason: true, difference: -5 },
        true,
      ),
    ).toBe("short");
    expect(
      figureState(
        { ...base, valueDiffers: true, needsReason: true, difference: 5 },
        true,
      ),
    ).toBe("over");
    expect(figureState({ ...base, needsReason: true }, true)).toBe("notes");
  });
  it("counts entered and differing figures", () => {
    const checks = [
      base,
      { ...base, figure: "payable", declared: "", needsReason: false },
      { ...base, figure: "goods_top", needsReason: true, valueDiffers: true },
    ] as FigureCheck[];
    expect(closingProgress(checks, false)).toEqual({
      entered: 2,
      total: 3,
      differ: 1,
    });
  });
});

describe("closing on a branch with the note rule off", () => {
  it("a different mix of notes with the same total needs no reason", () => {
    const mix: Declared = { ...same, cash: { "100": 11 } };
    expect(
      checkFigures(preview, mix).find((c) => c.figure === "cash")?.needsReason,
    ).toBe(true);
    expect(
      checkFigures(preview, mix, true).find((c) => c.figure === "cash")
        ?.needsReason,
    ).toBe(false);
  });
  it("a different total still needs a reason", () => {
    const less: Declared = { ...same, cash: { "100": 10 } };
    expect(
      checkFigures(preview, less, true).find((c) => c.figure === "cash")
        ?.needsReason,
    ).toBe(true);
  });
});
