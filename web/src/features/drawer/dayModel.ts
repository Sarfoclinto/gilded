import { addLines, lineTotal, type Lines } from "@gold/core";
import type { Day, Figure, Movement } from "./schemas";

export type DayFilter = "all" | "pending" | "differences";

/** Figures that did not match the books at closing. */
export const differingFigures = (d: Day) =>
  d.closing?.figures.filter((f) => f.outcome !== "balanced") ?? [];

export interface HistorySummary {
  days: number;
  waiting: number;
  withDifferences: number;
  /** Net of all cash differences (counted minus books), in cedis. */
  cashNet: number;
}

export function summarizeDays(days: Day[]): HistorySummary {
  let waiting = 0;
  let withDifferences = 0;
  let cashNet = 0;
  for (const d of days) {
    if (d.closing?.signoff.status === "pending") waiting++;
    if (differingFigures(d).length) withDifferences++;
    const cash = d.closing?.figures.find((f) => f.asset === ("cash" as Figure));
    if (cash) cashNet += Number(cash.difference);
  }
  return { days: days.length, waiting, withDifferences, cashNet };
}

export function filterDays(days: Day[], filter: DayFilter): Day[] {
  if (filter === "pending")
    return days.filter((d) => d.closing?.signoff.status === "pending");
  if (filter === "differences")
    return days.filter((d) => differingFigures(d).length > 0);
  return days;
}

/** Where the drawer's money went today: opening, cash in, cash out, and everything else (purchases, transfers). */
export function drawerFlow(
  opening: Lines | null,
  movements: Movement[],
  balance: Lines | null,
) {
  let inLines: Lines = {};
  let outLines: Lines = {};
  for (const m of movements) {
    if (m.kind === "topup") inLines = addLines(inLines, m.lines);
    else outLines = addLines(outLines, m.lines);
  }
  const opened = opening ? lineTotal(opening) : 0;
  const cashIn = lineTotal(inLines);
  const cashOut = lineTotal(outLines);
  const now = balance ? lineTotal(balance) : opened + cashIn - cashOut;
  return {
    opened,
    cashIn,
    cashOut,
    other: now - (opened + cashIn - cashOut),
    now,
  };
}
