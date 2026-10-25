import { useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Input, Modal, Segmented, Table, Tag } from "antd";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { useAuth } from "@/features/auth/store";
import { useHasPermission } from "@/features/auth/useHasPermission";
import { cedis } from "@/features/calculator/format";
import { errorMessage } from "@/shared/api/errors";
import { useApiMutation } from "@/shared/api/hooks";
import { Button } from "@/shared/ui/Button";
import { dayKeys, daysApi } from "../api";
import { figureLabel, figureUnit } from "../closing";
import { dayFlagText, linesText, signoffText } from "../format";
import { useDayHistory } from "../hooks";
import type { Day, Figure } from "../schemas";

const colour = {
  not_required: undefined,
  pending: "orange",
  approved: "green",
  rejected: "red",
} as const;

const show = (f: Figure, v: string) =>
  figureUnit[f] === "g"
    ? `${v} g`
    : f === "cash" || figureUnit[f] === "GHS"
      ? cedis(Number(v))
      : v;

function Detail({ day }: { day: Day }) {
  const c = day.closing;
  if (!c)
    return (
      <p className="text-sm text-muted-foreground">
        Still open. Opened with {linesText(day.opening.lines)} (
        {day.opening.source}).
      </p>
    );
  return (
    <div className="space-y-3">
      <Table
        size="small"
        pagination={false}
        rowKey="asset"
        dataSource={c.figures}
        scroll={{ x: 560 }}
        columns={[
          {
            title: "Figure",
            dataIndex: "asset",
            render: (a: Figure) => figureLabel[a],
          },
          {
            title: "Books",
            dataIndex: "expected",
            align: "right",
            render: (v: string, r) => (
              <span className="tnum">{show(r.asset, v)}</span>
            ),
          },
          {
            title: "Counted",
            dataIndex: "actual",
            align: "right",
            render: (v: string, r) => (
              <span className="tnum">{show(r.asset, v)}</span>
            ),
          },
          {
            title: "Result",
            dataIndex: "outcome",
            render: (o: string, r) =>
              o === "balanced" ? (
                <Tag color="green">Matches</Tag>
              ) : (
                <Tag color={o === "shortage" ? "red" : "gold"}>
                  {o === "shortage" ? "Short" : "Over"}{" "}
                  {show(r.asset, r.difference.replace("-", ""))}
                </Tag>
              ),
          },
          {
            title: "Reason given",
            dataIndex: "explanation",
            render: (v?: string | null) => v ?? "—",
          },
        ]}
      />
      <p className="text-xs text-muted-foreground">
        Closed by {c.closedBy.displayName} at{" "}
        {new Date(c.closedAt).toLocaleString("en-GH")}. Confirmation{" "}
        {c.confirmation.version}: “{c.confirmation.text}”
      </p>
      {c.signoff.status !== "not_required" && c.signoff.at ? (
        <p className="text-xs text-muted-foreground">
          {signoffText[c.signoff.status]} by {c.signoff.by?.displayName} at{" "}
          {new Date(c.signoff.at).toLocaleString("en-GH")}
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
  const [filter, setFilter] = useState<"all" | "pending">("all");
  const history = useDayHistory({
    branchId,
    signoff: filter === "pending" ? "pending" : undefined,
  });
  const [target, setTarget] = useState<{
    day: Day;
    decision: "approved" | "rejected";
  } | null>(null);
  const [note, setNote] = useState("");

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
    <div className="mx-auto max-w-5xl space-y-4 p-4 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Day history</h1>
        <div className="flex items-center gap-3">
          <Segmented
            value={filter}
            onChange={(v) => setFilter(v as "all" | "pending")}
            options={[
              { label: "All days", value: "all" },
              { label: "Waiting for sign-off", value: "pending" },
            ]}
          />
          <Link to={paths.drawer.home.href} className="text-sm underline">
            Cash drawer
          </Link>
        </div>
      </div>
      {history.error ? (
        <Alert type="error" showIcon title={errorMessage(history.error)} />
      ) : null}
      <Table<Day>
        size="middle"
        rowKey="id"
        loading={history.isLoading}
        dataSource={history.data ?? []}
        pagination={{ pageSize: 15, hideOnSinglePage: true }}
        scroll={{ x: 700 }}
        locale={{
          emptyText:
            filter === "pending"
              ? "Nothing is waiting for sign-off"
              : "No days yet",
        }}
        expandable={{ expandedRowRender: (d) => <Detail day={d} /> }}
        columns={[
          {
            title: "Date",
            dataIndex: "businessDate",
            render: (v: string, d) => (
              <div>
                <div className="font-medium">{v}</div>
                {d.flags.map((f) => (
                  <Tag key={f} color="gold" className="mt-1">
                    {dayFlagText[f] ?? f}
                  </Tag>
                ))}
              </div>
            ),
          },
          {
            title: "Opened by",
            render: (_: unknown, d) => d.openedBy.displayName,
          },
          {
            title: "Status",
            render: (_: unknown, d) => {
              if (!d.closing) return <Tag color="blue">Open</Tag>;
              const s = d.closing.signoff.status;
              return <Tag color={colour[s]}>{signoffText[s]}</Tag>;
            },
          },
          {
            title: "Differences",
            render: (_: unknown, d) => {
              const bad =
                d.closing?.figures.filter((f) => f.outcome !== "balanced")
                  .length ?? 0;
              return d.closing
                ? bad
                  ? `${bad} figure${bad > 1 ? "s" : ""}`
                  : "None"
                : "—";
            },
          },
          {
            title: "",
            align: "right",
            render: (_: unknown, d) => {
              if (!canSign || d.closing?.signoff.status !== "pending")
                return null;
              const own = d.closing.closedBy.id === me;
              return (
                <div className="flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    disabled={own}
                    onClick={() => setTarget({ day: d, decision: "rejected" })}
                  >
                    Reject
                  </Button>
                  <Button
                    disabled={own}
                    onClick={() => setTarget({ day: d, decision: "approved" })}
                  >
                    Approve
                  </Button>
                </div>
              );
            },
          },
        ]}
      />
      {canSign ? (
        <p className="text-xs text-muted-foreground">
          You cannot sign off a day you closed yourself.
        </p>
      ) : null}

      <Modal
        open={!!target}
        title={
          target
            ? `${target.decision === "approved" ? "Approve" : "Reject"} ${target.day.businessDate}`
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
