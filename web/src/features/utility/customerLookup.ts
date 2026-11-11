import type { LookupCustomer } from "./store";

/** What to ask the server about this customer. */
export type LookupPlan =
  | { mode: "none" }
  | { mode: "picked"; customerId: string; label: string }
  /** Typed but not picked: search by phone when it is long enough to be one, else by name. */
  | { mode: "typed"; q: string; label: string };

export function planLookup(c: LookupCustomer | null): LookupPlan {
  if (!c) return { mode: "none" };
  const name = c.name.trim();
  const phone = c.phone.trim();
  const digits = phone.replace(/\D/g, "");
  if (c.id) return { mode: "picked", customerId: c.id, label: name || phone };
  if (digits.length >= 6) return { mode: "typed", q: phone, label: phone };
  if (name.length >= 2) return { mode: "typed", q: name, label: name };
  return { mode: "none" };
}

/** Sum of a decimal string list, to two places, as text ("12.50"). */
export function sumWeights(values: string[]): string {
  return values.reduce((s, v) => s + (Number(v) || 0), 0).toFixed(2);
}
