import { lineTotal, type Lines } from "@gold/core";
import { cedis } from "@/features/calculator/format";

/** "GHS 100 × 40, GHS 50 × 3" */
export const linesText = (l: Lines) =>
  Object.entries(l)
    .filter(([, n]) => n !== 0)
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([d, n]) => `${d} × ${n}`)
    .join(", ") || "none";

export const signed = (n: number) =>
  `${n > 0 ? "+" : n < 0 ? "−" : ""}${cedis(Math.abs(n))}`;
export const total = (l: Lines) => cedis(lineTotal(l));

export const dayFlagText: Record<string, string> = {
  OFFLINE_ENTRY: "Opened while offline",
  OPENING_DIFFERS: "Opening count differed from the books",
  CLOSING_DIFFERS: "Closing differed from the books",
};

export const signoffText = {
  not_required: "Matched",
  pending: "Waiting for sign-off",
  approved: "Approved",
  rejected: "Rejected",
} as const;
