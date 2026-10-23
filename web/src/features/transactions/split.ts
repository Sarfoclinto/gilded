import type { SplitMethod, SplitPart } from "./schemas";

/** A non-cash part of the payment while it is being typed. Cash is never entered: it is whatever is left of the payable. */
export interface SplitDraft {
  key: string;
  method: SplitMethod;
  amount: string;
  paidByBranchId: string;
  externalRef: string;
  debtId: string;
  dueDate: string;
  note: string;
}

export const newSplit = (
  method: SplitMethod,
  init: Partial<SplitDraft> = {},
): SplitDraft => ({
  key: crypto.randomUUID(),
  method,
  amount: "",
  paidByBranchId: "",
  externalRef: "",
  debtId: "",
  dueDate: "",
  note: "",
  ...init,
});

const whole = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v) : 0);

export const nonCashTotal = (parts: SplitDraft[]) =>
  parts.reduce((s, p) => s + whole(p.amount), 0);

export interface SplitContext {
  payable: number;
  /** An existing customer was picked from the list. */
  customerPicked: boolean;
  /** Name and phone are both filled in (enough to create a customer for an owed amount). */
  customerReady: boolean;
  /** Outstanding amount per open debt of the picked customer, by debt id. */
  outstanding: Record<string, number>;
}

/** Everything that stops the split from being saved, in plain words. The server checks the same things again. */
export function splitProblems(
  parts: SplitDraft[],
  ctx: SplitContext,
): string[] {
  const out: string[] = [];
  const total = nonCashTotal(parts);
  const used = new Map<string, number>();
  parts.forEach((p, i) => {
    const n = i + 1;
    const amount = whole(p.amount);
    const label = `Part ${n}`;
    if (amount <= 0) out.push(`${label}: enter a whole amount above zero.`);
    if (p.method === "mobile_money" && !p.paidByBranchId)
      out.push(`${label}: choose the branch that sends the mobile money.`);
    if (p.method === "owed" && !ctx.customerReady)
      out.push(`${label}: owing a customer needs their name and phone number.`);
    if (p.method === "debt_offset") {
      if (!ctx.customerPicked)
        out.push(
          `${label}: pick the customer from the list to settle their debt.`,
        );
      else if (!p.debtId)
        out.push(`${label}: choose which debt the gold settles.`);
      else used.set(p.debtId, (used.get(p.debtId) ?? 0) + amount);
    }
  });
  for (const [debtId, sum] of used) {
    const left = ctx.outstanding[debtId];
    if (left !== undefined && sum > left)
      out.push(`The gold settles more than the customer owes (${left}).`);
  }
  if (total > ctx.payable)
    out.push("The non-cash parts are more than the amount to pay.");
  return out;
}

export function toSplitParts(parts: SplitDraft[]): SplitPart[] {
  return parts.map((p) => ({
    method: p.method,
    amount: String(whole(p.amount)),
    ...(p.method === "mobile_money"
      ? {
          paidByBranchId: p.paidByBranchId,
          externalRef: p.externalRef.trim() || null,
        }
      : {}),
    ...(p.method === "debt_offset" ? { debtId: p.debtId } : {}),
    ...(p.method === "owed" ? { dueDate: p.dueDate || null } : {}),
    note: p.note.trim() || null,
  }));
}
