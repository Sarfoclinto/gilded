import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Tag } from "antd";
import paths from "@/config/paths";
import { cedis, percent } from "@/features/calculator/format";
import { PERMISSIONS } from "@/config/permissions";
import { useHasPermission } from "@/features/auth/useHasPermission";
import { useBranchNames } from "@/features/branches/api";
import {
  ResolvePaymentModal,
  type ResolveTarget,
} from "@/features/payments/ResolvePaymentModal";
import { errorMessage } from "@/shared/api/errors";
import { useOutbox } from "@/shared/offline/OutboxProvider";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { packText, when } from "../format";
import { useTransactionView } from "../hooks";
import { SyncChip } from "../SyncChip";
import { flagText, paymentMethodText, paymentStatusLabel } from "../view";

export default function TransactionDetailPage() {
  const { id } = useParams();
  const { view: t, isLoading, error } = useTransactionView(id);
  const outbox = useOutbox();
  const canConfirm = useHasPermission(PERMISSIONS.PAYMENTS_CONFIRM);
  const branchNames = useBranchNames();
  const [target, setTarget] = useState<ResolveTarget | null>(null);

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
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-8">
      <Link
        to={paths.transactions.list.href}
        className="text-sm text-muted-foreground underline"
      >
        ← Transactions
      </Link>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{t.customerName}</h1>
          <p className="text-sm text-muted-foreground">
            {t.reference ?? "Not numbered yet"} · {when(t.capturedAt)}
            {t.customerPhone ? ` · ${t.customerPhone}` : ""}
          </p>
          {t.representative ? (
            <p className="text-sm text-muted-foreground">
              Brought by {t.representative.name}
              {t.representative.phone ? ` · ${t.representative.phone}` : ""}
            </p>
          ) : null}
        </div>
        <SyncChip sync={t.sync} flags={t.flags} />
      </div>

      {t.sync === "waiting" ? (
        <Card className="border-amber-500/50 bg-amber-500/10 text-sm">
          Saved on this device. It gets its number once it reaches the server.
          <div className="mt-2">
            <Button variant="secondary" onClick={() => void outbox.syncNow()}>
              Sync now
            </Button>
          </div>
        </Card>
      ) : null}
      {t.sync === "failed" ? (
        <Card
          className="space-y-2 border-red-500/50 bg-red-500/10 text-sm"
          role="alert"
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
        </Card>
      ) : null}
      {t.flags.map((f) => (
        <p
          key={f}
          className="rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-sm"
        >
          {flagText[f] ?? f}
        </p>
      ))}

      <Card>
        <div className="text-sm text-muted-foreground">Calculated</div>
        <div className="tnum text-xl font-semibold">
          {cedis(t.calculatedAmount)}
        </div>
        <div className="mt-3 text-sm text-muted-foreground">To pay</div>
        <div className="tnum text-3xl font-bold">{cedis(t.payout.payable)}</div>
        {diff !== 0 ? (
          <div className="tnum text-xs text-muted-foreground">
            {diff < 0
              ? `${cedis(-diff)} less than calculated`
              : `${cedis(diff)} absorbed by the business`}
          </div>
        ) : null}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-base font-semibold">Items</h2>
        {t.items.map((i, n) => (
          <div
            key={i.id}
            className="rounded-lg border border-border p-3 text-sm"
          >
            <div className="flex justify-between font-medium">
              <span>{i.label || `Item ${n + 1}`}</span>
              <span className="tnum">
                {i.result ? cedis(i.result.amount) : "—"}
              </span>
            </div>
            <div className="tnum mt-1 text-xs text-muted-foreground">
              Top {i.top} g · Down {i.down} g · {cedis(i.price)}/lb
              {i.result
                ? ` · ${i.result.karat} karat · ${percent(i.result.purity)} · net ${i.result.netWeight} g · ${i.result.pounds} lb`
                : ""}
            </div>
          </div>
        ))}
      </Card>

      <Card className="space-y-2">
        <h2 className="text-base font-semibold">How it was paid</h2>
        <ul className="divide-y divide-border text-sm">
          {t.payments.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
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
                <Tag
                  color={
                    p.status === "pending"
                      ? "orange"
                      : p.status === "failed"
                        ? "red"
                        : "green"
                  }
                >
                  {paymentStatusLabel(p.method, p.status)}
                </Tag>
                <strong className="tnum">{cedis(Number(p.amount))}</strong>
                {p.method === "mobile_money" &&
                p.status === "pending" &&
                canConfirm &&
                t.sync === "synced" ? (
                  <Button
                    variant="secondary"
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
      </Card>
      <ResolvePaymentModal target={target} onClose={() => setTarget(null)} />

      {Object.keys(t.payout.lines).length > 0 ? (
        <Card>
          <h2 className="mb-2 text-base font-semibold">Cash notes paid out</h2>
          <ul className="divide-y divide-border text-sm">
            {Object.entries(t.payout.lines)
              .sort((a, b) => Number(b[0]) - Number(a[0]))
              .map(([d, n]) => (
                <li key={d} className="flex items-center justify-between py-2">
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
        </Card>
      ) : null}
    </div>
  );
}
