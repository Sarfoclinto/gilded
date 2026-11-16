import type { Debt } from "./schemas";

export interface Due {
  state: "none" | "ok" | "soon" | "overdue";
  days: number;
  text: string;
}

const dayNumber = (isoDate: string) =>
  Math.floor(Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`) / 86_400_000);
const todayNumber = (now: Date) =>
  Math.floor(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000,
  );

/** Where an open debt stands against its pay-back date. Settled debts and debts with no date have none. */
export function dueOf(
  d: Pick<Debt, "status" | "dueDate">,
  now: Date = new Date(),
): Due {
  if (d.status !== "open" || !d.dueDate)
    return { state: "none", days: 0, text: "" };
  const days = dayNumber(d.dueDate) - todayNumber(now);
  if (days < 0)
    return {
      state: "overdue",
      days,
      text: `Overdue by ${-days} day${days === -1 ? "" : "s"}`,
    };
  if (days === 0) return { state: "soon", days, text: "Due today" };
  if (days <= 3)
    return {
      state: "soon",
      days,
      text: `Due in ${days} day${days === 1 ? "" : "s"}`,
    };
  return { state: "ok", days, text: `Due ${d.dueDate}` };
}

/** Share of the amount already paid back, 0 to 1. */
export function repaidShare(d: Pick<Debt, "principal" | "repaid">): number {
  const p = Number(d.principal);
  return p > 0 ? Math.min(1, Math.max(0, Number(d.repaid) / p)) : 0;
}

export function summarize(list: Debt[], now: Date = new Date()) {
  let total = 0;
  let overdue = 0;
  let held = 0;
  let open = 0;
  for (const d of list) {
    if (d.status !== "open") continue;
    open++;
    total += Number(d.outstanding);
    if (dueOf(d, now).state === "overdue") overdue++;
    if (d.collateral?.status === "held") held++;
  }
  return { open, total, overdue, held };
}

export function matches(d: Debt, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return [d.party.name, d.party.phone ?? "", d.reason ?? ""].some((v) =>
    v.toLowerCase().includes(t),
  );
}

/** Overdue first, then the biggest amount still owing. */
export function byUrgency(list: Debt[], now: Date = new Date()): Debt[] {
  const rank = (d: Debt) => (dueOf(d, now).state === "overdue" ? 0 : 1);
  return [...list].sort(
    (a, b) =>
      rank(a) - rank(b) || Number(b.outstanding) - Number(a.outstanding),
  );
}

/** A pay-back date `days` from today as YYYY-MM-DD (local), for the quick buttons. */
export function dateInDays(days: number, now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** What a customer already owes, as the loan page shows it. */
export interface CustomerDebtsSummary {
  items: (Debt & { branchName?: string })[];
  total: string;
  elsewhere: number;
}

/** The one-line headline for the loan page: "Kofi owes GHS 1,500 on 2 loans, 1 overdue". */
export function owesHeadline(
  name: string,
  s: CustomerDebtsSummary,
  fmt: (n: number) => string,
  now: Date = new Date(),
): string {
  if (!s.items.length)
    return s.elsewhere
      ? `${name} has no open loans at your branches.`
      : `${name} owes nothing.`;
  const overdue = s.items.filter(
    (d) => dueOf(d, now).state === "overdue",
  ).length;
  return `${name} already owes ${fmt(Number(s.total))} on ${s.items.length} loan${s.items.length === 1 ? "" : "s"}${overdue ? `, ${overdue} overdue` : ""}.`;
}
