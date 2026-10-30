import { useState } from "react";
import { Alert, Drawer, Modal, Segmented } from "antd";
import { SearchIcon } from "lucide-react";
import { useBranchNames } from "@/features/branches/api";
import { Kpi } from "@/features/dashboard/charts";
import { EmptyState, Pager } from "@/shared/ui/DataTable";
import { cedis } from "@/features/calculator/format";
import { when } from "@/features/transactions/format";
import { Link } from "react-router-dom";
import paths from "@/config/paths";
import { errorMessage } from "@/shared/api/errors";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { PageHeader } from "@/shared/ui/PageHeader";
import { SelectField } from "@/shared/ui/SelectField";
import { TextField } from "@/shared/ui/TextField";
import { useCase, useCaseAction, useCases } from "../api";
import {
  actionLabel,
  assetLabel,
  CaseStatusChip,
  kindLabel,
  resolutionLabel,
} from "../labels";
import {
  direction,
  filterCases,
  isClosed,
  NO_CASE_FILTERS,
  openFor,
  summarizeCases,
  type CaseFilters,
  type CaseSort,
} from "../model";
import { RESOLUTION_TYPES, type Case } from "../schemas";

type View = "active" | "resolved" | "all";
const figure = (c: Case, v: string | null | undefined) => {
  if (v == null) return "—";
  return c.asset === "cash" ||
    c.asset === "goods_value" ||
    c.asset === "debt" ||
    c.asset === "payable"
    ? cedis(Number(v))
    : `${v} g`;
};

function CaseDrawer({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const detail = useCase(id);
  const act = useCaseAction();
  const [dialog, setDialog] = useState<"note" | "resolve" | "reopen" | null>(
    null,
  );
  const [text, setText] = useState("");
  const [type, setType] = useState<string>("explained");
  const c = detail.data;
  const close = () => {
    setDialog(null);
    setText("");
  };
  const closed = c
    ? c.status === "resolved" || c.status === "written_off"
    : false;

  const submit = () => {
    if (!c || !dialog) return;
    const data =
      dialog === "resolve"
        ? ({
            action: "resolve",
            resolutionType: type,
            summary: text.trim(),
          } as const)
        : ({ action: dialog, note: text.trim() } as const);
    act.mutate({ id: c.id, data }, { onSuccess: close });
  };

  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      size="large"
      title={
        c ? `${kindLabel[c.kind] ?? c.kind} · ${c.branchName ?? ""}` : "Case"
      }
    >
      {detail.error ? (
        <Alert type="error" showIcon title={errorMessage(detail.error)} />
      ) : null}
      {c ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <CaseStatusChip status={c.status} />
            <span className="text-xs text-muted-foreground">
              Opened {when(c.openedAt)}
              {c.businessDate ? ` · day ${c.businessDate}` : ""}
            </span>
          </div>
          <Card className="space-y-1 text-sm">
            <div className="font-medium">
              {c.asset ? (assetLabel[c.asset] ?? c.asset) : "General"}
            </div>
            <dl className="tnum grid grid-cols-3 gap-2">
              <div>
                <dt className="text-muted-foreground">Books said</dt>
                <dd className="font-semibold">{figure(c, c.expected)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Reported</dt>
                <dd className="font-semibold">{figure(c, c.actual)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Difference</dt>
                <dd
                  className={`font-semibold ${direction(c) === "short" ? "text-red-700" : direction(c) === "over" ? "text-emerald-700" : ""}`}
                >
                  {figure(c, c.difference)}
                </dd>
              </div>
            </dl>
            {c.reportedExplanation ? (
              <p className="pt-2">
                <span className="text-muted-foreground">
                  Their explanation:{" "}
                </span>
                {c.reportedExplanation}
              </p>
            ) : null}
            {c.transferId ? (
              <Link
                className="block pt-1 underline"
                to={paths.transfers.detail.to(c.transferId)}
              >
                Open transfer {c.transferReference}
              </Link>
            ) : null}
            {c.assignedTo ? (
              <p className="pt-1 text-muted-foreground">
                Looked after by {c.assignedTo.displayName}
              </p>
            ) : null}
          </Card>
          {closed ? (
            <Alert
              type="success"
              showIcon
              title={`${resolutionLabel[c.resolutionType ?? ""] ?? "Closed"} · ${c.resolvedBy?.displayName ?? ""}`}
              description={c.resolutionSummary}
            />
          ) : null}

          <div className="flex flex-wrap gap-2">
            {!closed && c.status === "open" ? (
              <Button
                loading={act.isPending}
                onClick={() =>
                  act.mutate({ id: c.id, data: { action: "take" } })
                }
              >
                Take this case
              </Button>
            ) : null}
            {!closed ? (
              <Button variant="secondary" onClick={() => setDialog("note")}>
                Add a note
              </Button>
            ) : null}
            {!closed ? (
              <Button variant="secondary" onClick={() => setDialog("resolve")}>
                Resolve
              </Button>
            ) : null}
            {closed ? (
              <Button variant="secondary" onClick={() => setDialog("reopen")}>
                Reopen
              </Button>
            ) : null}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">History</h3>
            <ul className="space-y-2">
              {c.actions.map((a) => (
                <li
                  key={a.id}
                  className="rounded-lg border border-border p-2 text-sm"
                >
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">
                      {actionLabel[a.type] ?? a.type}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {when(a.at)}
                    </span>
                  </div>
                  {a.toStatus && a.fromStatus !== a.toStatus ? (
                    <div className="text-xs text-muted-foreground">
                      {a.fromStatus ?? "new"} → {a.toStatus}
                    </div>
                  ) : null}
                  {a.note ? <p>{a.note}</p> : null}
                  {a.by ? (
                    <div className="text-xs text-muted-foreground">
                      {a.by.displayName}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>

          <Modal
            open={dialog !== null}
            onCancel={close}
            onOk={submit}
            confirmLoading={act.isPending}
            okText={
              dialog === "resolve"
                ? "Resolve"
                : dialog === "reopen"
                  ? "Reopen"
                  : "Add note"
            }
            title={
              dialog === "resolve"
                ? "Resolve this case"
                : dialog === "reopen"
                  ? "Reopen this case"
                  : "Add a note"
            }
            okButtonProps={{
              disabled:
                text.trim().length <
                (dialog === "resolve" ? 10 : dialog === "reopen" ? 5 : 3),
            }}
          >
            <div className="space-y-3">
              {dialog === "resolve" ? (
                <SelectField
                  label="How was it resolved?"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                >
                  {RESOLUTION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {resolutionLabel[t]}
                    </option>
                  ))}
                </SelectField>
              ) : null}
              <TextField
                label={
                  dialog === "resolve"
                    ? "What was found and decided"
                    : dialog === "reopen"
                      ? "Why is it reopened?"
                      : "Note"
                }
                hint={
                  dialog === "resolve"
                    ? "At least 10 characters. This stays on record."
                    : undefined
                }
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              {dialog === "resolve" ? (
                <p className="text-xs text-muted-foreground">
                  Closing already posted an adjustment so the books match the
                  count. Resolving records your decision; it does not move
                  money.
                </p>
              ) : null}
              {act.error ? (
                <Alert type="error" showIcon title={errorMessage(act.error)} />
              ) : null}
            </div>
          </Modal>
        </div>
      ) : null}
    </Drawer>
  );
}

const PAGE = 12;
const SORTS: [CaseSort, string][] = [
  ["newest", "Newest"],
  ["oldest", "Oldest"],
  ["biggest", "Biggest"],
];

function DiffFigure({ c }: { c: Case }) {
  const d = direction(c);
  const text =
    c.difference == null
      ? "—"
      : `${d === "over" ? "+" : ""}${figure(c, c.difference)}`;
  return (
    <div className="text-right">
      <p
        className={`tnum text-lg font-bold ${d === "short" ? "text-red-700" : d === "over" ? "text-emerald-700" : ""}`}
      >
        {text}
      </p>
      <p className="text-xs text-muted-foreground">
        {d === "short" ? "short" : d === "over" ? "over" : ""}
      </p>
    </div>
  );
}

export default function DiscrepanciesPage() {
  const [view, setView] = useState<View>("active");
  const [openId, setOpenId] = useState<string | null>(null);
  const [f, setF] = useState<CaseFilters>(NO_CASE_FILTERS);
  const [page, setPage] = useState(1);
  const list = useCases({ status: view });
  const names = useBranchNames();
  const all = (list.data ?? []).filter((c) =>
    view === "resolved" ? isClosed(c) : true,
  );
  const stats = summarizeCases(all);
  const rows = filterCases(all, f);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(page, pages);
  const shown = rows.slice((cur - 1) * PAGE, cur * PAGE);
  const set = (patch: Partial<CaseFilters>) => {
    setF({ ...f, ...patch });
    setPage(1);
  };
  const kinds = [...new Set(all.map((c) => c.kind))];
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 pb-8">
      <PageHeader
        title="Differences"
        subtitle="Differences found when counting, closing or receiving, waiting for a decision."
      />
      <Segmented
        value={view}
        onChange={(v) => {
          setView(v as View);
          setPage(1);
        }}
        options={[
          { label: "Needs attention", value: "active" },
          { label: "Closed", value: "resolved" },
          { label: "All", value: "all" },
        ]}
      />
      {list.error ? (
        <Alert type="error" showIcon title={errorMessage(list.error)} />
      ) : null}
      {view !== "resolved" && list.data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi
            label="Waiting"
            value={stats.live}
            sub={
              <span className="text-xs text-muted-foreground">
                {stats.untouched} untouched · {stats.beingLookedAt} being looked
                at
              </span>
            }
          />
          <Kpi
            label="Net cash difference"
            value={`${stats.netCash > 0 ? "+" : ""}${cedis(stats.netCash)}`}
            sub={
              <span className="text-xs text-muted-foreground">
                {stats.netCash < 0
                  ? "short overall"
                  : stats.netCash > 0
                    ? "over overall"
                    : "balanced"}
              </span>
            }
          />
          <Kpi
            label="Oldest waiting"
            value={
              stats.oldestDays == null
                ? "—"
                : `${stats.oldestDays} day${stats.oldestDays === 1 ? "" : "s"}`
            }
          />
          <Kpi label="Shown" value={rows.length} />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <SearchIcon
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            className="min-h-11 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            placeholder="Search branch, transfer, person or explanation"
            value={f.q}
            onChange={(e) => set({ q: e.target.value })}
          />
        </div>
        <select
          aria-label="Branch"
          className="min-h-11 rounded-lg border border-border bg-card px-3 text-sm"
          value={f.branch}
          onChange={(e) => set({ branch: e.target.value })}
        >
          <option value="">Every branch</option>
          {Object.entries(names).map(([id, n]) => (
            <option key={id} value={id}>
              {n}
            </option>
          ))}
        </select>
        <select
          aria-label="Kind"
          className="min-h-11 rounded-lg border border-border bg-card px-3 text-sm"
          value={f.kind}
          onChange={(e) => set({ kind: e.target.value })}
        >
          <option value="">Every kind</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {kindLabel[k] ?? k}
            </option>
          ))}
        </select>
        <Segmented
          value={f.sort}
          onChange={(v) => set({ sort: v as CaseSort })}
          options={SORTS.map(([value, label]) => ({ value, label }))}
        />
      </div>

      {list.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : null}
      {!list.isLoading && rows.length === 0 ? (
        <EmptyState
          title={
            all.length
              ? "Nothing matches"
              : view === "active"
                ? "Nothing needs attention"
                : "No cases"
          }
          hint={
            all.length
              ? "Try another search or filter."
              : view === "active"
                ? "Every difference has been looked at."
                : undefined
          }
          action={
            all.length ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setF(NO_CASE_FILTERS);
                  setPage(1);
                }}
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="space-y-3">
          {shown.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setOpenId(c.id)}
                className="block w-full rounded-xl border border-border bg-card p-4 text-left transition-shadow hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {kindLabel[c.kind] ?? c.kind}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {c.branchName}
                      {c.asset ? ` · ${assetLabel[c.asset] ?? c.asset}` : ""}
                      {c.businessDate ? ` · day ${c.businessDate}` : ""}
                    </p>
                  </div>
                  <DiffFigure c={c} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <CaseStatusChip status={c.status} />
                  <span className="text-xs text-muted-foreground">
                    {isClosed(c)
                      ? `Closed ${c.resolvedAt ? when(c.resolvedAt) : ""}`
                      : openFor(c.openedAt)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {c.assignedTo
                      ? `Looked after by ${c.assignedTo.displayName}`
                      : isClosed(c)
                        ? ""
                        : "Nobody has taken it yet"}
                  </span>
                  {c.transferReference ? (
                    <span className="text-xs text-muted-foreground">
                      Transfer {c.transferReference}
                    </span>
                  ) : null}
                </div>
                {c.reportedExplanation ? (
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                    “{c.reportedExplanation}”
                  </p>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      {rows.length > PAGE ? (
        <Pager
          text={`${(cur - 1) * PAGE + 1}–${Math.min(rows.length, cur * PAGE)} of ${rows.length}`}
          page={cur}
          pages={pages}
          onPage={setPage}
        />
      ) : null}
      <CaseDrawer id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
