import { useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Modal } from "antd";
import { Building2, ChevronRight } from "lucide-react";
import { useCashOverview } from "@/features/cash/api";
import { clock, grandTotal } from "@/features/cash/model";
import { cedis } from "@/features/calculator/format";
import { Kpi } from "@/features/dashboard/charts";
import { Chip } from "@/shared/ui/Chip";
import paths from "@/config/paths";
import { errorMessage } from "@/shared/api/errors";
import { Button } from "@/shared/ui/Button";
import { PageHeader } from "@/shared/ui/PageHeader";
import {
  useManagedBranches,
  useUpdateBranch,
  type ManagedBranch,
} from "../api";
import { BranchModal } from "../BranchModal";

export default function BranchesPage() {
  const list = useManagedBranches();
  const update = useUpdateBranch();
  const cash = useCashOverview(null);
  const cashById = new Map(
    (cash.data?.branches ?? []).map((c) => [c.branchId, c]),
  );
  const [editing, setEditing] = useState<{
    branch: ManagedBranch | null;
  } | null>(null);
  const [toggle, setToggle] = useState<ManagedBranch | null>(null);
  const [added, setAdded] = useState<ManagedBranch | null>(null);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 pb-8">
      <PageHeader
        title="Branches"
        subtitle="Where the business buys gold. A switched-off branch keeps its history but takes no new work."
        actions={
          <Button onClick={() => setEditing({ branch: null })}>
            Add a branch
          </Button>
        }
      />
      {list.error ? (
        <Alert type="error" showIcon title={errorMessage(list.error)} />
      ) : null}
      {list.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : null}
      {list.data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi
            label="Active branches"
            value={list.data.filter((b) => b.isActive).length}
            sub={
              <span className="text-xs text-muted-foreground">
                {list.data.length - list.data.filter((b) => b.isActive).length}{" "}
                switched off
              </span>
            }
          />
          <Kpi
            label="Days open now"
            value={list.data.filter((b) => b.dayOpen).length}
          />
          <Kpi
            label="Cash across branches"
            value={cash.data ? cedis(grandTotal(cash.data.branches)) : "—"}
            sub={
              cash.data ? (
                <span className="text-xs text-muted-foreground">
                  as of {clock(cash.data.asOf)}
                </span>
              ) : undefined
            }
          />
          <Kpi
            label="Time zones"
            value={new Set(list.data.map((b) => b.timezone)).size}
          />
        </div>
      ) : null}
      <ul className="grid gap-3 sm:grid-cols-2">
        {(list.data ?? []).map((b) => {
          const c = cashById.get(b.id);
          return (
            <li
              key={b.id}
              className={`rounded-xl border border-border bg-card ${b.isActive ? "" : "opacity-70"}`}
            >
              <Link
                to={paths.people.branch.to(b.id)}
                className="block rounded-t-xl p-4 hover:bg-muted/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-navy text-white">
                      <Building2 className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{b.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {b.code} · {b.timezone}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="mt-2 size-4 shrink-0 text-muted-foreground" />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {b.isMain ? <Chip tone="amber">Main</Chip> : null}
                  {b.isActive ? (
                    <Chip tone="green">Active</Chip>
                  ) : (
                    <Chip>Switched off</Chip>
                  )}
                  {b.dayOpen ? <Chip tone="sky">Day open</Chip> : null}
                </div>
                {c ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Cash{" "}
                    <span className="font-semibold text-foreground tabular-nums">
                      {cedis(c.cashValue)}
                    </span>
                  </p>
                ) : null}
              </Link>
              <div className="flex justify-end gap-2 border-t border-border px-3 py-2">
                <Button
                  variant="secondary"
                  onClick={() => setEditing({ branch: b })}
                >
                  Edit
                </Button>
                {!b.isMain ? (
                  <Button
                    variant="ghost"
                    disabled={b.isActive && b.dayOpen}
                    title={
                      b.isActive && b.dayOpen
                        ? "Close its day first"
                        : undefined
                    }
                    onClick={() => setToggle(b)}
                  >
                    {b.isActive ? "Switch off" : "Switch on"}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <BranchModal
        open={!!editing}
        branch={editing?.branch ?? null}
        onClose={() => setEditing(null)}
        onDone={(b) => {
          const wasNew = !editing?.branch;
          setEditing(null);
          if (wasNew) setAdded(b);
        }}
      />

      <Modal
        open={!!added}
        title={added ? `${added.name} is ready` : ""}
        onCancel={() => setAdded(null)}
        footer={<Button onClick={() => setAdded(null)}>Done</Button>}
        destroyOnHidden
      >
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>
            <Link className="underline" to={paths.people.users.href}>
              Users
            </Link>
            : give each person who works there this branch. Directors see every
            branch but must sign out and in once.
          </li>
          <li>
            <Link className="underline" to={paths.prices.href}>
              Prices
            </Link>
            : set the branch's margin, so purchases there have a price.
          </li>
          <li>The branch opens its first day from the Cash drawer.</li>
        </ol>
      </Modal>

      <Modal
        open={!!toggle}
        title={
          toggle
            ? `${toggle.isActive ? "Switch off" : "Switch on"} ${toggle.name}?`
            : ""
        }
        onCancel={() => setToggle(null)}
        okText={toggle?.isActive ? "Switch off" : "Switch on"}
        okButtonProps={{
          danger: !!toggle?.isActive,
          loading: update.isPending,
        }}
        onOk={() =>
          toggle &&
          update.mutate(
            { id: toggle.id, changes: { isActive: !toggle.isActive } },
            { onSuccess: () => setToggle(null) },
          )
        }
        destroyOnHidden
      >
        <p className="text-sm text-muted-foreground">
          {toggle?.isActive
            ? "People can no longer work in this branch. Its history stays."
            : "The branch takes work again."}
        </p>
        {update.error ? (
          <p className="mt-2 text-sm text-red-600">{update.error.message}</p>
        ) : null}
      </Modal>
    </div>
  );
}
