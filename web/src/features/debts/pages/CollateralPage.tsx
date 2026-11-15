import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Input, Modal, Segmented } from "antd";
import { SearchIcon } from "lucide-react";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { useAuth } from "@/features/auth/store";
import { Can } from "@/features/auth/useHasPermission";
import { cedis } from "@/features/calculator/format";
import { PhotoAttach } from "@/features/photos/PhotoAttach";
import { Kpi } from "@/features/dashboard/charts";
import { when } from "@/features/transactions/format";
import { errorMessage } from "@/shared/api/errors";
import { grams } from "@/shared/lib/numbers";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { Chip } from "@/shared/ui/Chip";
import { EmptyState } from "@/shared/ui/DataTable";
import { PageHeader } from "@/shared/ui/PageHeader";
import { useCollateral, useReturnCollateral } from "../api";
import {
  canHandBack,
  filterHeld,
  heldDays,
  heldText,
  owedOn,
  summarizeHeld,
  type HeldFilter,
} from "../collateralModel";
import type { Collateral } from "../schemas";

const FILTERS: { label: string; value: HeldFilter }[] = [
  { label: "Still held", value: "held" },
  { label: "Refined and bought", value: "converted" },
  { label: "Handed back", value: "returned" },
  { label: "All", value: "all" },
];

function HeldCard({
  c,
  onHandBack,
}: {
  c: Collateral;
  onHandBack: () => void;
}) {
  const owed = owedOn(c);
  const days = heldDays(c.receivedAt);
  const held = c.status === "held";
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{c.customer.name}</span>
            {c.photos === 0 ? <Chip tone="amber">No photo</Chip> : null}
            {c.status === "converted" ? (
              <Chip tone="green">Refined and bought</Chip>
            ) : c.status === "returned" ? (
              <Chip tone="grey">Handed back</Chip>
            ) : days >= 30 ? (
              <Chip tone="amber">{days} days</Chip>
            ) : (
              <Chip tone="sky">Held</Chip>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {c.customer.phone ?? "No phone"} · received {when(c.receivedAt)}
            {c.receivedBy ? ` by ${c.receivedBy.displayName}` : ""}
          </div>
          {c.description ? (
            <div className="mt-1 text-sm">{c.description}</div>
          ) : null}
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Top weight</div>
          <div className="tnum text-2xl font-bold">{grams(c.topWeight)}</div>
        </div>
      </div>

      <PhotoAttach
        target={{
          entityType: "collateral",
          entityId: c.id,
          slot: "collateral",
        }}
        title="Photo of the gold"
        branchName="Branch"
        reference={`Held · ${c.customer.name}`}
        emptyText="No photo"
        readOnly={!held}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted p-3 text-sm">
        <span className="text-muted-foreground">
          {held
            ? heldText(days)
            : c.closedAt
              ? `Closed ${when(c.closedAt)}`
              : ""}
        </span>
        {held ? (
          <span
            className={`tnum font-medium ${owed > 0 ? "text-amber-700" : "text-emerald-700"}`}
          >
            {owed > 0 ? `Loan still owed: ${cedis(owed)}` : "Loan fully paid"}
          </span>
        ) : c.convertedTransactionId ? (
          <Link
            className="underline"
            to={paths.transactions.detail.to(c.convertedTransactionId)}
          >
            See the purchase
          </Link>
        ) : c.closeNote ? (
          <span>{c.closeNote}</span>
        ) : null}
      </div>

      {held ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {owed > 0 ? (
            <span className="mr-auto text-xs text-muted-foreground">
              Handing back opens once the loan is paid.{" "}
              <Link to={paths.debts.href} className="underline">
                Debts and loans
              </Link>
            </span>
          ) : null}
          <Can permission={PERMISSIONS.DEBTS_MANAGE}>
            <Button
              variant="secondary"
              disabled={!canHandBack(c)}
              onClick={onHandBack}
            >
              Hand back
            </Button>
          </Can>
          <Can permission={PERMISSIONS.TRANSACTIONS_CREATE}>
            <Link to={paths.transactions.createFromHeld.to(c.id)}>
              <Button>Refine and buy</Button>
            </Link>
          </Can>
        </div>
      ) : null}
    </Card>
  );
}

export default function CollateralPage() {
  const branchId = useAuth((s) => s.activeBranchId);
  const [filter, setFilter] = useState<HeldFilter>("held");
  const [q, setQ] = useState("");
  const list = useCollateral({ branchId });
  const [giveBack, setGiveBack] = useState<Collateral | null>(null);
  const [note, setNote] = useState("");
  const ret = useReturnCollateral();
  const all = useMemo(() => list.data ?? [], [list.data]);
  const sum = useMemo(() => summarizeHeld(all), [all]);
  const rows = useMemo(() => filterHeld(all, filter, q), [all, filter, q]);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-3 pb-8 sm:p-4 lg:p-6">
      <PageHeader
        title="Held gold"
        subtitle="Unrefined gold customers left as security for a loan. It has no value until it is refined and bought."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Pieces held" value={sum.pieces} />
        <Kpi label="Top weight held" value={grams(sum.weight)} />
        <Kpi
          label="Loans against it"
          value={cedis(sum.owed)}
          sub={
            <span className="text-xs text-muted-foreground">Still owed</span>
          }
        />
        <Kpi
          label="Longest held"
          value={
            sum.pieces
              ? `${sum.longest} day${sum.longest === 1 ? "" : "s"}`
              : "—"
          }
        />
      </div>

      <div className="overflow-x-auto">
        <Segmented<HeldFilter>
          value={filter}
          onChange={setFilter}
          options={FILTERS}
        />
      </div>
      {all.length > 5 ? (
        <label className="relative block">
          <span className="sr-only">Search held gold</span>
          <SearchIcon
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            className="min-h-11 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            placeholder="Search by name, phone or description"
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
          title={
            q
              ? "No match"
              : filter === "held"
                ? "No gold is held"
                : "Nothing here"
          }
          hint={
            q
              ? "Try another name."
              : "When a customer leaves unrefined gold as security for a loan, it appears here."
          }
        />
      ) : null}

      <ul className="space-y-3">
        {rows.map((c) => (
          <li key={c.id}>
            <HeldCard
              c={c}
              onHandBack={() => {
                setNote("");
                setGiveBack(c);
              }}
            />
          </li>
        ))}
      </ul>

      <Modal
        open={!!giveBack}
        title={
          giveBack
            ? `Hand back ${grams(giveBack.topWeight)} to ${giveBack.customer.name}`
            : ""
        }
        onCancel={() => setGiveBack(null)}
        okText="Hand back"
        okButtonProps={{ loading: ret.isPending }}
        onOk={() =>
          giveBack &&
          ret.mutate(
            { id: giveBack.id, note: note.trim() || null },
            { onSuccess: () => setGiveBack(null) },
          )
        }
        destroyOnHidden
      >
        <p className="mb-3 text-sm text-muted-foreground">
          Use this when the gold goes back to the customer unrefined. It is only
          allowed once the loan has been fully paid.
        </p>
        <Input.TextArea
          rows={2}
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
        />
        {ret.error ? (
          <p className="mt-2 text-sm text-red-600">{ret.error.message}</p>
        ) : null}
      </Modal>
    </div>
  );
}
