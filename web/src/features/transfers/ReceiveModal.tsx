import { useState } from "react";
import { Alert, Modal, Segmented } from "antd";
import { lineTotal, type Lines } from "@gold/core";
import { cedis } from "@/features/calculator/format";
import { NoteCountInput } from "@/features/drawer/NoteCountInput";
import { TextField } from "@/shared/ui/TextField";
import { PhotoAttach } from "@/features/photos/PhotoAttach";
import { useReceiveTransfer } from "./api";
import type { ReceiveLineInput, Transfer } from "./schemas";

type Row = {
  outcome: "matched" | "differs" | "missing";
  top: string;
  down: string;
  note: string;
};

function GoodsForm({
  transfer,
  onClose,
}: {
  transfer: Transfer;
  onClose: () => void;
}) {
  const receive = useReceiveTransfer();
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(
      transfer.lines.map((l) => [
        l.id,
        {
          outcome: "matched",
          top: l.releasedTop,
          down: l.releasedDown,
          note: "",
        } satisfies Row,
      ]),
    ),
  );
  const [note, setNote] = useState("");
  const set = (id: string, patch: Partial<Row>) =>
    setRows((r) => ({ ...r, [id]: { ...(r[id] as Row), ...patch } }));
  const ready = transfer.lines.every((l) => {
    const r = rows[l.id];
    if (!r) return false;
    if (r.outcome === "matched") return true;
    if (r.outcome === "missing") return r.note.trim().length >= 3;
    return (
      Number(r.top) >= 0 &&
      r.top !== "" &&
      r.down !== "" &&
      r.note.trim().length >= 3
    );
  });
  const bad = transfer.lines.filter(
    (l) => rows[l.id]?.outcome !== "matched",
  ).length;

  function submit() {
    const lines: ReceiveLineInput[] = transfer.lines.map((l) => {
      const r = rows[l.id] as Row;
      if (r.outcome === "matched") return { lineId: l.id, outcome: "matched" };
      if (r.outcome === "missing")
        return { lineId: l.id, outcome: "missing", note: r.note.trim() };
      return {
        lineId: l.id,
        outcome: "differs",
        top: r.top,
        down: r.down,
        note: r.note.trim(),
      };
    });
    receive.mutate(
      { id: transfer.id, lines, ...(note.trim() ? { note: note.trim() } : {}) },
      { onSuccess: onClose },
    );
  }

  return (
    <div className="space-y-4">
      <Alert
        type="info"
        showIcon
        title="Check every piece against what was sent."
        description="Weigh each one. If anything is different or missing, say so: the difference is sent to a manager. It is never hidden."
      />
      {transfer.lines.map((l) => {
        const r = rows[l.id] as Row;
        return (
          <div
            key={l.id}
            className="space-y-2 rounded-lg border border-border p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">
                  {l.description}
                  {l.customerName ? ` · ${l.customerName}` : ""}
                </div>
                <div className="tnum text-xs text-muted-foreground">
                  Sent: top {l.releasedTop} g · down {l.releasedDown} g ·{" "}
                  {cedis(Number(l.releasedValue))}
                </div>
              </div>
            </div>
            <Segmented
              block
              value={r.outcome}
              onChange={(v) => set(l.id, { outcome: v as Row["outcome"] })}
              options={[
                { label: "Matches", value: "matched" },
                { label: "Differs", value: "differs" },
                { label: "Not here", value: "missing" },
              ]}
            />
            {r.outcome === "differs" ? (
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="Top weight found (g)"
                  inputMode="decimal"
                  value={r.top}
                  onChange={(e) => set(l.id, { top: e.target.value })}
                />
                <TextField
                  label="Down weight found (g)"
                  inputMode="decimal"
                  value={r.down}
                  onChange={(e) => set(l.id, { down: e.target.value })}
                />
              </div>
            ) : null}
            {r.outcome !== "matched" ? (
              <TextField
                label="What did you find?"
                value={r.note}
                onChange={(e) => set(l.id, { note: e.target.value })}
              />
            ) : null}
          </div>
        );
      })}
      <TextField
        label="Note on the whole delivery (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {receive.error ? (
        <Alert type="error" showIcon title={receive.error.message} />
      ) : null}
      {bad > 0 ? (
        <Alert
          type="warning"
          showIcon
          title={`${bad} line${bad === 1 ? "" : "s"} will be sent for review.`}
        />
      ) : null}
      <button
        type="button"
        disabled={!ready || receive.isPending}
        onClick={submit}
        className="min-h-11 w-full rounded-lg bg-primary px-4 font-medium text-primary-foreground disabled:opacity-50"
      >
        {receive.isPending ? "Saving…" : "Confirm receipt"}
      </button>
    </div>
  );
}

function CashForm({
  transfer,
  onClose,
}: {
  transfer: Transfer;
  onClose: () => void;
}) {
  const receive = useReceiveTransfer();
  const [lines, setLines] = useState<Lines>({});
  const [note, setNote] = useState("");
  const declared = Number(transfer.declared?.cash ?? 0);
  const counted = lineTotal(lines);
  const differs = counted !== declared;
  const ok = !receive.isPending && (!differs || note.trim().length >= 3);
  return (
    <div className="space-y-4">
      <Alert
        type="info"
        showIcon
        title="Count the notes in front of the person who brought them."
        description={`Sent: ${cedis(declared)}. Enter what you actually count.`}
      />
      <NoteCountInput value={lines} onChange={setLines} />
      {differs ? (
        <Alert
          type="warning"
          showIcon
          title={`This is ${cedis(Math.abs(counted - declared))} ${counted < declared ? "less" : "more"} than was sent. Say what you found.`}
        />
      ) : null}
      <TextField
        label={differs ? "What did you find?" : "Note (optional)"}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {receive.error ? (
        <Alert type="error" showIcon title={receive.error.message} />
      ) : null}
      <button
        type="button"
        disabled={!ok}
        onClick={() =>
          receive.mutate(
            {
              id: transfer.id,
              lines,
              ...(note.trim() ? { note: note.trim() } : {}),
            },
            { onSuccess: onClose },
          )
        }
        className="min-h-11 w-full rounded-lg bg-primary px-4 font-medium text-primary-foreground disabled:opacity-50"
      >
        {receive.isPending ? "Saving…" : "Confirm receipt"}
      </button>
    </div>
  );
}

export function ReceiveModal({
  transfer,
  onClose,
}: {
  transfer: Transfer | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={!!transfer}
      onCancel={onClose}
      title={transfer ? `Receive ${transfer.reference}` : "Receive"}
      footer={null}
      destroyOnHidden
      width={620}
    >
      {transfer ? (
        <div className="space-y-4">
          <PhotoAttach
            target={{
              entityType: "transfer",
              entityId: transfer.id,
              slot: "receive",
            }}
            title="Photo of what arrived (optional)"
            hint="Nothing is blocked if you skip it. It shows the reviewers what you received."
            branchName={transfer.destinationBranchName}
            reference={transfer.reference}
          />
          {transfer.kind === "goods" ? (
            <GoodsForm transfer={transfer} onClose={onClose} />
          ) : (
            <CashForm transfer={transfer} onClose={onClose} />
          )}
        </div>
      ) : null}
    </Modal>
  );
}
