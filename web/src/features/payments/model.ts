import type { PendingPayment } from "./api";

export interface Wait {
  hours: number;
  tone: "ok" | "late" | "stale";
  text: string;
}

/** How long a mobile money part has been waiting. Under 1 day is fine, 1 day is late, 2 or more is stale. */
export function waitOf(createdAt: string, now: Date = new Date()): Wait {
  const hours = Math.max(
    0,
    (now.getTime() - new Date(createdAt).getTime()) / 3_600_000,
  );
  const text =
    hours < 1
      ? "Just now"
      : hours < 24
        ? `${Math.floor(hours)} hour${Math.floor(hours) === 1 ? "" : "s"}`
        : `${Math.floor(hours / 24)} day${Math.floor(hours / 24) === 1 ? "" : "s"}`;
  return {
    hours,
    tone: hours >= 48 ? "stale" : hours >= 24 ? "late" : "ok",
    text,
  };
}

export function summarize(list: PendingPayment[], now: Date = new Date()) {
  let total = 0;
  let late = 0;
  let oldest: string | null = null;
  for (const p of list) {
    total += Number(p.amount);
    if (waitOf(p.createdAt, now).tone !== "ok") late++;
    if (oldest === null || p.createdAt < oldest) oldest = p.createdAt;
  }
  return { count: list.length, total, late, oldest };
}

/** Oldest first, so the ones waiting longest are at the top. */
export const oldestFirst = (list: PendingPayment[]) =>
  [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

export function matches(p: PendingPayment, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return [
    p.customerName,
    p.reference ?? "",
    p.externalRef ?? "",
    p.purchaseBranchName,
    p.sendingBranchName,
  ].some((v) => v.toLowerCase().includes(t));
}
