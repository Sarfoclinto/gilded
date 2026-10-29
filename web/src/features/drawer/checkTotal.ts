/** The optional "total I was expecting" box next to a note count: nothing typed says nothing; a difference is shown, never enforced. */
export type TotalCheck =
  | { kind: "none" }
  | { kind: "match" }
  | { kind: "differs"; difference: number };

export function checkTotal(typed: string, counted: number): TotalCheck {
  const cleaned = typed.replace(/[,\s]/g, "").replace(/^GHS/i, "");
  if (cleaned === "" || !/^\d+(\.\d+)?$/.test(cleaned)) return { kind: "none" };
  const diff = Math.round((counted - Number(cleaned)) * 100) / 100;
  return diff === 0 ? { kind: "match" } : { kind: "differs", difference: diff };
}
