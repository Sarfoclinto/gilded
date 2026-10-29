import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Alert, Input, Modal, Segmented } from "antd";
import { ChevronDownIcon } from "lucide-react";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { useAuth } from "@/features/auth/store";
import { useHasPermission } from "@/features/auth/useHasPermission";
import { cedis } from "@/features/calculator/format";
import { Kpi } from "@/features/dashboard/charts";
import { errorMessage } from "@/shared/api/errors";
import { useApiMutation } from "@/shared/api/hooks";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { Chip, type ChipTone } from "@/shared/ui/Chip";
import { EmptyState, Pager } from "@/shared/ui/DataTable";
import { PageHeader } from "@/shared/ui/PageHeader";
import { dayKeys, daysApi } from "../api";
import { figureLabel, figureUnit } from "../closing";
import {
  differingFigures,
  filterDays,
  summarizeDays,
  type DayFilter,
} from "../dayModel";
import { dayFlagText, linesText, signoffText } from "../format";
import { useDayHistory } from "../hooks";
import type { Day, Figure } from "../schemas";

const PAGE = 15;
const FILTERS: DayFilter[] = ["all", "pending", "differences"];
const tone: Record<string, ChipTone> = {
  not_required: "green",
  pending: "amber",
  approved: "green",
  rejected: "red",
};
const show = (f: Figure, v: string) =>
  figureUnit[f] === "g" ? `${Number(v)} g` : cedis(Number(v));
const dateText = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-GH", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

function Detail({ day }: { day: Day }) {
  const c = day.closing;
  if (!c)
    return (
      <p className="text-sm text-muted-foreground">
        Still open. Opened with {linesText(day.opening.lines)} (
        {day.opening.source === "carried" ? "same as the books" : "counted"}).
      </p>
    );
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {c.figures.map((f) => (
          <div
            key={f.asset}
            className={`rounded-lg border p-3 text-sm ${f.outcome === "balanced" ? "border-border" : f.outcome === "shortage" ? "border-red-400/60 bg-red-500/5" : "border-amber-400/60 bg-amber-500/5"}`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium">{figureLabel[f.asset]}</span>
              {f.outcome === "balanced" ? (
                <Chip tone="green">Matches</Chip>
              ) : (
                <Chip tone={f.outcome === "shortage" ? "red" : "amber"}>
                  {f.outcome === "shortage" ? "Short" : "Over"}{" "}
                  {show(f.asset, f.difference.replace("-", ""))}
                </Chip>
              )}
            </div>
            <dl className="tnum mt-1 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div>
                <dt>Books</dt>
                <dd className="text-sm text-foreground">
                  {show(f.asset, f.expected)}
                </dd>
              </div>
              <div>
                <dt>Counted</dt>
                <dd className="text-sm text-foreground">
                  {show(f.asset, f.actual)}
                </dd>
              </div>
            </dl>
            {f.explanation ? (
              <p className="mt-2 text-xs">“{f.explanation}”</p>
            ) : null}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Opened by {day.openedBy.displayName}. Closed by {c.closedBy.displayName}
        , {stamp(c.closedAt)}. Confirmation {c.confirmation.version}: “
        {c.confirmation.text}”
      </p>
      {c.signoff.status !== "not_required" && c.signoff.at ? (
        <p className="text-xs text-muted-foreground">
          {signoffText[c.signoff.status]} by {c.signoff.by?.displayName},{" "}
          {stamp(c.signoff.at)}
          {c.signoff.note ? ` — “${c.signoff.note}”` : ""}
        </p>
      ) : null}
    </div>
  );
}

export default function DayHistoryPage() {
  const branchId = useAuth((s) => s.activeBranchId);
  const me = useAuth((s) => s.user?.id);
  const canSign = useHasPermission(PERMISSIONS.DAYS_SIGNOFF);
  const [sp, setSp] = useSearchParams();
  const filter = FILTERS.find((f) => f === sp.get("show")) ?? "all";
  const page = Math.max(1, Number.parseInt(sp.get("page") ?? "1", 10) || 1);
  const history = useDayHistory({ branchId });
  const [openId, setOpenId] = useState<string | null>(null);
  const [target, setTarget] = useState<{
    day: Day;
    decision: "approved" | "rejected";
  } | null>(null);
  const [note, setNote] = useState("");

  const all = useMemo(() => history.data ?? [], [history.data]);
  const sum = useMemo(() => summarizeDays(all), [all]);
  const rows = useMemo(() => filterDays(all, filter), [all, filter]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const set = (show: string, p = "") => {
    const next = new URLSearchParams(sp);
    if (show && show !== "all") next.set("show", show);
    else next.delete("show");
    if (p) next.set("page", p);
    else next.delete("page");
    setSp(next, { replace: true });
  };

  const sign = useApiMutation({
    mutationFn: (v: {
      id: string;
      decision: "approved" | "rejected";
      note: string | null;
    }) => daysApi.signoff(v.id, v.decision, v.note),
    invalidates: [dayKeys.all],
    successMessage: "Saved",
    onSuccess: () => {
      setTarget(null);
      setNote("");
    },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-3 pb-8 sm:p-4 lg:p-6">
      <PageHeader
        title="Day history"
        subtitle="Every day the drawer was opened and closed, and what was counted."
        actions={
          <Link to={paths.drawer.home.href}>
            <Button variant="secondary">Cash drawer</Button>
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Days"
          value={sum.days}
          sub={
            <span className="text-xs text-muted-foreground">
              Latest 60 shown
            </span>
          }
        />
        <button
          type="button"
          className="text-left"
          onClick={() => set("pending")}
        >
          <Kpi
            label="Waiting for sign-off"
            value={sum.waiting}
            sub={
              <span className="text-xs text-muted-foreground">
                {sum.waiting ? "Needs a manager" : "Nothing waiting"}
              </span>
            }
          />
        </button>
        <button
          type="button"
          className="text-left"
          onClick={() => set("differences")}
        >
          <Kpi
            label="With differences"
            value={sum.withDifferences}
            sub={
              <span className="text-xs text-muted-foreground">
                Did not match the books
              </span>
            }
          />
        </button>
        <Kpi
          label="Cash difference, net"
          value={
            <span className={sum.cashNet < 0 ? "text-red-600" : ""}>
              {sum.cashNet === 0
                ? "GHS 0"
                : `${sum.cashNet < 0 ? "−" : "+"}${cedis(Math.abs(sum.cashNet))}`}
            </span>
          }
          sub={
            <span className="text-xs text-muted-foreground">
              Counted minus books
            </span>
          }
        />
      </div>

      <div className="overflow-x-auto">
        <Segmented<DayFilter>
          value={filter}
          onChange={(v) => set(v)}
          options={[
            { label: "All days", value: "all" },
            { label: "Waiting for sign-off", value: "pending" },
            { label: "With differences", value: "differences" },
          ]}
        />
      </div>
      {history.error ? (
        <Alert type="error" showIcon title={errorMessage(history.error)} />
      ) : null}

      {history.isLoading ? (
        <div
          className="h-40 animate-pulse rounded-xl border border-border bg-muted/50"
          aria-busy="true"
        />
      ) : null}
      {!history.isLoading && rows.length === 0 ? (
        <EmptyState
          title={
            filter === "pending"
              ? "Nothing is waiting for sign-off"
              : filter === "differences"
                ? "No day had a difference"
                : "No days yet"
          }
          hint={
            filter === "all"
              ? "A day appears here once it has been opened."
              : "Every day so far matched, or is already signed off."
          }
        />
      ) : null}

      <ul className="space-y-2">
        {shown.map((d) => {
          const bad = differingFigures(d);
          const status = d.closing?.signoff.status;
          const isOpen = openId === d.id;
          const own = d.closing?.closedBy.id === me;
          const pending = status === "pending";
          return (
            <li key={d.id}>
              <Card className={`p-0 ${pending ? "border-amber-400/70" : ""}`}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpenId(isOpen ? null : d.id)}
                  className="flex w-full items-center gap-3 p-3 text-left sm:p-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">
                        {dateText(d.businessDate)}
                      </span>
                      {!d.closing ? (
                        <Chip tone="sky">Open</Chip>
                      ) : (
                        <Chip tone={tone[status ?? "not_required"] ?? "grey"}>
                          {signoffText[status ?? "not_required"]}
                        </Chip>
                      )}
                      {d.flags.map((f) => (
                        <Chip key={f} tone="amber">
                          {dayFlagText[f] ?? f}
                        </Chip>
                      ))}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Opened by {d.openedBy.displayName}
                      {d.closing
                        ? ` · ${bad.length ? `${bad.length} figure${bad.length > 1 ? "s" : ""} differ` : "everything matched"}`
                        : ""}
                    </div>
                  </div>
                  <ChevronDownIcon
                    className={`size-5 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                    aria-hidden
                  />
                </button>
                {canSign && pending ? (
                  <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-3 py-2 sm:px-4">
                    {own ? (
                      <span className="mr-auto text-xs text-muted-foreground">
                        You closed this day, so someone else must sign it off.
                      </span>
                    ) : null}
                    <Button
                      variant="secondary"
                      disabled={own}
                      onClick={() =>
                        setTarget({ day: d, decision: "rejected" })
                      }
                    >
                      Reject
                    </Button>
                    <Button
                      disabled={own}
                      onClick={() =>
                        setTarget({ day: d, decision: "approved" })
                      }
                    >
                      Approve
                    </Button>
                  </div>
                ) : null}
                {isOpen ? (
                  <div className="border-t border-border p-3 sm:p-4">
                    <Detail day={d} />
                  </div>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ul>
      {rows.length > PAGE ? (
        <Pager
          text={`${(page - 1) * PAGE + 1}–${Math.min(rows.length, page * PAGE)} of ${rows.length}`}
          page={page}
          pages={pages}
          onPage={(p) => set(filter, String(p))}
        />
      ) : null}

      <Modal
        open={!!target}
        title={
          target
            ? `${target.decision === "approved" ? "Approve" : "Reject"} ${dateText(target.day.businessDate)}`
            : ""
        }
        onCancel={() => setTarget(null)}
        okText={target?.decision === "approved" ? "Approve" : "Reject"}
        okButtonProps={{
          loading: sign.isPending,
          disabled: target?.decision === "rejected" && note.trim().length < 5,
        }}
        onOk={() =>
          target &&
          sign.mutate({
            id: target.day.id,
            decision: target.decision,
            note: note.trim() || null,
          })
        }
      >
        {target ? (
          <p className="mb-3 text-sm text-muted-foreground">
            {differingFigures(target.day).length
              ? `${differingFigures(target.day)
                  .map((f) => figureLabel[f.asset])
                  .join(", ")} did not match the books.`
              : "Everything matched the books."}
          </p>
        ) : null}
        <Input.TextArea
          rows={3}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={
            target?.decision === "rejected"
              ? "Why is it rejected? (required)"
              : "Optional note"
          }
        />
        {sign.error ? (
          <p className="mt-2 text-sm text-red-600">{sign.error.message}</p>
        ) : null}
      </Modal>
    </div>
  );
}
