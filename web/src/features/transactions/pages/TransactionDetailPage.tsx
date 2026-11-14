import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeftIcon,
  ArrowLeftRightIcon,
  BanIcon,
  CheckIcon,
  CopyIcon,
  PrinterIcon,
  UserRoundIcon,
} from "lucide-react";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { useAuth } from "@/features/auth/store";
import { useHasPermission } from "@/features/auth/useHasPermission";
import { useActiveDrawer } from "@/features/drawer/hooks";
import { ExchangeModal } from "@/features/drawer/ExchangeModal";
import { useBranchNames } from "@/features/branches/api";
import { cedis, percent } from "@/features/calculator/format";
import { StackBar } from "@/features/dashboard/charts";
import { PayModal } from "../PayModal";
import { CancelModal } from "../CancelModal";
import {
  ResolvePaymentModal,
  type ResolveTarget,
} from "@/features/payments/ResolvePaymentModal";
import { errorMessage } from "@/shared/api/errors";
import { grams } from "@/shared/lib/numbers";
import { useOutbox } from "@/shared/offline/OutboxProvider";
import { Button } from "@/shared/ui/Button";
import { Chip } from "@/shared/ui/Chip";
import { toast } from "@/shared/ui/toast";
import { packText, when } from "../format";
import { useTransactionView } from "../hooks";
import {
  goldTotals,
  payoutRuleText,
  paymentMix,
  receiptText,
  timeline,
  type TimelineEvent,
} from "../receipt";
import { SyncChip } from "../SyncChip";
import { flagText, paymentMethodText, paymentStatusLabel } from "../view";

const DOT: Record<TimelineEvent["tone"], string> = {
  normal: "bg-slate-400",
  good: "bg-emerald-600",
  bad: "bg-red-600",
  wait: "bg-amber-500",
};

function Section({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-border bg-card p-4 print:break-inside-avoid ${className}`}
    >
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{value}</dd>
    </div>
  );
}

export default function TransactionDetailPage() {
  const { id } = useParams();
  const { view: t, isLoading, error } = useTransactionView(id);
  const outbox = useOutbox();
  const canConfirm = useHasPermission(PERMISSIONS.PAYMENTS_CONFIRM);
  const canSeeCustomer = useHasPermission(PERMISSIONS.CUSTOMERS_READ);
  const branchNames = useBranchNames();
  const [target, setTarget] = useState<ResolveTarget | null>(null);
  const [copied, setCopied] = useState(false);
  const [exchanging, setExchanging] = useState(false);
  const [paying, setPaying] = useState(false);
  const canManageDay = useHasPermission(PERMISSIONS.DAYS_MANAGE);
  const canCancel = useHasPermission(PERMISSIONS.TRANSACTIONS_CANCEL);
  const [cancelling, setCancelling] = useState(false);
  const { view: drawer } = useActiveDrawer();
  const activeBranch = useAuth((st) => st.activeBranchId);

  if (isLoading)
    return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  if (!t) {
    return (
      <div className="p-4" role="alert">
        <p className="text-sm">
          {error ? errorMessage(error) : "Transaction not found."}
        </p>
        <Link
          to={paths.transactions.list.href}
          className="text-sm font-medium text-brand underline"
        >
          Back to transactions
        </Link>
      </div>
    );
  }

  const diff = Number(t.payout.difference);
  const gold = goldTotals(t);
  const mix = paymentMix(t);
  const events = timeline(t);
  const cancelled = t.status === "void";
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success(`${what} copied`);
    } catch {
      toast.error("Could not copy. Select the text and copy it by hand.");
    }
  };
  const priceText =
    gold.priceMin === 0
      ? "—"
      : gold.priceMin === gold.priceMax
        ? `${cedis(gold.priceMin)}/lb`
        : `${cedis(gold.priceMin)} to ${cedis(gold.priceMax)}/lb`;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-3 pb-8 sm:p-4 lg:p-6">
      <Link
        to={paths.transactions.list.href}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden"
      >
        <ArrowLeftIcon className="size-4" aria-hidden /> Transactions
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold">{t.customerName}</h1>
            {cancelled ? (
              <Chip tone="red">Cancelled</Chip>
            ) : (
              <SyncChip
                sync={t.sync}
                flags={[]}
                pendingMoney={
                  t.payments.filter((p) => p.status === "pending").length
                }
                toPay={t.payout.stage === "to_pay"}
              />
            )}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <span className="font-mono">
              {t.reference ?? "Not numbered yet"}
            </span>
            {t.reference ? (
              <button
                type="button"
                onClick={() =>
                  void copy(t.reference as string, "Receipt number")
                }
                className="inline-flex items-center gap-1 text-xs text-brand print:hidden"
                aria-label="Copy receipt number"
              >
                {copied ? (
                  <CheckIcon className="size-3.5" aria-hidden />
                ) : (
                  <CopyIcon className="size-3.5" aria-hidden />
                )}{" "}
                Copy
              </button>
            ) : null}
            <span>· {when(t.capturedAt)}</span>
            {branchNames[t.branchId] ? (
              <span>· {branchNames[t.branchId]}</span>
            ) : null}
          </p>
          {t.customerPhone ? (
            <p className="text-sm text-muted-foreground">{t.customerPhone}</p>
          ) : null}
          {t.representative ? (
            <p className="text-sm text-muted-foreground">
              Brought by {t.representative.name}
              {t.representative.phone ? ` · ${t.representative.phone}` : ""}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {t.customerId && canSeeCustomer ? (
            <Link to={paths.people.customer.to(t.customerId)}>
              <Button variant="secondary">
                <UserRoundIcon className="mr-1.5 size-4" aria-hidden />
                Customer
              </Button>
            </Link>
          ) : null}
          <Button
            variant="secondary"
            onClick={() =>
              void copy(receiptText(t, when, cedis), "Receipt text")
            }
          >
            <CopyIcon className="mr-1.5 size-4" aria-hidden />
            Copy as text
          </Button>
          {canManageDay &&
          t.payout.stage === "to_pay" &&
          t.branchId === activeBranch &&
          !cancelled &&
          t.sync !== "failed" ? (
            <Button onClick={() => setPaying(true)}>
              Pay {cedis(t.payout.cashDue)}
            </Button>
          ) : null}
          {canManageDay &&
          drawer.status === "open" &&
          drawer.dayId &&
          t.branchId === activeBranch &&
          !cancelled &&
          t.sync !== "waiting" &&
          t.payout.stage === "paid" ? (
            <Button variant="secondary" onClick={() => setExchanging(true)}>
              <ArrowLeftRightIcon className="mr-1.5 size-4" aria-hidden />
              Change notes
            </Button>
          ) : null}
          <Link to={paths.transactions.receipt.to(t.id)}>
            <Button variant="secondary">
              <PrinterIcon className="mr-1.5 size-4" aria-hidden />
              Receipt
            </Button>
          </Link>
          {/* Cancelling needs the server (it puts the books back), so not while the purchase itself is still waiting to be sent. */}
          {canCancel &&
          !cancelled &&
          t.branchId === activeBranch &&
          t.sync !== "waiting" &&
          t.sync !== "failed" ? (
            <Button
              variant="secondary"
              onClick={() => setCancelling(true)}
              className="border-red-500/40 text-red-700 hover:bg-red-500/10 dark:text-red-300"
            >
              <BanIcon className="mr-1.5 size-4" aria-hidden />
              Cancel purchase
            </Button>
          ) : null}
        </div>
      </div>

      {cancelled ? (
        <div
          role="alert"
          className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm"
        >
          <p className="font-semibold text-red-700">
            This purchase was cancelled.
          </p>
          <p className="mt-0.5 text-muted-foreground">
            {t.cancelled?.reason ?? "No reason was recorded."}
            {t.cancelled?.by ? ` · by ${t.cancelled.by}` : ""}
            {t.cancelled?.at ? ` · ${when(t.cancelled.at)}` : ""}
          </p>
        </div>
      ) : null}
      {t.sync === "waiting" ? (
        <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-sm print:hidden">
          Saved on this device. It gets its number once it reaches the server.
          <div className="mt-2">
            <Button variant="secondary" onClick={() => void outbox.syncNow()}>
              Sync now
            </Button>
          </div>
        </div>
      ) : null}
      {t.sync === "failed" ? (
        <div
          role="alert"
          className="space-y-2 rounded-xl border border-red-500/50 bg-red-500/10 p-3 text-sm print:hidden"
        >
          <p className="font-medium">The server refused this transaction.</p>
          <p className="text-muted-foreground">{t.error}</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void outbox.retry(t.id)}>
              Try again
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                if (
                  window.confirm(
                    "Remove this transaction from this device? It was never saved on the server.",
                  )
                )
                  void outbox.discard(t.id);
              }}
            >
              Discard
            </Button>
          </div>
        </div>
      ) : null}
      {t.payout.stage === "to_pay" && !cancelled ? (
        <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-sm print:hidden">
          <p className="font-semibold">
            Waiting to be paid: {cedis(t.payout.cashDue)}
          </p>
          <p className="text-muted-foreground">
            The gold is recorded. The cash has not left the drawer yet; whoever
            pays it out chooses the notes.
          </p>
        </div>
      ) : t.payout.paidBy && !cancelled ? (
        <p className="text-sm text-muted-foreground print:hidden">
          Paid out by {t.payout.paidBy}
          {t.payout.paidAt ? ` · ${when(t.payout.paidAt)}` : ""}
        </p>
      ) : null}
      {t.flags.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {t.flags.map((f) => (
            <li key={f}>
              <Chip
                tone={
                  f === "OFFLINE_ENTRY" || f === "HISTORICAL" ? "sky" : "amber"
                }
              >
                {flagText[f] ?? f}
              </Chip>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Section title="Amount">
            <div className={cancelled ? "opacity-60" : ""}>
              <div className="text-sm text-muted-foreground">
                {t.payout.stage === "to_pay"
                  ? "To be paid to the customer"
                  : "Paid to the customer"}
              </div>
              <div
                className={`tnum text-3xl font-bold ${cancelled ? "line-through" : ""}`}
              >
                {cedis(t.payout.payable)}
              </div>
              <div className="tnum mt-1 text-sm text-muted-foreground">
                Calculated {cedis(t.calculatedAmount)}
                {diff !== 0
                  ? ` · ${diff < 0 ? `${cedis(-diff)} less, ` : `${cedis(diff)} more, absorbed by the business, `}${(t.payoutPolicy && payoutRuleText[t.payoutPolicy]?.toLowerCase()) ?? "rounded"}`
                  : ""}
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-4">
              {[
                ["Net gold", grams(gold.netGrams)],
                [
                  "Pounds",
                  gold.pounds.toLocaleString("en-GH", {
                    maximumFractionDigits: 3,
                  }),
                ],
                ["Items", String(gold.items)],
                ["Price", priceText],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="tnum text-sm font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section title="Gold bought">
            <ul className="divide-y divide-border">
              {t.items.map((i, n) => (
                <li key={i.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">
                      {i.label || `Item ${n + 1}`}
                    </span>
                    <span className="tnum font-semibold">
                      {i.result ? cedis(i.result.amount) : "—"}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="tnum">
                      Top {i.top} g · Down {i.down} g
                    </span>
                    {i.result ? (
                      <>
                        <Chip tone="grey">{i.result.karat} karat</Chip>
                        <span className="tnum">
                          {percent(i.result.purity)} pure
                        </span>
                        <span className="tnum">
                          net {i.result.netWeight} g · {i.result.pounds} lb
                        </span>
                      </>
                    ) : null}
                    <span className="tnum">at {cedis(i.price)}/lb</span>
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="How it was paid">
            {mix.length > 1 ? (
              <div className="mb-3">
                <StackBar segments={mix} empty="" />
              </div>
            ) : null}
            <ul className="divide-y divide-border text-sm">
              {t.payments.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
                >
                  <div>
                    <div className="font-medium">
                      {paymentMethodText[p.method] ?? p.method}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {p.method === "mobile_money" && p.paidByBranchId
                        ? `Sent by ${branchNames[p.paidByBranchId] ?? "another branch"}`
                        : ""}
                      {p.externalRef ? ` · ref ${p.externalRef}` : ""}
                      {p.debtId ? (
                        <>
                          {" "}
                          ·{" "}
                          <Link className="underline" to={paths.debts.href}>
                            see debts
                          </Link>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Chip
                      tone={
                        p.status === "pending"
                          ? "amber"
                          : p.status === "failed"
                            ? "red"
                            : "green"
                      }
                    >
                      {paymentStatusLabel(p.method, p.status)}
                    </Chip>
                    <strong className="tnum">{cedis(Number(p.amount))}</strong>
                    {p.method === "mobile_money" &&
                    p.status === "pending" &&
                    canConfirm &&
                    t.sync === "synced" &&
                    !cancelled ? (
                      <Button
                        variant="secondary"
                        className="print:hidden"
                        onClick={() =>
                          setTarget({
                            transactionId: t.id,
                            paymentId: p.id,
                            amount: p.amount,
                            customerName: t.customerName,
                            reference: t.reference,
                          })
                        }
                      >
                        Resolve
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </Section>
          <ResolvePaymentModal
            target={target}
            onClose={() => setTarget(null)}
          />

          {Object.keys(t.payout.lines).length > 0 ? (
            <Section title="Cash notes paid out">
              <ul className="divide-y divide-border text-sm">
                {Object.entries(t.payout.lines)
                  .sort((a, b) => Number(b[0]) - Number(a[0]))
                  .map(([d, n]) => (
                    <li
                      key={d}
                      className="flex items-center justify-between py-2 first:pt-0 last:pb-0"
                    >
                      <div>
                        <div className="font-semibold">
                          GHS {d} × {n}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {packText(n)}
                        </div>
                      </div>
                      <div className="tnum text-muted-foreground">
                        {cedis(Number(d) * n)}
                      </div>
                    </li>
                  ))}
              </ul>
              <p className="tnum mt-2 text-right text-sm">
                <span className="text-muted-foreground">Total pieces </span>
                <strong>{t.payout.totalNotes.toLocaleString("en-GH")}</strong>
              </p>
            </Section>
          ) : null}
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Section title="What happened">
            <ol className="relative space-y-4 border-l border-border pl-4">
              {events.map((e) => (
                <li key={e.key} className="relative">
                  <span
                    className={`absolute -left-[21px] top-1.5 size-2.5 rounded-full ring-2 ring-card ${DOT[e.tone]}`}
                    aria-hidden
                  />
                  <div className="text-sm font-medium">{e.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {when(e.at)}
                    {e.detail ? ` · ${e.detail}` : ""}
                  </div>
                </li>
              ))}
            </ol>
          </Section>

          <Section title="Details">
            <dl className="divide-y divide-border">
              <Fact
                label="Receipt"
                value={<span className="font-mono">{t.reference ?? "—"}</span>}
              />
              <Fact label="Branch" value={branchNames[t.branchId] ?? "—"} />
              <Fact label="Recorded by" value={t.createdBy ?? "This device"} />
              <Fact
                label="Customer"
                value={
                  t.customerId && canSeeCustomer ? (
                    <Link
                      className="text-brand underline"
                      to={paths.people.customer.to(t.customerId)}
                    >
                      {t.customerName}
                    </Link>
                  ) : (
                    t.customerName
                  )
                }
              />
              {t.originTown ? (
                <Fact label="Gold from" value={t.originTown} />
              ) : null}
              {t.payoutPolicy ? (
                <Fact
                  label="Rounding"
                  value={payoutRuleText[t.payoutPolicy] ?? t.payoutPolicy}
                />
              ) : null}
              {t.formulaVersion ? (
                <Fact label="Formula" value={t.formulaVersion} />
              ) : null}
              {t.priceAsOf ? (
                <Fact label="Price fixed" value={when(t.priceAsOf)} />
              ) : null}
            </dl>
          </Section>
        </div>
      </div>
      {paying ? <PayModal t={t} open onClose={() => setPaying(false)} /> : null}
      {cancelling ? (
        <CancelModal t={t} open onClose={() => setCancelling(false)} />
      ) : null}
      {drawer.dayId && activeBranch ? (
        <ExchangeModal
          open={exchanging}
          onClose={() => setExchanging(false)}
          dayId={drawer.dayId}
          branchId={activeBranch}
          transactionId={t.id}
          reference={t.reference ?? undefined}
        />
      ) : null}
    </div>
  );
}
