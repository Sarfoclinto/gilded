import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Segmented } from "antd";
import { SearchIcon } from "lucide-react";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { useAuth } from "@/features/auth/store";
import { useHasPermission } from "@/features/auth/useHasPermission";
import { cedis } from "@/features/calculator/format";
import { Kpi } from "@/features/dashboard/charts";
import { when } from "@/features/transactions/format";
import { errorMessage } from "@/shared/api/errors";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { Chip } from "@/shared/ui/Chip";
import { EmptyState } from "@/shared/ui/DataTable";
import { PageHeader } from "@/shared/ui/PageHeader";
import { usePendingPayments, type PendingPayment } from "./api";
import { matches, oldestFirst, summarize, waitOf } from "./model";
import { ResolvePaymentModal, type ResolveTarget } from "./ResolvePaymentModal";

type Role = "sending" | "receiving";

/** Mobile money parts of purchases that are waiting: ones this branch must send, and ones other branches are sending for it. */
export default function PendingPaymentsPage() {
  const branchId = useAuth((s) => s.activeBranchId);
  const canConfirm = useHasPermission(PERMISSIONS.PAYMENTS_CONFIRM);
  const [role, setRole] = useState<Role>(canConfirm ? "sending" : "receiving");
  const [q, setQ] = useState("");
  const [target, setTarget] = useState<ResolveTarget | null>(null);
  const sending = usePendingPayments(branchId, "sending", canConfirm);
  const receiving = usePendingPayments(branchId, "receiving");
  const list = role === "sending" ? sending : receiving;
  const sum = useMemo(() => summarize(list.data ?? []), [list.data]);
  const rows = useMemo(
    () => oldestFirst(list.data ?? []).filter((p) => matches(p, q)),
    [list.data, q],
  );
  const counts = {
    sending: sending.data?.length,
    receiving: receiving.data?.length,
  };

  const label = (text: string, n: number | undefined) =>
    n ? `${text} (${n})` : text;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-3 pb-8 sm:p-4 lg:p-6">
      <PageHeader
        title="Mobile money"
        subtitle="Parts of purchases paid by mobile money that are not confirmed yet."
      />

      <div className="overflow-x-auto">
        <Segmented<Role>
          value={role}
          onChange={setRole}
          options={[
            ...(canConfirm
              ? [
                  {
                    label: label("This branch must send", counts.sending),
                    value: "sending" as const,
                  },
                ]
              : []),
            {
              label: label("Other branches sending for us", counts.receiving),
              value: "receiving" as const,
            },
          ]}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Waiting" value={sum.count} />
        <Kpi label="Total" value={cedis(sum.total)} />
        <Kpi
          label="Waiting a day or more"
          value={
            <span className={sum.late ? "text-amber-700" : ""}>{sum.late}</span>
          }
        />
      </div>

      <p className="text-sm text-muted-foreground">
        {role === "sending"
          ? "Customers of other branches are waiting for this money. Send it from your mobile money account, then mark it as received here."
          : "These customers were paid partly by mobile money from another branch. They are not counted as paid until that branch confirms."}
      </p>

      {(list.data?.length ?? 0) > 4 ? (
        <label className="relative block">
          <span className="sr-only">Search the waiting payments</span>
          <SearchIcon
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            className="min-h-11 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            placeholder="Search customer, receipt or branch"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      ) : null}

      {list.error ? (
        <Alert type="error" showIcon title={errorMessage(list.error)} />
      ) : null}
      {list.isLoading ? (
        <div
          className="h-32 animate-pulse rounded-xl border border-border bg-muted/50"
          aria-busy="true"
        />
      ) : null}
      {!list.isLoading && rows.length === 0 ? (
        <EmptyState
          title={q ? "No match" : "Nothing is waiting"}
          hint={
            q
              ? "Try another name or receipt."
              : role === "sending"
                ? "Every mobile money part this branch owed has been sent."
                : "No other branch is sending money for this branch’s customers."
          }
        />
      ) : null}

      <ul className="space-y-2">
        {rows.map((p: PendingPayment) => {
          const w = waitOf(p.createdAt);
          return (
            <li key={p.paymentId}>
              <Card
                className={`flex flex-wrap items-center justify-between gap-3 ${w.tone === "stale" ? "border-red-400/70" : w.tone === "late" ? "border-amber-400/70" : ""}`}
              >
                <div className="min-w-0">
                  <div className="font-semibold">{p.customerName}</div>
                  <div className="text-xs text-muted-foreground">
                    <Link
                      className="underline"
                      to={paths.transactions.detail.to(p.transactionId)}
                    >
                      {p.reference ?? "Open purchase"}
                    </Link>
                    {" · "}
                    {role === "sending"
                      ? `Bought at ${p.purchaseBranchName}`
                      : `Sent by ${p.sendingBranchName}`}
                    {p.externalRef ? ` · Ref ${p.externalRef}` : ""}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <Chip
                      tone={
                        w.tone === "ok"
                          ? "grey"
                          : w.tone === "late"
                            ? "amber"
                            : "red"
                      }
                    >
                      Waiting {w.text}
                    </Chip>
                    <span className="text-muted-foreground">
                      since {when(p.createdAt)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <strong className="tnum text-xl">
                    {cedis(Number(p.amount))}
                  </strong>
                  {role === "sending" && canConfirm ? (
                    <Button
                      onClick={() =>
                        setTarget({
                          transactionId: p.transactionId,
                          paymentId: p.paymentId,
                          amount: p.amount,
                          customerName: p.customerName,
                          reference: p.reference,
                        })
                      }
                    >
                      Resolve
                    </Button>
                  ) : null}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
      <ResolvePaymentModal target={target} onClose={() => setTarget(null)} />
    </div>
  );
}
