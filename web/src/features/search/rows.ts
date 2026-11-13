import paths from "@/config/paths";
import { cedis } from "@/features/calculator/format";
import { day, when } from "@/features/transactions/format";
import type { ChipTone } from "@/shared/ui/Chip";
import type { GroupKey, SearchGroup } from "./api";
import type { PageHit } from "./pages";

/** One line in the results, whatever it is: enough to recognise the right one without opening it, and where it leads. */
export type RowGroup = GroupKey | "pages";

export interface Row {
  /** Unique across groups. */
  key: string;
  group: RowGroup;
  title: string;
  subtitle: string;
  /** The figure on the right: an amount, a weight. */
  value?: string;
  valueNote?: string;
  valueTone?: "plain" | "red" | "green";
  chips: { text: string; tone: ChipTone }[];
  href: string;
  state?: unknown;
  /** A second thing to do from the row (for a customer: start a purchase). */
  action?: { label: string; href: string; state?: unknown };
}

export const GROUP_LABEL: Record<RowGroup, string> = {
  pages: "Go to",
  customers: "Customers",
  purchases: "Purchases",
  debts: "Debts and loans",
  held: "Gold held as security",
  transfers: "Transfers",
  payments: "Mobile money",
  users: "Users",
  branches: "Branches",
  guide: "Rules and guides",
};

/** Short names for the filter chips. */
export const GROUP_SHORT: Record<RowGroup, string> = {
  ...GROUP_LABEL,
  pages: "Pages",
  debts: "Debts",
  held: "Held gold",
  guide: "Guide",
};

/** What the person may do, which decides where a row leads. */
export interface Abilities {
  /** May open a customer's page. */
  customers: boolean;
  /** May start a purchase. */
  buy: boolean;
}

const join = (...parts: (string | null | undefined | false)[]) =>
  parts.filter(Boolean).join(" · ");
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-GH")} ${n === 1 ? one : many}`;
const grams = (v: string | null | undefined) =>
  v
    ? `${Number(v).toLocaleString("en-GH", { maximumFractionDigits: 2 })} g`
    : null;
const title = (s: string) =>
  s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Starting a purchase for a known customer: the New transaction page picks this up. */
export const buyFor = (c: {
  id: string | null | undefined;
  name: string;
  phone?: string | null;
}) => ({
  label: "New purchase",
  href: paths.transactions.create.href,
  state: { customer: { id: c.id ?? null, name: c.name, phone: c.phone ?? "" } },
});

export function toRows(g: SearchGroup, can: Abilities): Row[] {
  switch (g.key) {
    case "customers":
      return g.items.map((c) => {
        const owes = c.owes ? Number(c.owes) : 0;
        const buy = can.buy ? buyFor(c) : undefined;
        return {
          key: `customers:${c.id}`,
          group: g.key,
          title: c.name,
          subtitle: join(
            c.phone,
            c.purchases > 0
              ? plural(c.purchases, "purchase")
              : "No purchases yet",
            c.lastPurchaseAt && c.lastAmount
              ? `last ${cedis(c.lastAmount)}, ${day(c.lastPurchaseAt)}`
              : null,
          ),
          value: owes > 0 ? cedis(owes) : undefined,
          valueNote: owes > 0 ? "owes" : undefined,
          valueTone: "red",
          chips: c.close ? [{ text: "Close match", tone: "grey" }] : [],
          // Someone who may not open the customer's page still gets somewhere useful: a purchase for that customer.
          href: can.customers
            ? paths.people.customer.to(c.id)
            : (buy?.href ?? paths.home.href),
          state: can.customers ? undefined : buy?.state,
          action: can.customers ? buy : undefined,
        };
      });
    case "purchases":
      return g.items.map((t) => ({
        key: `purchases:${t.id}`,
        group: g.key,
        title: t.customerName,
        subtitle: join(
          t.reference,
          when(t.capturedAt),
          t.branch,
          t.top
            ? `${grams(t.top)} top${t.down ? `, ${grams(t.down)} down` : ""}`
            : null,
          t.karat
            ? `${Number(t.karat)}K${(t.items ?? 1) > 1 ? ` +${(t.items ?? 1) - 1} more` : ""}`
            : null,
        ),
        value: cedis(t.amount),
        chips: [
          ...(t.status === "void"
            ? [{ text: "Cancelled", tone: "red" as const }]
            : []),
          ...(t.flagged ? [{ text: "Flagged", tone: "amber" as const }] : []),
        ],
        href: paths.transactions.detail.to(t.id),
      }));
    case "debts":
      return g.items.map((d) => ({
        key: `debts:${d.id}`,
        group: g.key,
        title: d.name,
        subtitle: join(
          d.direction === "receivable" ? "Owes the branch" : "The branch owes",
          d.reason,
          `since ${day(d.issuedAt)}`,
          d.branch,
        ),
        value: cedis(d.outstanding),
        valueNote:
          Number(d.outstanding) !== Number(d.principal)
            ? `of ${cedis(d.principal)}`
            : undefined,
        valueTone:
          d.status === "open"
            ? d.direction === "receivable"
              ? "red"
              : "plain"
            : "plain",
        chips:
          d.status === "open" ? [] : [{ text: title(d.status), tone: "grey" }],
        href:
          d.customerId && can.customers
            ? paths.people.customer.to(d.customerId)
            : paths.debts.href,
      }));
    case "held":
      return g.items.map((h) => ({
        key: `held:${h.id}`,
        group: g.key,
        title: h.name,
        subtitle: join(
          h.description,
          `received ${day(h.receivedAt)}`,
          h.branch,
        ),
        value: grams(h.topWeight) ?? undefined,
        chips: [
          {
            text: h.status === "held" ? "Held" : title(h.status),
            tone: h.status === "held" ? "amber" : "grey",
          },
        ],
        href: paths.collateral.href,
      }));
    case "transfers":
      return g.items.map((t) => ({
        key: `transfers:${t.id}`,
        group: g.key,
        title: t.reference,
        subtitle: join(
          `${t.from} → ${t.to}`,
          title(t.kind),
          t.collector ? `collector ${t.collector}` : null,
          day(t.createdAt),
        ),
        value: t.cash ? cedis(t.cash) : undefined,
        chips: [
          {
            text: title(t.status),
            tone:
              t.status === "received"
                ? "green"
                : t.status === "cancelled"
                  ? "grey"
                  : t.status.includes("discrepancy")
                    ? "red"
                    : "sky",
          },
        ],
        href: paths.transfers.detail.to(t.id),
      }));
    case "payments":
      return g.items.map((m) => ({
        key: `payments:${m.id}`,
        group: g.key,
        title: m.customerName,
        subtitle: join(
          m.externalRef ? `Ref ${m.externalRef}` : "No reference yet",
          m.reference,
          when(m.createdAt),
        ),
        value: cedis(m.amount),
        chips: [
          {
            text: title(m.status),
            tone:
              m.status === "confirmed"
                ? "green"
                : m.status === "failed"
                  ? "red"
                  : "amber",
          },
        ],
        href: paths.transactions.detail.to(m.transactionId),
      }));
    case "users":
      return g.items.map((u) => ({
        key: `users:${u.id}`,
        group: g.key,
        title: u.name,
        subtitle: join(`@${u.username}`, u.role),
        chips: u.active ? [] : [{ text: "Switched off", tone: "grey" }],
        href: paths.people.users.href,
      }));
    case "branches":
      return g.items.map((b) => ({
        key: `branches:${b.id}`,
        group: g.key,
        title: b.name,
        subtitle: join(b.code, b.main ? "Main branch" : null),
        chips: b.active ? [] : [{ text: "Switched off", tone: "grey" }],
        href: paths.people.branch.to(b.id),
      }));
    case "guide":
      return g.items.map((a) => ({
        key: `guide:${a.id}`,
        group: g.key,
        title: a.title,
        subtitle: a.summary ?? "Guide article",
        chips: [],
        href: paths.guide.article.to(a.id),
      }));
  }
}

export const pageRow = (p: PageHit): Row => ({
  key: `pages:${p.href}|${p.title}`,
  group: "pages",
  title: p.title,
  subtitle: p.section || "Page",
  chips: [],
  href: p.href,
});
