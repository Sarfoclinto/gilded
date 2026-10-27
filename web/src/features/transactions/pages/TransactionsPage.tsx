import { Link } from "react-router-dom";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { Can } from "@/features/auth/useHasPermission";
import { useAuth } from "@/features/auth/store";
import { cedis } from "@/features/calculator/format";
import { errorMessage } from "@/shared/api/errors";
import { useOutbox } from "@/shared/offline/OutboxProvider";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { ExportTransactionsButton } from "@/features/exports/ExportTransactionsButton";
import { when } from "../format";
import { useTransactionList } from "../hooks";
import type { TransactionView } from "../view";
import { SyncChip } from "../SyncChip";

function Row({ t }: { t: TransactionView }) {
  return (
    <li>
      <Link
        to={paths.transactions.detail.to(t.id)}
        className="block rounded-xl border border-border bg-card p-3 active:bg-muted"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate font-semibold">{t.customerName}</div>
            <div className="text-xs text-muted-foreground">
              {t.reference ?? "Not numbered yet"} · {when(t.capturedAt)} ·{" "}
              {t.items.length} item{t.items.length > 1 ? "s" : ""}
            </div>
          </div>
          <div className="text-right">
            <div className="tnum font-bold">{cedis(t.payout.payable)}</div>
            <SyncChip
              sync={t.sync}
              flags={t.flags}
              pendingMoney={
                t.payments.filter((x) => x.status === "pending").length
              }
            />
          </div>
        </div>
      </Link>
    </li>
  );
}

export default function TransactionsPage() {
  const branchId = useAuth((s) => s.activeBranchId);
  const { rows, query } = useTransactionList(branchId);
  const outbox = useOutbox();

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Transactions</h1>
        <div className="flex items-center gap-2">
          <Can permission={PERMISSIONS.REPORTS_READ}>
            <ExportTransactionsButton />
          </Can>
          <Can permission={PERMISSIONS.TRANSACTIONS_CREATE}>
            <Link to={paths.transactions.create.href}>
              <Button>New</Button>
            </Link>
          </Can>
        </div>
      </div>

      {outbox.waiting.length > 0 ? (
        <Card className="flex items-center justify-between gap-3 border-amber-500/50 bg-amber-500/10">
          <p className="text-sm">
            <strong>{outbox.waiting.length}</strong> waiting to sync
          </p>
          <Button variant="secondary" onClick={() => void outbox.syncNow()}>
            Sync now
          </Button>
        </Card>
      ) : null}

      {outbox.failed.map((e) => (
        <Card
          key={e.id}
          className="space-y-2 border-red-500/50 bg-red-500/10"
          role="alert"
        >
          <p className="text-sm font-medium">
            The server refused one transaction
          </p>
          <p className="text-xs text-muted-foreground">
            {e.lastError?.message ?? "Unknown reason"}
          </p>
          <div className="flex gap-2">
            <Link to={paths.transactions.detail.to(e.id)}>
              <Button variant="secondary">View</Button>
            </Link>
            <Button variant="secondary" onClick={() => void outbox.retry(e.id)}>
              Try again
            </Button>
          </div>
        </Card>
      ))}

      {query.isLoading && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : null}
      {query.error && rows.length === 0 ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {errorMessage(query.error)}
        </p>
      ) : null}
      {!query.isLoading && !query.error && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No transactions yet.</p>
      ) : null}

      <ul className="space-y-2">
        {rows.map((t) => (
          <Row key={t.id} t={t} />
        ))}
      </ul>
    </div>
  );
}
