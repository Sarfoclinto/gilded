import { useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { useAuth } from "@/features/auth/store";
import { useConnectivity } from "@/shared/offline/connectivity";
import { useLiveAccount } from "@/features/accounts/api";
import { money } from "@/features/accounts/model";

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GH", {
    hour: "2-digit",
    minute: "2-digit",
  });
const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GH", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const grams = (n: number) => n.toFixed(2);

function Section({
  title,
  total,
  children,
}: {
  title: string;
  total?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 border-b border-border pb-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {total ? (
          <span className="tnum text-sm font-semibold">{total}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

const Line = ({
  left,
  right,
  muted,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  muted?: boolean;
}) => (
  <li
    className={`flex items-baseline justify-between gap-3 py-1 text-sm ${muted ? "text-muted-foreground" : ""}`}
  >
    <span className="min-w-0 truncate">{left}</span>
    <span className="tnum shrink-0">{right}</span>
  </li>
);

/**
 * "If I closed now": what the closing account would show with the books as they stand this minute, for the branch being worked in.
 * Read-only, nothing is saved or closed from here. Cash is shown as bundles (whole 100s of notes) and loose notes when the note counts
 * are sound, otherwise only the amount. Goods show the amount and how many purchases; open the list to see each one.
 */
export function ClosingStatus() {
  const branchId = useAuth((s) => s.activeBranchId);
  const online = useConnectivity((s) => s.online);
  const q = useLiveAccount(branchId);
  const [goodsOpen, setGoodsOpen] = useState(false);

  if (!branchId)
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Choose a branch to see its closing account.
      </p>
    );
  if (!online && !q.data)
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        The closing account needs a connection.
      </p>
    );
  if (q.isPending)
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Working out the closing account…
      </p>
    );
  if (q.error || !q.data)
    return (
      <p role="alert" className="py-8 text-center text-sm text-red-600">
        Could not load the closing account. Try again in a moment.
      </p>
    );

  const a = q.data;
  const dayNote =
    a.day === null
      ? "No day has been opened yet."
      : a.day.status === "open"
        ? null
        : "No day is open: this is where the books stand after the last close.";
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {a.name} · as at {timeOf(a.asOf)}
        </span>
        <button
          type="button"
          className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 hover:bg-muted"
          onClick={() => void q.refetch()}
          aria-label="Refresh"
        >
          <RefreshCw
            className={`size-3.5 ${q.isFetching ? "animate-spin" : ""}`}
          />{" "}
          Refresh
        </button>
      </div>
      {dayNote ? (
        <p className="rounded-lg border border-border bg-muted/50 p-2 text-xs text-muted-foreground">
          {dayNote}
        </p>
      ) : null}

      <Section title="Cash" total={money(a.cash.total)}>
        {a.cash.notesSound && a.cash.bundles && a.cash.loose ? (
          <ul className="divide-y divide-border">
            <Line
              left={
                <span className="font-medium">
                  Bundles{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    (100 notes each)
                  </span>
                </span>
              }
              right={money(a.cash.bundlesTotal ?? 0)}
            />
            {a.cash.bundles.map((r) => (
              <Line
                key={`b${r.denomination}`}
                muted
                left={`GHS ${r.denomination} × ${r.count}`}
                right={money(r.value)}
              />
            ))}
            <Line
              left={<span className="font-medium">Loose</span>}
              right={money(a.cash.looseTotal ?? 0)}
            />
            {a.cash.loose.map((r) => (
              <Line
                key={`l${r.denomination}`}
                muted
                left={`GHS ${r.denomination} × ${r.count}`}
                right={money(r.value)}
              />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            Amount only: the notes are not counted note by note in the books
            right now.
          </p>
        )}
      </Section>

      <Section title="Debtors" total={money(a.debtTotal)}>
        {a.debtors.length === 0 && a.debtUnlisted === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody owes the branch.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {a.debtors.map((d) => (
              <Line key={d.id} left={d.name} right={money(d.amount)} />
            ))}
            {a.debtUnlisted !== 0 ? (
              <Line
                muted
                left="Other (not listed by name)"
                right={money(a.debtUnlisted)}
              />
            ) : null}
          </ul>
        )}
      </Section>

      <Section title="Goods in stock" total={money(a.goods.total)}>
        <button
          type="button"
          className="flex min-h-10 w-full items-center justify-between gap-2 rounded-lg text-left text-sm"
          aria-expanded={goodsOpen}
          onClick={() => setGoodsOpen((v) => !v)}
        >
          <span className="inline-flex items-center gap-1.5">
            {goodsOpen ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            {a.goods.count}{" "}
            {a.goods.count === 1 ? "transaction" : "transactions"}
          </span>
          <span className="tnum text-xs text-muted-foreground">
            Top {grams(a.goods.top)} · Down {grams(a.goods.down)} g
          </span>
        </button>
        {goodsOpen ? (
          <ul className="space-y-1.5">
            {a.goods.transactions.map((t) => (
              <li
                key={t.id}
                className="rounded-lg border border-border p-2 text-sm"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium">{t.customerName}</span>
                  <span className="tnum shrink-0">{money(t.value)}</span>
                </div>
                <div className="tnum mt-0.5 flex justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {dateTime(t.capturedAt)} · {t.reference}
                  </span>
                  <span>
                    Top {grams(t.top)} · Down {grams(t.down)}
                  </span>
                </div>
              </li>
            ))}
            {a.goods.broughtForward !== 0 ? (
              <Line
                muted
                left="Brought forward / other"
                right={money(a.goods.broughtForward)}
              />
            ) : null}
          </ul>
        ) : null}
      </Section>

      {a.owedToCustomers !== 0 ? (
        <Section
          title="Owed to customers"
          total={`− ${money(a.owedToCustomers)}`}
        />
      ) : null}

      <div className="flex items-baseline justify-between gap-3 rounded-xl bg-primary/10 p-3">
        <span className="text-sm font-semibold">Closing balance</span>
        <span className="tnum text-xl font-bold">{money(a.closing)}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Cash + debtors + goods − owed to customers. Nothing is closed from here.
      </p>
    </div>
  );
}
