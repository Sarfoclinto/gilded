import { useMemo, useState, type ReactNode } from "react";
import { Alert } from "antd";
import { ChevronLeft, ChevronRight, Printer } from "lucide-react";
import { errorMessage } from "@/shared/api/errors";
import { Button } from "@/shared/ui/Button";
import { Chip, type ChipTone } from "@/shared/ui/Chip";
import { PageHeader } from "@/shared/ui/PageHeader";
import { localDate } from "@/features/drawer/projection";
import { useDailyAccounts, type ClosedAccount } from "../api";
import {
  closingFrom,
  combine,
  isClosed,
  longDate,
  money,
  shiftDate,
  shortDate,
  signed,
} from "../model";

const signoff: Record<
  ClosedAccount["day"]["signoff"],
  { tone: ChipTone; text: string }
> = {
  not_required: { tone: "green", text: "Balanced" },
  pending: { tone: "amber", text: "Waiting for sign-off" },
  approved: { tone: "green", text: "Signed off" },
  rejected: { tone: "red", text: "Sign-off rejected" },
};

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

function Section({
  title,
  total,
  children,
  note,
}: {
  title: string;
  total?: ReactNode;
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <section className="space-y-2 print:break-inside-avoid">
      <div className="flex items-baseline justify-between gap-3 border-b border-border pb-1.5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
        {total !== undefined ? (
          <span className="tnum text-sm font-semibold">{total}</span>
        ) : null}
      </div>
      {children}
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </section>
  );
}

function Row({
  left,
  sub,
  right,
  tone,
}: {
  left: ReactNode;
  sub?: ReactNode;
  right: ReactNode;
  tone?: "muted";
}) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <div className="min-w-0">
        <div
          className={`truncate ${tone === "muted" ? "text-muted-foreground" : ""}`}
        >
          {left}
        </div>
        {sub ? (
          <div className="text-xs text-muted-foreground">{sub}</div>
        ) : null}
      </div>
      <div className="tnum shrink-0 font-medium">{right}</div>
    </li>
  );
}

function Statement({ a }: { a: ClosedAccount }) {
  const check = closingFrom(a);
  const off = Math.abs(check - a.closing) > 0.005;
  const so = signoff[a.day.signoff];
  return (
    <article className="space-y-6 rounded-2xl border border-border bg-card p-5 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Daily account
          </div>
          <h2 className="text-2xl font-bold">{a.name}</h2>
          <p className="text-sm text-muted-foreground">
            {longDate(a.businessDate)}
          </p>
        </div>
        <div className="text-right text-sm">
          <Chip tone={so.tone}>{so.text}</Chip>
          <p className="mt-1 text-xs text-muted-foreground">
            {a.branchId === "all"
              ? "All branches added together"
              : `Closed ${timeOf(a.day.closedAt)}${a.day.closedBy ? ` by ${a.day.closedBy.displayName}` : ""}`}
          </p>
          {a.day.sessions > 1 && a.branchId !== "all" ? (
            <p className="text-xs text-muted-foreground">
              Opened again later the same day
            </p>
          ) : null}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Cash", money(a.cash.total)],
          ["Debts", money(a.debtTotal)],
          ["Goods", money(a.goods.total)],
          ["Closing balance", money(a.closing)],
        ].map(([label, value], i) => (
          <div
            key={label}
            className={`rounded-xl border p-3 ${i === 3 ? "border-brand/40 bg-brand/5" : "border-border bg-background"}`}
          >
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="tnum text-lg font-bold leading-tight">{value}</div>
          </div>
        ))}
      </div>

      <Section
        title="Debtors"
        total={money(a.debtTotal)}
        note={
          a.debtors.length === 0
            ? "Nobody owed the business anything at closing."
            : undefined
        }
      >
        <ul className="divide-y divide-border">
          {a.debtors.map((d) => (
            <Row
              key={d.id}
              left={d.name}
              sub={
                [
                  d.branch,
                  d.isNew
                    ? "New today"
                    : d.change
                      ? `${signed(d.change)} since the last closing`
                      : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || undefined
              }
              right={money(d.amount)}
            />
          ))}
          {a.debtUnlisted !== 0 ? (
            <Row
              left="Adjusted at closing"
              sub="Counted differently from the books"
              right={signed(a.debtUnlisted)}
              tone="muted"
            />
          ) : null}
        </ul>
      </Section>

      <Section title="Cash in hand" total={money(a.cash.total)}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1 flex items-baseline justify-between text-xs text-muted-foreground">
              <span>Bundles (100 notes each)</span>
              <span className="tnum font-semibold text-foreground">
                {money(a.cash.bundlesTotal)}
              </span>
            </div>
            <ul className="divide-y divide-border">
              {a.cash.bundles.length === 0 ? (
                <Row left="None" right="—" tone="muted" />
              ) : null}
              {a.cash.bundles.map((r) => (
                <Row
                  key={r.denomination}
                  left={`${r.denomination} × ${r.count.toLocaleString("en-GH")}`}
                  sub={`${r.count / 100} bundle${r.count === 100 ? "" : "s"}`}
                  right={money(r.value)}
                />
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-1 flex items-baseline justify-between text-xs text-muted-foreground">
              <span>Loose notes</span>
              <span className="tnum font-semibold text-foreground">
                {money(a.cash.looseTotal)}
              </span>
            </div>
            <ul className="divide-y divide-border">
              {a.cash.loose.length === 0 ? (
                <Row left="None" right="—" tone="muted" />
              ) : null}
              {a.cash.loose.map((r) => (
                <Row
                  key={r.denomination}
                  left={`${r.denomination} × ${r.count.toLocaleString("en-GH")}`}
                  right={money(r.value)}
                />
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section
        title="Goods in stock"
        total={money(a.goods.total)}
        note={
          a.goods.lastSentOn
            ? `Showing what came in since goods were last sent on ${shortDate(a.goods.lastSentOn)}. Earlier days are kept below.`
            : undefined
        }
      >
        <ul className="divide-y divide-border">
          {a.goods.days.map((g) => (
            <Row
              key={g.date}
              left={shortDate(g.date)}
              sub={g.date === a.businessDate ? "This day" : undefined}
              right={money(g.value)}
            />
          ))}
          {a.goods.broughtForward !== 0 ? (
            <Row
              left="Brought forward"
              sub="Stock from before these days"
              right={money(a.goods.broughtForward)}
              tone="muted"
            />
          ) : null}
          {a.goods.days.length === 0 && a.goods.broughtForward === 0 ? (
            <Row left="No goods in stock" right="—" tone="muted" />
          ) : null}
        </ul>
        {a.goods.sent.length > 0 ? (
          <details className="text-sm print:hidden">
            <summary className="min-h-10 cursor-pointer py-2 text-muted-foreground">
              Goods sent to the main branch ({a.goods.sent.length})
            </summary>
            <ul className="divide-y divide-border">
              {a.goods.sent.map((s) => (
                <Row
                  key={s.reference}
                  left={s.reference}
                  sub={`${shortDate(s.date)}${s.to ? ` · to ${s.to}` : ""}`}
                  right={money(s.value)}
                />
              ))}
            </ul>
          </details>
        ) : null}
      </Section>

      {a.owedToCustomers > 0 ? (
        <Section
          title="Owed to customers"
          total={`− ${money(a.owedToCustomers)}`}
          note="Purchases not yet paid out. Taken off the balance."
          children={null}
        />
      ) : null}

      <Section title="Office allowance" total={money(a.allowance.paid)}>
        <p className="text-sm text-muted-foreground">
          {a.allowance.paid > 0
            ? `Paid out of the day's cash for ${a.allowance.people} ${a.allowance.people === 1 ? "person" : "people"}. It is already out of the cash above.`
            : "No office allowance was paid from the drawer on this day."}
        </p>
      </Section>

      <footer className="space-y-2 rounded-xl border border-brand/40 bg-brand/5 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Closing balance
            </div>
            <div className="text-xs text-muted-foreground">
              Cash + debts + goods
              {a.owedToCustomers > 0 ? " − owed to customers" : ""}
            </div>
          </div>
          <div className="tnum text-3xl font-bold">{money(a.closing)}</div>
        </div>
        {a.previous && a.change !== null ? (
          <div className="flex items-baseline justify-between border-t border-border pt-2 text-sm">
            <span className="text-muted-foreground">
              Since {shortDate(a.previous.date)} ({money(a.previous.closing)})
            </span>
            <span
              className={`tnum font-semibold ${a.change < 0 ? "text-red-600 dark:text-red-400" : ""}`}
            >
              {signed(a.change)}
            </span>
          </div>
        ) : null}
        {off ? (
          <p role="alert" className="text-xs text-red-600">
            The parts add up to {money(check)}, not {money(a.closing)}. Tell a
            manager.
          </p>
        ) : null}
      </footer>
    </article>
  );
}

export default function DailyAccountPage() {
  const [date, setDate] = useState(() => localDate());
  const [pick, setPick] = useState<string>("all");
  const q = useDailyAccounts(date);
  const entries = useMemo(() => q.data?.branches ?? [], [q.data]);
  const closed = useMemo(() => entries.filter(isClosed), [entries]);
  const notClosed = entries.filter((e) => !isClosed(e));
  const selected =
    pick === "all"
      ? combine(closed)
      : (closed.find((c) => c.branchId === pick) ?? null);
  const chosenName =
    pick === "all" ? null : entries.find((e) => e.branchId === pick)?.name;
  const today = localDate();

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 pb-8">
      <PageHeader
        title="Daily account"
        subtitle="The closed day on one page: debtors, cash, goods and the closing balance."
        actions={
          <Button
            variant="secondary"
            className="print:hidden"
            onClick={() => window.print()}
            disabled={!selected}
          >
            <Printer className="mr-1.5 size-4" aria-hidden />
            Print
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="The day before"
            className="grid size-10 place-items-center rounded-lg border border-border bg-card"
            onClick={() => setDate(shiftDate(date, -1))}
          >
            <ChevronLeft className="size-4" />
          </button>
          <input
            type="date"
            aria-label="Date"
            value={date}
            max={today}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="tnum h-10 rounded-lg border border-border bg-card px-3 text-sm"
          />
          <button
            type="button"
            aria-label="The day after"
            disabled={date >= today}
            className="grid size-10 place-items-center rounded-lg border border-border bg-card disabled:opacity-40"
            onClick={() => setDate(shiftDate(date, 1))}
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        {date !== today ? (
          <Button variant="secondary" onClick={() => setDate(today)}>
            Today
          </Button>
        ) : null}
        {entries.length > 1 ? (
          <div
            className="flex flex-wrap gap-1.5"
            role="tablist"
            aria-label="Branch"
          >
            {[
              { id: "all", name: "All branches" },
              ...entries.map((e) => ({ id: e.branchId, name: e.name })),
            ].map((b) => (
              <button
                key={b.id}
                type="button"
                role="tab"
                aria-selected={pick === b.id}
                onClick={() => setPick(b.id)}
                className={`min-h-10 rounded-full border px-3 text-sm ${pick === b.id ? "border-brand bg-brand/10 font-semibold" : "border-border bg-card"}`}
              >
                {b.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {q.error ? (
        <Alert type="error" showIcon title={errorMessage(q.error)} />
      ) : null}
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : null}

      {selected ? (
        <>
          {pick === "all" && notClosed.length > 0 ? (
            <Alert
              type="info"
              showIcon
              title={`Not included: ${notClosed.map((n) => `${n.name} (${n.status === "open" ? "still open" : "no day"})`).join(", ")}.`}
            />
          ) : null}
          <Statement a={selected} />
        </>
      ) : q.data ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <p className="font-medium">
            {chosenName
              ? `${chosenName} has no closed day on ${shortDate(date)}.`
              : `No branch closed a day on ${shortDate(date)}.`}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {entries.some((e) => e.status === "open")
              ? "A day is still open. The account appears once it is closed."
              : "Use the arrows to look at another day."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
