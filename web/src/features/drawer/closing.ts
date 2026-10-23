import { lineTotal, subtractLines, type Lines } from "@gold/core";
import type { ClosingPreview, Figure } from "./schemas";
import { FIGURES } from "./schemas";

/**
 * The closing rules the server enforces, worked out on the device first so the screen can show what needs an explanation
 * before anything is sent. The server decides in the end; these must agree with it.
 */
export interface Declared {
  cash: Lines;
  goodsTop: string;
  goodsDown: string;
  goodsValue: string;
  debt: string;
  payable: string;
  custodyTop: string;
}

export const figureLabel: Record<Figure, string> = {
  cash: "Cash in the drawer",
  goods_top: "Total top weight",
  goods_down: "Total down weight",
  goods_value: "Value of goods",
  debt: "Debts owed to the branch",
  payable: "Amounts the branch owes",
  custody_top: "Unrefined gold held as security",
};

export const figureUnit: Record<Figure, "g" | "GHS" | "notes"> = {
  cash: "notes",
  goods_top: "g",
  goods_down: "g",
  goods_value: "GHS",
  debt: "GHS",
  payable: "GHS",
  custody_top: "g",
};

/** Weights go to 4 decimals and money to 2, exactly like the database. Compared as whole units so 7.7 equals 7.70. */
const scaled = (text: string, dp: number): number | null => {
  const t = text.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Math.round(Number(t) * 10 ** dp);
};

const decimals = (f: Figure) => (figureUnit[f] === "g" ? 4 : 2);

export function sameNumber(a: string, b: string, dp: number): boolean {
  const x = scaled(a, dp);
  const y = scaled(b, dp);
  return x !== null && y !== null && x === y;
}

/** True when the text is a number the server will accept (zero or more, within the allowed decimals). */
export function validFigure(text: string, f: Figure): boolean {
  const t = text.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return false;
  const dp = decimals(f);
  return (
    Math.abs(Number(t) * 10 ** dp - Math.round(Number(t) * 10 ** dp)) < 1e-6
  );
}

export function expectedText(preview: ClosingPreview, f: Figure): string {
  const e = preview.expected;
  switch (f) {
    case "cash":
      return e.cash.value;
    case "goods_top":
      return e.goodsTop;
    case "goods_down":
      return e.goodsDown;
    case "goods_value":
      return e.goodsValue;
    case "debt":
      return e.debt;
    case "payable":
      return e.payable;
    case "custody_top":
      return e.custodyTop;
  }
}

export function declaredText(d: Declared, f: Figure): string {
  switch (f) {
    case "cash":
      return String(lineTotal(d.cash));
    case "goods_top":
      return d.goodsTop;
    case "goods_down":
      return d.goodsDown;
    case "goods_value":
      return d.goodsValue;
    case "debt":
      return d.debt;
    case "payable":
      return d.payable;
    case "custody_top":
      return d.custodyTop;
  }
}

export interface FigureCheck {
  figure: Figure;
  expected: string;
  declared: string;
  /** declared minus expected, as a number (for display only). */
  difference: number;
  /** Needs a written reason before the day can be closed. */
  needsReason: boolean;
  /** The value differs (a case is opened for review). A different mix of notes of the same value does not count here. */
  valueDiffers: boolean;
  /** The person typed something we cannot read. */
  invalid: boolean;
}

export function checkFigures(
  preview: ClosingPreview,
  d: Declared,
): FigureCheck[] {
  const noteDifference =
    Object.keys(subtractLines(d.cash, preview.expected.cash.lines)).length > 0;
  return FIGURES.map((figure) => {
    const expected = expectedText(preview, figure);
    const declared = declaredText(d, figure);
    const dp = decimals(figure);
    const invalid = figure !== "cash" && !validFigure(declared, figure);
    const valueDiffers = !invalid && !sameNumber(declared, expected, dp);
    return {
      figure,
      expected,
      declared,
      difference: invalid ? 0 : Number(declared) - Number(expected),
      needsReason: figure === "cash" ? noteDifference : valueDiffers,
      valueDiffers,
      invalid,
    };
  });
}

export const MIN_REASON = 5;

/** What stops the day from being closed: unreadable figures, a missing reason, or the confirmation not ticked. */
export function closingProblems(
  checks: FigureCheck[],
  explanations: Partial<Record<Figure, string>>,
  confirmed: boolean,
): string[] {
  const out: string[] = [];
  for (const c of checks) {
    if (c.invalid)
      out.push(`${figureLabel[c.figure]}: enter a number (zero if none).`);
    else if (
      c.needsReason &&
      (explanations[c.figure]?.trim().length ?? 0) < MIN_REASON
    )
      out.push(`${figureLabel[c.figure]}: write why it differs.`);
  }
  if (!confirmed)
    out.push("Tick the confirmation that you physically verified everything.");
  return out;
}
