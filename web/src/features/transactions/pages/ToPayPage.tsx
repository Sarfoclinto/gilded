import { useState } from "react";
import { Link } from "react-router-dom";
import { SearchIcon } from "lucide-react";
import paths from "@/config/paths";
import { useAuth } from "@/features/auth/store";
import { cedis } from "@/features/calculator/format";
import { useBranchNames } from "@/features/branches/api";
import { useActiveDrawer } from "@/features/drawer/hooks";
import { useSettings } from "@/features/settings/api";
import { errorMessage } from "@/shared/api/errors";
import { useOutbox } from "@/shared/offline/OutboxProvider";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { Chip } from "@/shared/ui/Chip";
import { EmptyState } from "@/shared/ui/DataTable";
import { PageHeader } from "@/shared/ui/PageHeader";
import { recently } from "../format";
import { useToPay, usePayQueue } from "../hooks";
import { PayModal } from "../PayModal";
import type { TransactionView } from "../view";

/**
 * The paying desk. Purchases that have been weighed and saved but not yet paid, newest first, so what the colleague just saved is at
 * the top. Search by receipt number, name or phone. Refreshes by itself; works offline from what was last loaded and what this device saved.
 */
export default function ToPayPage() {
  const branchId = useAuth((s) => s.activeBranchId);
  const userName = useAuth((s) => s.user?.displayName);
  const branchName = useBranchNames()[branchId ?? ""];
  const settings = useSettings();
  const outbox = useOutbox();
  const { view: drawer } = useActiveDrawer();
  const [search, setSearch] = useState("");
  const [paying, setPaying] = useState<TransactionView | null>(null);
  const { rows, query } = useToPay(branchId, search);
  const queue = usePayQueue();
  const waitingToSend = queue.size;
  const sameUserBlocked = !settings["payout.sameUserMayPay"];

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-3 sm:p-4 lg:p-6">
      <PageHeader
        title="To pay"
        subtitle={[branchName, rows.length ? `${rows.length} waiting` : null]
          .filter(Boolean)
          .join(" · ")}
      />

      {!settings["payout.twoStep"] ? (
        <Card className="text-sm">
          Two-step payout is switched off, so purchases are paid out when they
          are saved. Anything saved while it was on is listed here.
        </Card>
      ) : null}
      {drawer.status !== "open" && drawer.status !== "unknown" ? (
        <Card className="border-amber-500/50 bg-amber-500/10 text-sm">
          The day is not open here, so cash cannot be paid out.{" "}
          <Link className="font-medium underline" to={paths.drawer.open.href}>
            Open the day
          </Link>
        </Card>
      ) : null}
      {waitingToSend > 0 ? (
        <Card className="flex items-center justify-between gap-3 border-amber-500/50 bg-amber-500/10">
          <p className="text-sm">
            <strong>{waitingToSend}</strong> payout
            {waitingToSend > 1 ? "s" : ""} waiting to reach the server
          </p>
          <Button variant="secondary" onClick={() => void outbox.syncNow()}>
            Send now
          </Button>
        </Card>
      ) : null}

      <label className="relative block">
        <SearchIcon
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Receipt number, name or phone"
          aria-label="Search purchases waiting to be paid"
          className="min-h-11 w-full rounded-lg border border-border bg-card pl-9 pr-3 outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
        />
      </label>

      {query.error && rows.length === 0 ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {errorMessage(query.error)}
        </p>
      ) : null}

      {rows.length === 0 ? (
        query.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <EmptyState
            title={
              search.trim() ? "Nothing matches" : "Nothing waiting to be paid"
            }
            hint={
              search.trim()
                ? "Check the number, or ask the person who saved it. A purchase made without a connection shows here once it reaches the server."
                : "Purchases saved at another desk show up here as soon as they are saved."
            }
          />
        )
      ) : (
        <ul className="space-y-3">
          {rows.map((t) => {
            const mine = !!userName && t.createdBy === userName;
            const notSent = t.sync !== "synced";
            const blocked = mine && sameUserBlocked;
            return (
              <li key={t.id}>
                <Card className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold">
                        {t.customerName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-mono">
                          {t.reference ?? "Not numbered yet"}
                        </span>{" "}
                        · {recently(t.createdAt ?? t.capturedAt)}
                        {t.createdBy ? ` · ${t.createdBy}` : ""}
                      </p>
                      {t.customerPhone ? (
                        <p className="text-xs text-muted-foreground">
                          {t.customerPhone}
                        </p>
                      ) : null}
                    </div>
                    <p className="tnum shrink-0 text-xl font-black">
                      {cedis(t.payout.cashDue)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-1.5">
                      {notSent ? <Chip tone="amber">Not sent yet</Chip> : null}
                      {t.payments.some((p) => p.method !== "cash") ? (
                        <Chip tone="sky">Part paid another way</Chip>
                      ) : null}
                      {mine ? <Chip>You saved this</Chip> : null}
                    </div>
                    <div className="flex gap-2">
                      <Link to={paths.transactions.detail.to(t.id)}>
                        <Button variant="secondary">Details</Button>
                      </Link>
                      <Button disabled={blocked} onClick={() => setPaying(t)}>
                        Pay
                      </Button>
                    </div>
                  </div>
                  {blocked ? (
                    <p className="text-xs text-muted-foreground">
                      Another person has to pay this one out.
                    </p>
                  ) : null}
                  {notSent && !blocked ? (
                    <p className="text-xs text-muted-foreground">
                      Saved on this device. You can pay it now; both go to the
                      server in order.
                    </p>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {paying ? (
        <PayModal t={paying} open onClose={() => setPaying(null)} />
      ) : null}
    </div>
  );
}
