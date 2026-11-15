import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, Modal, Timeline } from "antd";
import { ArrowRightIcon } from "lucide-react";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { PhotoAttach } from "@/features/photos/PhotoAttach";
import { useAuth } from "@/features/auth/store";
import { useHasPermission } from "@/features/auth/useHasPermission";
import { cedis } from "@/features/calculator/format";
import { when } from "@/features/transactions/format";
import { errorMessage } from "@/shared/api/errors";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { Stepper } from "@/shared/ui/Stepper";
import { TextField } from "@/shared/ui/TextField";
import { AddItemsModal } from "../AddItemsModal";
import { CollectorModal } from "../CollectorModal";
import { PaymentModal } from "../PaymentModal";
import { ReceiveModal } from "../ReceiveModal";
import { ReleaseModal } from "../ReleaseModal";
import {
  useAddTransferNote,
  useCancelTransfer,
  useRecallTransfer,
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
import {
  differenceOf,
  roadAge,
  SCALE_TEXT,
  SCALE_TONE,
  signedGrams,
  STAGES,
  stageOf,
} from "../model";
import { ScaleReading } from "../ScaleReading";
import type { Transfer } from "../schemas";

type Dialog =
  | "collector"
  | "items"
  | "release"
  | "pay"
  | "receive"
  | "cancel"
  | "recall"
  | "note"
  | null;

function eventText(
  type: string,
  data: Record<string, unknown> | undefined,
): string {
  const d = data ?? {};
  if (type === "note_added" || type === "cancelled" || type === "recalled")
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
  const recall = useRecallTransfer();
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

  const stage = stageOf(t.status);
  const diff = differenceOf(t);
  const age = roadAge({ status: t.status, releasedAt: t.release?.at ?? null });
  const ageClass =
    age?.tone === "stale"
      ? "font-semibold text-red-600"
      : age?.tone === "late"
        ? "text-amber-700"
        : "text-muted-foreground";
  const sign = (n: number) => (n > 0 ? "+" : "−");
  const grams = (n: number, label: string) =>
    Math.abs(n) < 0.0005
      ? null
      : `${sign(n)}${Number(Math.abs(n).toFixed(3))} g ${label}`;
  const money = (n: number) =>
    Math.abs(n) < 0.005 ? null : `${sign(n)}${cedis(Math.abs(n))}`;
  const diffText = diff
    ? (goods
        ? [grams(diff.top, "top"), grams(diff.down, "down"), money(diff.value)]
        : [money(diff.cash)]
      ).filter(Boolean)
    : [];
  const primary =
    t.status === "draft" && atOrigin ? (
      <Button
        onClick={() => setDialog("release")}
        disabled={!readyToSend || !t.collector}
      >
        Hand to the collector
      </Button>
    ) : t.status === "released" && atDestination ? (
      <Button onClick={() => setDialog("receive")}>Receive</Button>
    ) : null;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-3 pb-8 sm:p-4 lg:p-6">
      <Link
        to={paths.transfers.list.href}
        className="text-sm text-muted-foreground underline"
      >
        ← Transfers
      </Link>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 text-xl font-bold">
              {t.originBranchName}
              <ArrowRightIcon
                className="size-5 text-muted-foreground"
                aria-label="to"
              />
              {t.destinationBranchName}
            </div>
            <p className="font-mono text-xs text-muted-foreground">
              {t.reference}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {goods ? "Gold" : "Cash"} · {purposeLabel[t.purpose] ?? t.purpose}{" "}
              · {methodLabel[t.method] ?? t.method}
            </p>
            {t.purposeNote ? <p className="text-sm">{t.purposeNote}</p> : null}
          </div>
          <div className="flex flex-col items-end gap-1">
            <StatusChip status={t.status} />
            {age ? (
              <span className={`text-xs ${ageClass}`}>{age.text}</span>
            ) : null}
          </div>
        </div>
        <Stepper
          steps={STAGES}
          current={stage.index}
          warn={stage.tone === "warn"}
        />
        <div className="flex flex-wrap items-center gap-2">
          {primary}
          {t.status === "draft" && atOrigin ? (
            <>
              {goods ? (
                <Button variant="secondary" onClick={() => setDialog("items")}>
                  Add gold
                </Button>
              ) : null}
              <Button
                variant="secondary"
                onClick={() => setDialog("collector")}
              >
                {t.collector ? "Change collector" : "Set collector"}
              </Button>
              <Button variant="ghost" onClick={() => setDialog("cancel")}>
                Cancel draft
              </Button>
            </>
          ) : null}
          {t.status === "released" && atOrigin ? (
            <Button variant="secondary" onClick={() => setDialog("collector")}>
              Change collector
            </Button>
          ) : null}
          {t.status === "released" && atOrigin && canSend ? (
            <Button variant="ghost" onClick={() => setDialog("recall")}>
              Recall it
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
      </Card>

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
      {t.scaled && t.declared && t.scaled.level !== "ok" ? (
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="mb-2 text-sm font-semibold">
            At the handover, the scale and the books did not agree:{" "}
            {SCALE_TEXT[t.scaled.level].toLowerCase()}
          </p>
          <ScaleReading
            booksTop={Number(t.declared.top)}
            booksDown={Number(t.declared.down)}
            scaleTop={Number(t.scaled.top)}
            scaleDown={Number(t.scaled.down)}
            topLevel={t.scaled.topLevel}
            downLevel={t.scaled.downLevel}
            level={t.scaled.level}
            downAllowance={Number(t.scaled.downAllowance)}
          />
        </div>
      ) : null}
      {t.cancellation ? (
        <Alert
          type="info"
          showIcon
          title={
            t.cancellation.reason.startsWith("Recalled:")
              ? t.cancellation.reason
              : `Cancelled: ${t.cancellation.reason}`
          }
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
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
        </Card>
        <Card>
          <div className="text-xs uppercase text-muted-foreground">Sent</div>
          {t.declared ? (
            <div className="tnum">
              <div className="text-lg font-bold">
                {goods
                  ? cedis(Number(t.declared.value))
                  : cedis(Number(t.declared.cash))}
              </div>
              {goods ? (
                <div className="text-xs text-muted-foreground">
                  top {t.declared.top} g · down {t.declared.down} g
                </div>
              ) : null}
            </div>
          ) : (
            <div className="text-muted-foreground">
              {goods
                ? `${t.lines.length} piece${t.lines.length === 1 ? "" : "s"} chosen`
                : "Counted at handover"}
            </div>
          )}
          {t.scaled && t.declared ? (
            <div
              className={`mt-2 rounded-md border px-2 py-1 text-xs ${SCALE_TONE[t.scaled.level]}`}
            >
              Scale: top {t.scaled.top} g (
              {signedGrams(Number(t.scaled.topDifference))}) · down{" "}
              {t.scaled.down} g ({signedGrams(Number(t.scaled.downDifference))})
            </div>
          ) : null}
          {t.release ? (
            <div className="mt-1 text-xs text-muted-foreground">
              {when(t.release.at)} · {t.release.by?.displayName}
              {t.release.note ? ` · ${t.release.note}` : ""}
            </div>
          ) : null}
        </Card>
        <Card className={diffText.length ? "border-amber-500/50" : ""}>
          <div className="text-xs uppercase text-muted-foreground">
            Received
          </div>
          {t.receipt ? (
            <div className="tnum">
              <div className="text-lg font-bold">
                {goods
                  ? cedis(Number(t.receipt.value))
                  : cedis(Number(t.receipt.cash))}
              </div>
              {goods ? (
                <div className="text-xs text-muted-foreground">
                  top {t.receipt.top} g · down {t.receipt.down} g
                </div>
              ) : null}
              <div
                className={`text-xs font-semibold ${diffText.length ? "text-amber-700" : "text-emerald-700"}`}
              >
                {diffText.length
                  ? `Difference: ${diffText.join(" · ")}`
                  : "Matched what was sent"}
              </div>
              <div className="mt-1 text-xs font-normal text-muted-foreground">
                {when(t.receipt.at)} · {t.receipt.by?.displayName}
                {t.receipt.note ? ` · ${t.receipt.note}` : ""}
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground">
              {t.status === "cancelled" ? "Never sent" : "Not yet"}
            </div>
          )}
        </Card>
      </div>

      {t.status !== "cancelled" ? (
        <Card className="space-y-3">
          <h2 className="font-semibold">Photos</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <PhotoAttach
              target={{
                entityType: "transfer",
                entityId: t.id,
                slot: "release",
              }}
              title={`At handover · ${t.originBranchName}`}
              hint={
                t.status === "draft"
                  ? "Add them when you hand it over."
                  : undefined
              }
              branchName={t.originBranchName}
              reference={t.reference}
              readOnly={!atOrigin}
              emptyText={
                t.status === "draft"
                  ? undefined
                  : "No photo was attached at handover. Photos are not required; this only lets the reviewer know there is none."
              }
            />
            {t.status !== "draft" ? (
              <PhotoAttach
                target={{
                  entityType: "transfer",
                  entityId: t.id,
                  slot: "receive",
                }}
                title={`At receipt · ${t.destinationBranchName}`}
                branchName={t.destinationBranchName}
                reference={t.reference}
                readOnly={!atDestination}
                emptyText={
                  t.status === "released"
                    ? undefined
                    : "No photo was attached at receipt. Photos are not required; this only lets the reviewer know there is none."
                }
              />
            ) : null}
          </div>
        </Card>
      ) : null}

      {goods ? (
        <Card className="p-0">
          <h2 className="px-4 pt-3 font-semibold">
            The gold{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({t.lines.length})
            </span>
          </h2>
          {t.lines.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No gold added yet.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {t.lines.map((l) => (
                <li
                  key={l.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <div className="font-medium">{l.description}</div>
                    <div className="text-xs text-muted-foreground">
                      {l.customerName}
                      {l.reference ? ` · ${l.reference}` : ""}
                    </div>
                  </div>
                  <div className="tnum text-right text-xs">
                    <div>
                      {l.releasedTop} / {l.releasedDown} g ·{" "}
                      <strong>{cedis(Number(l.releasedValue))}</strong>
                    </div>
                    {t.receipt ? (
                      <div className="text-muted-foreground">
                        {l.receivedTop
                          ? `found ${l.receivedTop} / ${l.receivedDown} g · ${cedis(Number(l.receivedValue))}`
                          : "not counted"}
                      </div>
                    ) : null}
                  </div>
                  <div className="w-full text-right sm:w-auto">
                    {t.status === "draft" && atOrigin ? (
                      <button
                        type="button"
                        className="text-sm underline"
                        disabled={edit.isPending}
                        onClick={() =>
                          edit.mutate({
                            id: target.id,
                            data: { removeLineIds: [l.id] },
                          })
                        }
                      >
                        Take off
                      </button>
                    ) : l.outcome !== "pending" ? (
                      <span
                        className={
                          l.outcome === "matched"
                            ? "text-emerald-700"
                            : "font-medium text-amber-700"
                        }
                      >
                        {outcomeLabel[l.outcome]}
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
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
        open={dialog === "recall"}
        title="Recall this transfer"
        minLength={5}
        label="Why is it being recalled? (the receiving branch is told not to accept it)"
        busy={recall.isPending}
        cta="Recall and put it back in our books"
        {...(recall.error ? { error: errorMessage(recall.error) } : {})}
        onClose={close}
        onSubmit={(reason) =>
          recall.mutate({ id: target.id, reason }, { onSuccess: close })
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
