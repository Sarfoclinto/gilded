import type { BranchOverview } from "./api";

export type Attention = {
  key: string;
  label: string;
  count: number;
  tone: "amber" | "red" | "sky";
  to?: string;
};

/** What needs somebody's eyes at a branch, most pressing first. Zero counts are left out. */
export function attentionItems(
  a: BranchOverview["attention"],
  overdueDebts: number,
): Attention[] {
  const plural = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;
  return [
    {
      key: "diff",
      label: plural(
        a.openDifferences,
        "difference to resolve",
        "differences to resolve",
      ),
      count: a.openDifferences,
      tone: "red" as const,
    },
    {
      key: "sign",
      label: plural(
        a.signoffPending,
        "closed day waiting for sign-off",
        "closed days waiting for sign-off",
      ),
      count: a.signoffPending,
      tone: "amber" as const,
    },
    {
      key: "debt",
      label: plural(overdueDebts, "overdue debt", "overdue debts"),
      count: overdueDebts,
      tone: "red" as const,
    },
    {
      key: "in",
      label: plural(
        a.transfersComing,
        "transfer on its way here",
        "transfers on their way here",
      ),
      count: a.transfersComing,
      tone: "sky" as const,
    },
    {
      key: "out",
      label: plural(
        a.transfersGoing,
        "transfer sent, not yet received",
        "transfers sent, not yet received",
      ),
      count: a.transfersGoing,
      tone: "sky" as const,
    },
    {
      key: "mm1",
      label: plural(
        a.moneyWaiting,
        "mobile payment waiting to be matched",
        "mobile payments waiting to be matched",
      ),
      count: a.moneyWaiting,
      tone: "amber" as const,
    },
    {
      key: "mm2",
      label: plural(
        a.moneyToSend,
        "mobile payment to send",
        "mobile payments to send",
      ),
      count: a.moneyToSend,
      tone: "amber" as const,
    },
  ].filter((i) => i.count > 0);
}

const ORDER = ["director", "manager", "teller", "kitchen-boy"];
/** Workers grouped by role, in a sensible order (the big roles first, others after, alphabetical). */
export function groupWorkers(workers: BranchOverview["workers"]) {
  const groups = new Map<
    string,
    { key: string; name: string; people: BranchOverview["workers"] }
  >();
  for (const w of workers) {
    const g = groups.get(w.role.key) ?? {
      key: w.role.key,
      name: w.role.name,
      people: [],
    };
    g.people.push(w);
    groups.set(w.role.key, g);
  }
  const rank = (k: string) =>
    ORDER.includes(k) ? ORDER.indexOf(k) : ORDER.length;
  return [...groups.values()].sort(
    (a, b) => rank(a.key) - rank(b.key) || a.name.localeCompare(b.name),
  );
}
