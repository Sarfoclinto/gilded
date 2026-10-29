import type { Collateral } from "./schemas";

export type HeldFilter = "held" | "converted" | "returned" | "all";

const dayNumber = (d: Date) =>
  Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);

/** Whole calendar days since the gold was received. */
export function heldDays(receivedAt: string, now: Date = new Date()): number {
  return Math.max(0, dayNumber(now) - dayNumber(new Date(receivedAt)));
}

export const heldText = (days: number) =>
  days === 0
    ? "Received today"
    : days === 1
      ? "Held since yesterday"
      : `Held for ${days} days`;

/** Gold can only go back to the customer once the loan it secures is fully paid. */
export const owedOn = (c: Pick<Collateral, "debtOutstanding">) =>
  Number(c.debtOutstanding ?? 0);
export const canHandBack = (
  c: Pick<Collateral, "status" | "debtOutstanding">,
) => c.status === "held" && owedOn(c) <= 0;

export function summarizeHeld(list: Collateral[], now: Date = new Date()) {
  let pieces = 0;
  let weight = 0;
  let owed = 0;
  let longest = 0;
  for (const c of list) {
    if (c.status !== "held") continue;
    pieces++;
    weight += Number(c.topWeight);
    owed += owedOn(c);
    longest = Math.max(longest, heldDays(c.receivedAt, now));
  }
  return { pieces, weight, owed, longest };
}

export function filterHeld(
  list: Collateral[],
  filter: HeldFilter,
  q: string,
): Collateral[] {
  const t = q.trim().toLowerCase();
  return list
    .filter((c) => filter === "all" || c.status === filter)
    .filter(
      (c) =>
        !t ||
        [c.customer.name, c.customer.phone ?? "", c.description ?? ""].some(
          (v) => v.toLowerCase().includes(t),
        ),
    )
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
}
