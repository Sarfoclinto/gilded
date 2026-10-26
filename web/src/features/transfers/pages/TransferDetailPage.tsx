import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, Modal, Table, Timeline } from "antd";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { useAuth } from "@/features/auth/store";
import { useHasPermission } from "@/features/auth/useHasPermission";
import { cedis } from "@/features/calculator/format";
import { when } from "@/features/transactions/format";
import { errorMessage } from "@/shared/api/errors";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { TextField } from "@/shared/ui/TextField";
import { AddItemsModal } from "../AddItemsModal";
import { CollectorModal } from "../CollectorModal";
import { PaymentModal } from "../PaymentModal";
import { ReceiveModal } from "../ReceiveModal";
import { ReleaseModal } from "../ReleaseModal";
import {
  useAddTransferNote,
  useCancelTransfer,
  useEditTransfer,
  useTransfer,
} from "../api";
import {
  eventLabel,
  methodLabel,
  outcomeLabel,
  purposeLabel,
  StatusChip,
} from "../labels";
import type { Transfer, TransferLine } from "../schemas";

type Dialog =
  | "collector"
  | "items"
  | "release"
  | "pay"
  | "receive"
  | "cancel"
  | "note"
  | null;

function eventText(
  type: string,
  data: Record<string, unknown> | undefined,
): string {
  const d = data ?? {};
  if (type === "note_added" || type === "cancelled")
    return String(d.text ?? d.reason ?? "");
  if (type === "payment_recorded")
    return `${String(d.direction ?? "").replace(/_/g, " ")} · ${cedis(Number(d.amount ?? 0))} · ${String(d.method ?? "")}`;
  if (type === "collector_set")
    return String(d.name ?? "") || (d.type === "staff" ? "Staff member" : "");
  if (type === "discrepancy_flagged") return String(d.note ?? "");
  if (type === "released") return String(d.note ?? "");
  return "";
}

function TextDialog({
  title,
  label,
  minLength,
  open,
  busy,
  error,
  cta,
  onSubmit,
  onClose,
}: {
  title: string;
  minLength: number;
  label: string;
  open: boolean;
  busy: boolean;
  error?: string;
  cta: string;
  onSubmit: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={title}
      footer={null}
      destroyOnHidden
      afterClose={() => setText("")}
    >
      <div className="space-y-4">
        <TextField
          label={label}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {error ? <Alert type="error" showIcon title={error} /> : null}
        <button
          type="button"
          disabled={busy || text.trim().length < minLength}
          onClick={() => onSubmit(text.trim())}
          className="min-h-11 w-full rounded-lg bg-primary px-4 font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Saving…" : cta}
        </button>
      </div>
    </Modal>
  );
}

export default function TransferDetailPage() {
  const { id } = useParams();
  const { data: t, isLoading, error } = useTransfer(id);
  const user = useAuth((s) => s.user);
  const canSend = useHasPermission(PERMISSIONS.TRANSFERS_CREATE);
  const canReceive = useHasPermission(PERMISSIONS.TRANSFERS_RECEIVE);
  const [dialog, setDialog] = useState<Dialog>(null);
  const cancel = useCancelTransfer();
  const note = useAddTransferNote();
  const edit = useEditTransfer();
  const close = () => setDialog(null);

  if (isLoading)
    return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  if (!t) {
    return (
      <div className="p-4" role="alert">
        <p className="text-sm">
          {error ? errorMessage(error) : "Transfer not found."}
        </p>
        <Link
          to={paths.transfers.list.href}
          className="text-sm font-medium underline"
        >
          Back to transfers
        </Link>
      </div>
    );
  }

  const here = (b: string) => !!user?.branchIds.includes(b);
  const atOrigin = canSend && here(t.originBranchId);
  const atDestination = canReceive && here(t.destinationBranchId);
  const goods = t.kind === "goods";
  const readyToSend = goods ? t.lines.length > 0 : true;
  const collectorName = t.collector
    ? (t.collector.name ?? "Staff member")
    : null;
  const target: Transfer = t;

  const lineCols = [
    {
      title: "Piece",
      render: (_: unknown, l: TransferLine) => (
        <div>
          <div className="font-medium">{l.description}</div>
          <div className="text-xs text-muted-foreground">
            {l.customerName}
            {l.reference ? ` · ${l.reference}` : ""}
          </div>
        </div>
      ),
    },
    {
      title: "Sent",
      align: "right" as const,
      render: (_: unknown, l: TransferLine) => (
        <span className="tnum text-xs">
          {l.releasedTop} / {l.releasedDown} g<br />
          {cedis(Number(l.releasedValue))}
        </span>
      ),
    },
    ...(t.receipt
      ? [
          {
            title: "Received",
            align: "right" as const,
            render: (_: unknown, l: TransferLine) =>
              l.receivedTop ? (
                <span className="tnum text-xs">
                  {l.receivedTop} / {l.receivedDown} g<br />
                  {cedis(Number(l.receivedValue))}
                </span>
              ) : (
                "—"
              ),
          },
        ]
      : []),
    {
      title: "",
      align: "right" as const,
      render: (_: unknown, l: TransferLine) =>
        t.status === "draft" && atOrigin ? (
          <button
            type="button"
            className="text-sm underline"
            disabled={edit.isPending}
            onClick={() =>
              edit.mutate({ id: target.id, data: { removeLineIds: [l.id] } })
            }
          >
            Take off
          </button>
        ) : l.outcome !== "pending" ? (
          <span
            className={
              l.outcome === "matched" ? "text-emerald-700" : "text-amber-700"
            }
          >
            {outcomeLabel[l.outcome]}
          </span>
        ) : null,
    },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-8">
      <Link
        to={paths.transfers.list.href}
        className="text-sm text-muted-foreground underline"
      >
        ← Transfers
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{t.reference}</h1>
          <p className="text-sm text-muted-foreground">
            {t.originBranchName} → {t.destinationBranchName} ·{" "}
            {purposeLabel[t.purpose] ?? t.purpose} ·{" "}
            {methodLabel[t.method] ?? t.method}
          </p>
          {t.purposeNote ? <p className="text-sm">{t.purposeNote}</p> : null}
        </div>
        <StatusChip status={t.status} />
      </div>

      <div className="flex flex-wrap gap-2">
        {t.status === "draft" && atOrigin ? (
          <>
            <Button
              onClick={() => setDialog("release")}
              disabled={!readyToSend}
            >
              Hand to the collector
            </Button>
            {goods ? (
              <Button variant="secondary" onClick={() => setDialog("items")}>
                Add gold
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => setDialog("collector")}>
              {t.collector ? "Change collector" : "Set collector"}
            </Button>
            <Button variant="ghost" onClick={() => setDialog("cancel")}>
              Cancel draft
            </Button>
          </>
        ) : null}
        {t.status === "released" && atDestination ? (
          <Button onClick={() => setDialog("receive")}>Receive</Button>
        ) : null}
        {t.status === "released" && atOrigin ? (
          <Button variant="secondary" onClick={() => setDialog("collector")}>
            Change collector
          </Button>
        ) : null}
        {(t.status === "released" ||
          t.status === "received" ||
          t.status === "received_with_discrepancy") &&
        (atOrigin || atDestination) ? (
          <Button variant="secondary" onClick={() => setDialog("pay")}>
            Record money paid
          </Button>
        ) : null}
        <Button variant="ghost" onClick={() => setDialog("note")}>
          Add a note
        </Button>
      </div>

      {t.status === "draft" && !t.collector && atOrigin ? (
        <Alert
          type="warning"
          showIcon
          title="Say who is carrying it before you hand it over."
        />
      ) : null}
      {t.status === "received_with_discrepancy" ? (
        <Alert
          type="warning"
          showIcon
          title="Something did not match. A manager will review it."
          description="The sending branch's books went down by what was sent; the receiving branch booked what it found. The difference stays open as a case until someone settles it."
        />
      ) : null}
      {t.cancellation ? (
        <Alert
          type="info"
          showIcon
          title={`Cancelled: ${t.cancellation.reason}`}
        />
      ) : null}

      <Card className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <div className="text-xs uppercase text-muted-foreground">
            Carried by
          </div>
          {t.collector ? (
            <div>
              <div className="font-medium">{collectorName}</div>
              {t.collector.type === "external" ? (
                <div className="text-xs text-muted-foreground">
                  {[
                    t.collector.phone,
                    t.collector.idType && t.collector.idNumber
                      ? `${t.collector.idType} ${t.collector.idNumber}`
                      : null,
                    t.collector.relationship,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="text-muted-foreground">Not set yet</div>
          )}
        </div>
        <div>
          <div className="text-xs uppercase text-muted-foreground">
            {goods ? "Gold" : "Cash"}
          </div>
          {t.declared ? (
            <div className="tnum">
              {goods
                ? `Sent: top ${t.declared.top} g · down ${t.declared.down} g · ${cedis(Number(t.declared.value))}`
                : `Sent: ${cedis(Number(t.declared.cash))}`}
            </div>
          ) : (
            <div className="text-muted-foreground">
              {goods
                ? `${t.lines.length} piece${t.lines.length === 1 ? "" : "s"} chosen`
                : "Counted at handover"}
            </div>
          )}
          {t.receipt ? (
            <div className="tnum">
              {goods
                ? `Received: top ${t.receipt.top} g · down ${t.receipt.down} g · ${cedis(Number(t.receipt.value))}`
                : `Received: ${cedis(Number(t.receipt.cash))}`}
            </div>
          ) : null}
        </div>
        {t.release ? (
          <div className="text-xs text-muted-foreground">
            Handed over {when(t.release.at)} by {t.release.by?.displayName}
            {t.release.note ? ` · ${t.release.note}` : ""}
          </div>
        ) : null}
        {t.receipt ? (
          <div className="text-xs text-muted-foreground">
            Received {when(t.receipt.at)} by {t.receipt.by?.displayName}
            {t.receipt.note ? ` · ${t.receipt.note}` : ""}
          </div>
        ) : null}
      </Card>

      {goods ? (
        <Table<TransferLine>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={t.lines}
          columns={lineCols}
          locale={{ emptyText: "No gold added yet" }}
          scroll={{ x: 480 }}
        />
      ) : null}

      {t.discrepancies.length ? (
        <Card>
          <h2 className="mb-2 font-semibold">Differences found</h2>
          <ul className="space-y-1 text-sm">
            {t.discrepancies.map((d) => (
              <li key={d.id}>
                {d.asset?.replace("_", " ")}: expected {d.expected}, found{" "}
                {d.actual} ({d.difference}){" "}
                <span className="text-muted-foreground">
                  · {d.status}
                  {d.explanation ? ` · “${d.explanation}”` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {t.payments.length ? (
        <Card>
          <h2 className="mb-2 font-semibold">Money paid</h2>
          <ul className="divide-y divide-border text-sm">
            {t.payments.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 py-2"
              >
                <span>
                  {p.direction === "paid_to_collector"
                    ? "We paid the collector"
                    : "Collector paid us"}{" "}
                  · {p.purpose} · {p.method.replace("_", " ")}
                  <span className="block text-xs text-muted-foreground">
                    {when(p.paidAt)} · {p.recordedBy?.displayName}
                  </span>
                </span>
                <strong className="tnum">{cedis(Number(p.amount))}</strong>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <h2 className="mb-3 font-semibold">What happened</h2>
        <Timeline
          items={t.events.map((e) => ({
            content: (
              <div className="text-sm">
                <span className="font-medium">
                  {eventLabel[e.type] ?? e.type}
                </span>
                <span className="text-muted-foreground">
                  {" "}
                  · {when(e.at)}
                  {e.by ? ` · ${e.by.displayName}` : ""}
                </span>
                {eventText(e.type, e.data) ? (
                  <div>{eventText(e.type, e.data)}</div>
                ) : null}
              </div>
            ),
          }))}
        />
      </Card>

      <CollectorModal
        transfer={dialog === "collector" ? target : null}
        onClose={close}
      />
      <AddItemsModal
        transfer={dialog === "items" ? target : null}
        onClose={close}
      />
      <ReleaseModal
        transfer={dialog === "release" ? target : null}
        onClose={close}
      />
      <PaymentModal
        transfer={dialog === "pay" ? target : null}
        onClose={close}
      />
      <ReceiveModal
        transfer={dialog === "receive" ? target : null}
        onClose={close}
      />
      <TextDialog
        open={dialog === "cancel"}
        title="Cancel this draft"
        minLength={5}
        label="Reason"
        busy={cancel.isPending}
        cta="Cancel the draft"
        {...(cancel.error ? { error: errorMessage(cancel.error) } : {})}
        onClose={close}
        onSubmit={(reason) =>
          cancel.mutate({ id: target.id, reason }, { onSuccess: close })
        }
      />
      <TextDialog
        open={dialog === "note"}
        title="Add a note"
        minLength={1}
        label="Note"
        busy={note.isPending}
        cta="Add note"
        {...(note.error ? { error: errorMessage(note.error) } : {})}
        onClose={close}
        onSubmit={(text) =>
          note.mutate({ id: target.id, text }, { onSuccess: close })
        }
      />
    </div>
  );
}
