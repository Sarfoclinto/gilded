import { useState } from "react";
import { Alert, Drawer, Modal, Segmented, Table } from "antd";
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
                <dd className="font-semibold">{figure(c, c.difference)}</dd>
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

export default function DiscrepanciesPage() {
  const [view, setView] = useState<View>("active");
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useCases({ status: view });
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 pb-8">
      <PageHeader
        title="Review"
        subtitle="Differences found when counting, closing or receiving, waiting for a decision."
      />
      <div className="sticky top-0 z-10 -mx-4 border-b border-border bg-background/95 px-4 py-2 backdrop-blur">
        <Segmented
          value={view}
          onChange={(v) => setView(v as View)}
          options={[
            { label: "Needs attention", value: "active" },
            { label: "Closed", value: "resolved" },
            { label: "All", value: "all" },
          ]}
        />
      </div>
      {list.error ? (
        <Alert type="error" showIcon title={errorMessage(list.error)} />
      ) : null}
      <Table<Case>
        rowKey="id"
        size="middle"
        loading={list.isLoading}
        dataSource={(list.data ?? []).filter((c) =>
          view === "resolved"
            ? c.status === "resolved" || c.status === "written_off"
            : true,
        )}
        pagination={{ pageSize: 15, hideOnSinglePage: true }}
        scroll={{ x: 720 }}
        locale={{
          emptyText: view === "active" ? "Nothing needs attention" : "No cases",
        }}
        onRow={(c) => ({
          onClick: () => setOpenId(c.id),
          style: { cursor: "pointer" },
        })}
        columns={[
          {
            title: "Case",
            render: (_: unknown, c) => (
              <div>
                <div className="font-medium">{kindLabel[c.kind] ?? c.kind}</div>
                <div className="text-xs text-muted-foreground">
                  {c.asset ? (assetLabel[c.asset] ?? c.asset) : "General"}
                </div>
              </div>
            ),
          },
          { title: "Branch", dataIndex: "branchName" },
          {
            title: "Difference",
            align: "right",
            render: (_: unknown, c) => (
              <span className="tnum">{figure(c, c.difference)}</span>
            ),
          },
          { title: "Opened", render: (_: unknown, c) => when(c.openedAt) },
          {
            title: "Looked after by",
            render: (_: unknown, c) => c.assignedTo?.displayName ?? "—",
          },
          {
            title: "Status",
            render: (_: unknown, c) => <CaseStatusChip status={c.status} />,
          },
        ]}
      />
      <CaseDrawer id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
