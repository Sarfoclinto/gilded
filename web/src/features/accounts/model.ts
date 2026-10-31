import type { ClosedAccount, NotClosed } from "./api";

type Entry = ClosedAccount | NotClosed;

export const isClosed = (a: Entry): a is ClosedAccount => a.status === "closed";

/** Whole cedis when it is whole, otherwise two decimals. */
export const money = (n: number) =>
  `GHS ${n.toLocaleString("en-GH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
export const signed = (n: number) =>
  `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("en-GH", { maximumFractionDigits: 2 })}`;

/** yyyy-MM-dd moved by whole days, without time zones getting in the way. */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const longDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
export const shortDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

function mergeRows(
  lists: { denomination: number; count: number; value: number }[][],
) {
  const by = new Map<
    number,
    { denomination: number; count: number; value: number }
  >();
  for (const row of lists.flat()) {
    const cur = by.get(row.denomination) ?? {
      denomination: row.denomination,
      count: 0,
      value: 0,
    };
    cur.count += row.count;
    cur.value += row.value;
    by.set(row.denomination, cur);
  }
  return [...by.values()].sort((a, b) => b.denomination - a.denomination);
}

/**
 * Several branches added together as one account. Debtors keep the branch they belong to; the days of goods are added by date.
 * The closing balance is the sum, and the change is only given when every branch has a previous day to compare with.
 */
export function combine(accounts: ClosedAccount[]): ClosedAccount | null {
  if (accounts.length === 0) return null;
  if (accounts.length === 1) return accounts[0]!;
  const sum = (f: (a: ClosedAccount) => number) =>
    accounts.reduce((s, a) => s + f(a), 0);
  const days = new Map<string, number>();
  for (const a of accounts)
    for (const g of a.goods.days)
      days.set(g.date, (days.get(g.date) ?? 0) + g.value);
  const allPrev = accounts.every((a) => a.previous);
  const first = accounts[0]!;
  return {
    ...first,
    branchId: "all",
    name: "All branches",
    isMain: false,
    day: {
      ...first.day,
      id: "all",
      sessions: sum((a) => a.day.sessions),
      signoff: accounts.some((a) => a.day.signoff === "pending")
        ? "pending"
        : accounts.some((a) => a.day.signoff === "rejected")
          ? "rejected"
          : first.day.signoff,
    },
    debtors: accounts
      .flatMap((a) => a.debtors.map((d) => ({ ...d, branch: a.name })))
      .sort((x, y) => y.amount - x.amount),
    debtTotal: sum((a) => a.debtTotal),
    debtUnlisted: sum((a) => a.debtUnlisted),
    cash: {
      bundles: mergeRows(accounts.map((a) => a.cash.bundles)),
      bundlesTotal: sum((a) => a.cash.bundlesTotal),
      loose: mergeRows(accounts.map((a) => a.cash.loose)),
      looseTotal: sum((a) => a.cash.looseTotal),
      total: sum((a) => a.cash.total),
    },
    goods: {
      total: sum((a) => a.goods.total),
      days: [...days.entries()]
        .map(([date, value]) => ({ date, value }))
        .sort((a, b) => b.date.localeCompare(a.date)),
      broughtForward: sum((a) => a.goods.broughtForward),
      lastSentOn: null,
      sent: accounts
        .flatMap((a) =>
          a.goods.sent.map((s) => ({ ...s, to: `${a.name} → ${s.to ?? ""}` })),
        )
        .sort((x, y) => y.date.localeCompare(x.date)),
    },
    owedToCustomers: sum((a) => a.owedToCustomers),
    allowance: {
      paid: sum((a) => a.allowance.paid),
      people: sum((a) => a.allowance.people),
    },
    closing: sum((a) => a.closing),
    previous: allPrev
      ? {
          date: accounts[0]!.previous!.date,
          closing: sum((a) => a.previous!.closing),
        }
      : null,
    change: allPrev ? sum((a) => a.change ?? 0) : null,
  };
}

/** What the sheet adds up: cash + debts + goods, less what is owed to customers. Used to check the server's figure on screen. */
export const closingFrom = (
  a: Pick<ClosedAccount, "cash" | "debtTotal" | "goods" | "owedToCustomers">,
) => a.cash.total + a.debtTotal + a.goods.total - a.owedToCustomers;
