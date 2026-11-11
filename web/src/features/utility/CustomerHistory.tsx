import { Link } from "react-router-dom";
import { UserSearch } from "lucide-react";
import { useApiQuery } from "@/shared/api/hooks";
import { useConnectivity } from "@/shared/offline/connectivity";
import { transactionsApi } from "@/features/transactions/api";
import type { Transaction } from "@/features/transactions/schemas";
import { useCustomerSearch } from "@/features/customers/api";
import { cedis } from "@/features/calculator/format";
import { planLookup } from "./customerLookup";
import { useCustomerLookup } from "./store";

const dateOf = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GH", {
    hour: "2-digit",
    minute: "2-digit",
  });
const grams = (v: string) => Number(v).toFixed(2);

/** One purchase: when, then each piece with its top, down and carat (the carat stands out), the amount last and quiet. */
function Row({ t }: { t: Transaction }) {
  const void_ = t.status === "void";
  return (
    <li
      className={`rounded-xl border border-border bg-card p-3 ${void_ ? "opacity-60" : ""}`}
    >
      <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {dateOf(t.capturedAt)} · {timeOf(t.capturedAt)}
        </span>
        <span className="tnum">{t.reference}</span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {t.items.map((i, n) => (
          <li
            key={i.id ?? n}
            className="flex items-center justify-between gap-2"
          >
            <div className="tnum flex gap-4 text-sm">
              <span>
                <span className="text-xs text-muted-foreground">Top </span>
                {grams(i.top)}
              </span>
              <span>
                <span className="text-xs text-muted-foreground">Down </span>
                {grams(i.down)}
              </span>
            </div>
            <span
              className="tnum rounded-full bg-amber-500/15 px-2.5 py-0.5 text-sm font-bold text-amber-700 dark:text-amber-300"
              title="Carat"
            >
              {Number(i.result.karat).toFixed(2)} ct
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {void_
            ? "Cancelled"
            : t.items.length > 1
              ? `${t.items.length} pieces`
              : ""}
        </span>
        <Link
          to={`/transactions/${t.id}`}
          className="tnum underline-offset-2 hover:underline"
        >
          {cedis(t.payout.payable)}
        </Link>
      </div>
    </li>
  );
}

/**
 * The customer being worked on at the New transaction page: their latest purchases, newest first.
 * Read-only. The page owns the customer; this only looks it up (by id when one was picked, else by the phone or name typed).
 */
export function CustomerHistory() {
  const customer = useCustomerLookup((s) => s.customer);
  const plan = planLookup(customer);
  const online = useConnectivity((s) => s.online);

  const history = useApiQuery({
    queryKey: ["utility", "customer-history", plan],
    queryFn: ({ signal }) =>
      transactionsApi.search(
        plan.mode === "picked"
          ? { customerId: plan.customerId, sort: "newest", limit: 8 }
          : {
              q: plan.mode === "typed" ? plan.q : "",
              sort: "newest",
              limit: 8,
            },
        signal,
      ),
    enabled: plan.mode !== "none" && online,
    staleTime: 10_000,
    retry: false,
  });
  // Only to tell "no such customer" from "customer with no purchases yet" when the name was typed but not picked.
  const known = useCustomerSearch(plan.mode === "typed" ? plan.q : "");

  if (plan.mode === "none") {
    return (
      <div className="grid place-items-center gap-2 py-10 text-center text-sm text-muted-foreground">
        <UserSearch className="size-8" />
        <p>
          Enter a customer on the New transaction page to see their recent
          purchases here.
        </p>
      </div>
    );
  }
  if (!online)
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Customer history needs a connection.
      </p>
    );
  if (history.isPending)
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Looking up {plan.label}…
      </p>
    );
  if (history.error)
    return (
      <p role="alert" className="py-8 text-center text-sm text-red-600">
        Could not load the history. Try again in a moment.
      </p>
    );

  const items = history.data.items;
  const total = history.data.total;
  if (items.length === 0) {
    const noSuchCustomer =
      plan.mode === "typed" &&
      !known.isPending &&
      (known.data ?? []).length === 0;
    return (
      <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {noSuchCustomer ? (
          <>Customer “{plan.label}” does not exist.</>
        ) : (
          <>No transactions yet for “{plan.label}”.</>
        )}
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="truncate text-sm font-semibold">{plan.label}</h3>
        <span className="shrink-0 text-xs text-muted-foreground">
          Latest {items.length}
          {total > items.length ? ` of ${total}` : ""}
        </span>
      </div>
      <ul className="space-y-2">
        {items.map((t) => (
          <Row key={t.id} t={t} />
        ))}
      </ul>
    </div>
  );
}
