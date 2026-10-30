import { DENOMINATIONS, type Lines } from "@gold/core";
import type { BranchCash } from "./api";

/** "just now", "5 minutes ago", "2 hours ago", or the date for anything older than a day. */
export function sinceText(iso: string, now: Date = new Date()): string {
  const mins = Math.max(
    0,
    Math.round((now.getTime() - new Date(iso).getTime()) / 60_000),
  );
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Clock time for a moment, in the person's own time zone: "21:05". */
export const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

export const grandTotal = (branches: Pick<BranchCash, "cashValue">[]) =>
  branches.reduce((s, b) => s + Number(b.cashValue), 0);

/** The denominations a branch holds, biggest first, with how much each is worth. Zero rows are left out. */
export function noteRows(
  lines: Lines,
): { denomination: number; count: number; value: number }[] {
  return [...DENOMINATIONS]
    .sort((a, b) => b - a)
    .map((d) => ({
      denomination: d,
      count: lines[`${d}`] ?? 0,
      value: (lines[`${d}`] ?? 0) * d,
    }))
    .filter((r) => r.count !== 0);
}

export const noteTotal = (lines: Lines) =>
  noteRows(lines).reduce((s, r) => s + r.count, 0);
