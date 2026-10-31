import { useState } from "react";
import { Alert, Input, Modal } from "antd";
import { lineTotal, type Lines } from "@gold/core";
import { cedis } from "@/features/calculator/format";
import { useOutbox } from "@/shared/offline/OutboxProvider";
import { toast } from "@/shared/ui/toast";
import { checkExchange } from "./exchange";
import { useActiveDrawer } from "./hooks";
import { NoteCountInput } from "./NoteCountInput";
import { exchangeCommandSchema, OUTBOX } from "./schemas";

/**
 * A customer was paid and wants other notes ("change my 200 into two 100s"). The notes given back and the notes handed out must be
 * worth exactly the same and be different notes, and the drawer must hold what is handed out. Queued like any drawer movement.
 */
export function ExchangeModal({
  open,
  onClose,
  dayId,
  branchId,
  transactionId,
  reference,
}: {
  open: boolean;
  onClose: () => void;
  dayId: string;
  branchId: string;
  transactionId?: string;
  reference?: string;
}) {
  const outbox = useOutbox();
  const { view } = useActiveDrawer();
  const [gave, setGave] = useState<Lines>({});
  const [took, setTook] = useState<Lines>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const check = checkExchange(gave, took, view.balance);

  const submit = async () => {
    if (!check.valid) return;
    const cmd = {
      id: crypto.randomUUID(),
      dayId,
      branchId,
      ...(transactionId ? { transactionId } : {}),
      gave,
      took,
      ...(note.trim() ? { note: note.trim() } : {}),
      capturedAt: new Date().toISOString(),
    };
    const parsed = exchangeCommandSchema.safeParse(cmd);
    if (!parsed.success)
      return toast.error(parsed.error.issues[0]?.message ?? "Check the notes.");
    setBusy(true);
    await outbox.enqueue(cmd.id, OUTBOX.EXCHANGE, parsed.data);
    void outbox.syncNow();
    toast.success("Notes changed");
    setGave({});
    setTook({});
    setNote("");
    setBusy(false);
    onClose();
  };

  const status =
    check.gaveTotal === 0 && check.tookTotal === 0
      ? null
      : check.remaining === 0 &&
          check.overlap.length === 0 &&
          Object.keys(check.short).length === 0
        ? {
            tone: "ok" as const,
            text: `Adds up exactly: ${cedis(check.gaveTotal)} for ${cedis(check.tookTotal)}`,
          }
        : check.remaining !== 0
          ? {
              tone: "bad" as const,
              text:
                check.remaining > 0
                  ? `Still to hand out: ${cedis(check.remaining)}`
                  : `Handing out too much by ${cedis(-check.remaining)}`,
            }
          : null;

  return (
    <Modal
      title={reference ? `Change notes · ${reference}` : "Change notes"}
      open={open}
      onCancel={onClose}
      onOk={() => void submit()}
      okText="Record"
      okButtonProps={{ disabled: !check.valid }}
      confirmLoading={busy}
      destroyOnHidden
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          The customer gives notes back and gets other notes worth exactly the
          same. The amount paid does not change.
        </p>
        <div>
          <h3 className="mb-1 text-sm font-semibold">
            Notes the customer gives back
          </h3>
          <NoteCountInput value={gave} onChange={setGave} hideTotalCheck />
        </div>
        <div>
          <h3 className="mb-1 text-sm font-semibold">Notes you hand out</h3>
          <NoteCountInput value={took} onChange={setTook} hideTotalCheck />
        </div>
        {status ? (
          <div
            role={status.tone === "bad" ? "alert" : "status"}
            className={`tnum flex items-baseline justify-between rounded-lg border p-3 text-sm ${status.tone === "ok" ? "border-emerald-500/50 bg-emerald-500/10" : "border-red-500/50 bg-red-500/10"}`}
          >
            <span>{status.text}</span>
            <strong>{cedis(lineTotal(took))}</strong>
          </div>
        ) : null}
        {check.overlap.length > 0 ? (
          <Alert
            type="warning"
            showIcon
            title={`Hand out different notes from the ones given back (GHS ${check.overlap.join(", GHS ")}).`}
          />
        ) : null}
        {Object.keys(check.short).length > 0 ? (
          <Alert
            type="error"
            showIcon
            title={`The drawer does not have enough: ${Object.entries(
              check.short,
            )
              .map(([d, n]) => `GHS ${d} (${n} short)`)
              .join(", ")}.`}
          />
        ) : null}
        <Input
          size="large"
          placeholder="Note (optional)"
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Modal>
  );
}
