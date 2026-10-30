import { Link, useParams } from "react-router-dom";
import { Alert } from "antd";
import { ArrowLeft, RefreshCw } from "lucide-react";
import paths from "@/config/paths";
import { cedis } from "@/features/calculator/format";
import { clock, sinceText } from "@/features/cash/model";
import { Kpi, Panel } from "@/features/dashboard/charts";
import { when } from "@/features/transactions/format";
import { errorMessage } from "@/shared/api/errors";
import { ago, initials } from "@/shared/lib/dates";
import { Chip } from "@/shared/ui/Chip";
import { PageHeader } from "@/shared/ui/PageHeader";
import { useBranchOverview } from "../api";
import { attentionItems, groupWorkers } from "../model";

const tone = {
  amber: "bg-amber-500/15 text-amber-900",
  red: "bg-red-500/15 text-red-800",
  sky: "bg-sky-500/15 text-sky-900",
};

export default function BranchDetailPage() {
  const { id } = useParams();
  const q = useBranchOverview(id);
  const o = q.data;
  console.log("error: ",q.error)
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 pb-8">
      <Link
        to={paths.people.branches.href}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Branches
      </Link>
      {q.error && !o ? (
        <Alert type="error" showIcon title={errorMessage(q.error)} />
      ) : null}
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : null}
      {o ? (
        <>
          <PageHeader
            title={o.branch.name}
            subtitle={`${o.branch.code} · ${o.branch.timezone}`}
            actions={
              <>
                {o.branch.isMain ? <Chip tone="amber">Main</Chip> : null}
                {o.branch.isActive ? (
                  <Chip tone="green">Active</Chip>
                ) : (
                  <Chip>Switched off</Chip>
                )}
                {o.openDay ? (
                  <Chip tone="sky">
                    Day open since {clock(o.openDay.openedAt)}
                  </Chip>
                ) : (
                  <Chip>No day open</Chip>
                )}
              </>
            }
          />

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              label="Cash on hand"
              value={cedis(o.snapshot.cash)}
              sub={
                <span className="text-xs text-muted-foreground">
                  Notes: see the Cash tab
                </span>
              }
            />
            <Kpi
              label="Gold in stock"
              value={cedis(o.snapshot.goodsValue)}
              sub={
                <span className="text-xs text-muted-foreground">
                  {Number(o.snapshot.goodsTop).toFixed(2)} g top ·{" "}
                  {Number(o.snapshot.goodsDown).toFixed(2)} g down
                </span>
              }
            />
            <Kpi
              label="Owed to us"
              value={cedis(o.debts.owedToUs)}
              sub={
                <span className="text-xs text-muted-foreground">
                  {o.debts.overdue > 0
                    ? `${o.debts.overdue} overdue`
                    : "none overdue"}
                </span>
              }
            />
            <Kpi
              label="We owe"
              value={cedis(o.debts.weOwe)}
              sub={
                <span className="text-xs text-muted-foreground">
                  Customers to pay: {cedis(o.snapshot.payable)}
                </span>
              }
            />
          </div>

          {(() => {
            const items = attentionItems(o.attention, o.debts.overdue);
            return (
              <Panel title="Needs attention">
                {items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing is waiting on this branch.
                  </p>
                ) : (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {items.map((i) => (
                      <li
                        key={i.key}
                        className={`rounded-lg px-3 py-2 text-sm ${tone[i.tone]}`}
                      >
                        {i.label}
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            );
          })()}

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={`People here (${o.workers.length})`}>
              {o.workers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nobody active works here yet.
                </p>
              ) : (
                <div className="space-y-4">
                  {groupWorkers(o.workers).map((g) => (
                    <div key={g.key}>
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {g.name}s · {g.people.length}
                      </p>
                      <ul className="space-y-1">
                        {g.people.map((w) => (
                          <li
                            key={w.id}
                            className="flex items-center gap-3 rounded-lg px-1 py-1.5"
                          >
                            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-navy text-xs font-semibold text-white">
                              {initials(w.name)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">
                                {w.name}
                                {w.isPrimary ? (
                                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                                    home branch
                                  </span>
                                ) : null}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {w.phone || w.username || ""}
                              </p>
                            </div>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {w.lastLoginAt
                                ? `seen ${ago(w.lastLoginAt).toLowerCase()}`
                                : "never signed in"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Today">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-xl font-bold tabular-nums">
                    {o.today.count}
                  </p>
                  <p className="text-xs text-muted-foreground">purchases</p>
                </div>
                <div>
                  <p className="text-xl font-bold tabular-nums">
                    {cedis(o.today.paid)}
                  </p>
                  <p className="text-xs text-muted-foreground">paid out</p>
                </div>
                <div>
                  <p className="text-xl font-bold tabular-nums">
                    {o.today.voided}
                  </p>
                  <p className="text-xs text-muted-foreground">voided</p>
                </div>
              </div>
              <p className="mb-1 mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Latest purchases
              </p>
              {o.recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">None yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {o.recent.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center justify-between gap-2 py-1.5 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="truncate">
                          {t.customerName || t.reference || "Walk-in"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {when(t.capturedAt)}
                        </p>
                      </div>
                      <span className="tabular-nums font-medium">
                        {cedis(t.payable)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <Panel title="Recent days">
            {o.recentDays.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No day has been opened yet.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {o.recentDays.map((d) => {
                  const diff = Number(d.cashDifference ?? 0);
                  return (
                    <li
                      key={d.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                    >
                      <span className="font-medium">{d.date}</span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Chip tone={d.status === "open" ? "sky" : "grey"}>
                          {d.status}
                        </Chip>
                        {d.signoff ? (
                          <Chip
                            tone={d.signoff === "pending" ? "amber" : "green"}
                          >
                            sign-off {d.signoff}
                          </Chip>
                        ) : null}
                        {diff !== 0 ? (
                          <Chip tone="red">
                            {diff < 0 ? "short" : "over"}{" "}
                            {cedis(Math.abs(diff))}
                          </Chip>
                        ) : null}
                        {d.differences > 0 ? (
                          <Chip tone="red">
                            {d.differences} difference
                            {d.differences === 1 ? "" : "s"}
                          </Chip>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <div className="flex items-start gap-2 rounded-lg bg-muted p-2 text-xs text-muted-foreground">
            <p className="flex-1">
              Fetched at {clock(o.asOf)} ({sinceText(o.asOf)})
              {q.isFetching ? " · refreshing…" : ""}. Work done on a device that
              has not synced yet is not included.
            </p>
            <button
              type="button"
              aria-label="Refresh"
              className="grid size-8 shrink-0 place-items-center rounded-md hover:bg-background"
              onClick={() => void q.refetch()}
            >
              <RefreshCw
                className={`size-4 ${q.isFetching ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
