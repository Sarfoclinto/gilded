import paths from "@/config/paths";
import { cedis } from "@/features/calculator/format";
import type { Customer } from "@/features/customers/api";
import { when } from "@/features/transactions/format";
import type { Transaction } from "@/features/transactions/schemas";
import {
  asAmount,
  asPhone,
  fold,
  hasWords,
  phoneKey,
  tidy,
  wordsOf,
} from "./match";
import { buyFor, type Abilities, type Row } from "./rows";

/**
 * Searching what this device holds, for when there is no connection: the customers of this branch (the same copy the customer
 * picker uses) and the branch's recent purchases. Same rules as the server, on less: it cannot know what the device never received.
 */
export interface LocalSection {
  key: "customers" | "purchases";
  total: number;
  rows: Row[];
}

const join = (...parts: (string | null | undefined | false)[]) =>
  parts.filter(Boolean).join(" · ");

export function searchDevice(
  q: string,
  have: { people: Customer[]; purchases: Transaction[] },
  can: Abilities,
  limit = 5,
): LocalSection[] {
  const query = tidy(q);
  if (query.length < 2) return [];
  const words = wordsOf(q);
  const pk = asPhone(q);
  const amount = asAmount(q);
  const out: LocalSection[] = [];

  const people = have.people
    .map((c) => {
      const name = fold(c.name);
      let s = 0;
      if (name === query) s = 100;
      else if (name.startsWith(query)) s = 90;
      else if (hasWords(`${c.name} ${c.phone ?? ""}`, words)) s = 70;
      if (pk) {
        const k = phoneKey(c.phone);
        if (k && k === pk) s = Math.max(s, 96);
        else if (k.includes(pk)) s = Math.max(s, 75);
      }
      return { c, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.c.name.localeCompare(b.c.name));
  // The same person can be in the list twice (made on this device and received from the server).
  const seen = new Set<string>();
  const uniquePeople = people.filter((x) =>
    seen.has(x.c.id) ? false : (seen.add(x.c.id), true),
  );
  if (uniquePeople.length > 0) {
    out.push({
      key: "customers",
      total: uniquePeople.length,
      rows: uniquePeople.slice(0, limit).map(({ c }) => {
        const buy = can.buy ? buyFor(c) : undefined;
        return {
          key: `customers:${c.id}`,
          group: "customers",
          title: c.name,
          subtitle: c.phone ?? "No phone number",
          chips: [],
          // A customer's page needs a connection; a purchase for them does not.
          href: buy?.href ?? paths.people.customer.to(c.id),
          state: buy?.state,
        };
      }),
    });
  }

  const purchases = have.purchases
    .map((t) => {
      const text = `${t.customerName} ${t.reference} ${t.customerPhone ?? ""}`;
      let s = 0;
      if (fold(t.reference) === query) s = 100;
      else if (fold(t.reference).includes(query)) s = 88;
      else if (hasWords(text, words)) s = 70;
      if (pk && phoneKey(t.customerPhone).includes(pk)) s = Math.max(s, 75);
      if (amount !== null && Number(t.payout.payable) === amount)
        s = Math.max(s, 80);
      return { t, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.t.capturedAt.localeCompare(a.t.capturedAt));
  if (purchases.length > 0) {
    out.push({
      key: "purchases",
      total: purchases.length,
      rows: purchases.slice(0, limit).map(({ t }) => ({
        key: `purchases:${t.id}`,
        group: "purchases",
        title: t.customerName,
        subtitle: join(t.reference, when(t.capturedAt)),
        value: cedis(t.payout.payable),
        chips: t.status === "void" ? [{ text: "Cancelled", tone: "red" }] : [],
        href: paths.transactions.detail.to(t.id),
      })),
    });
  }
  return out;
}
