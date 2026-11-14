import { useState } from "react";
import { Alert, Modal } from "antd";
import { lineTotal, type Lines } from "@gold/core";
import { cedis } from "@/features/calculator/format";
import { NoteCountInput } from "@/features/drawer/NoteCountInput";
import { TextField } from "@/shared/ui/TextField";
import { useReleaseTransfer } from "./api";
import { scaleCheck } from "./model";
import { ScaleReading } from "./ScaleReading";
import type { Transfer } from "./schemas";

function Form({
  transfer,
  onClose,
}: {
  transfer: Transfer;
  onClose: () => void;
}) {
  const release = useReleaseTransfer();
  const [lines, setLines] = useState<Lines>({});
  const [note, setNote] = useState("");
  const cash = transfer.kind === "cash";
  const goodsTop = transfer.lines.reduce(
    (s, l) => s + Number(l.releasedTop),
    0,
  );
  const goodsDown = transfer.lines.reduce(
    (s, l) => s + Number(l.releasedDown),
    0,
  );
  const goodsValue = transfer.lines.reduce(
    (s, l) => s + Number(l.releasedValue),
    0,
  );
  const [scaleTop, setScaleTop] = useState("");
  const [scaleDown, setScaleDown] = useState("");
  const typed =
    scaleTop.trim() !== "" &&
    scaleDown.trim() !== "" &&
    Number.isFinite(Number(scaleTop)) &&
    Number.isFinite(Number(scaleDown)) &&
    Number(scaleTop) >= 0 &&
    Number(scaleDown) >= 0;
  const check = typed
    ? scaleCheck(
        Number(scaleTop) - goodsTop,
        Number(scaleDown) - goodsDown,
        goodsTop,
        transfer.lines.length,
      )
    : null;
  const ok =
    !release.isPending &&
    (cash ? lineTotal(lines) > 0 : transfer.lines.length > 0 && typed) &&
    !!transfer.collector;
  return (
    <div className="space-y-4">
      <Alert
        type="warning"
        showIcon
        title={
          cash
            ? "These notes leave the drawer now."
            : "This gold leaves the branch books now."
        }
        description="Check that what you hand over is exactly what is written here. After this, the other branch confirms what arrived."
      />
      {!transfer.collector ? (
        <Alert type="error" showIcon title="Say who is carrying it first." />
      ) : null}
      {cash ? (
        <div>
          <p className="mb-2 text-sm font-medium">Notes being sent</p>
          <NoteCountInput value={lines} onChange={setLines} />
        </div>
      ) : (
        <div className="space-y-3">
          <p className="tnum rounded-lg bg-muted p-3 text-sm">
            {transfer.lines.length} piece
            {transfer.lines.length === 1 ? "" : "s"} · books: top{" "}
            <strong>{goodsTop.toFixed(2)} g</strong> · down{" "}
            <strong>{goodsDown.toFixed(2)} g</strong> · worth{" "}
            {cedis(goodsValue)}
          </p>
          <div>
            <p className="mb-1 text-sm font-medium">
              Put all the pieces on the scale together
            </p>
            <p className="mb-2 text-xs text-muted-foreground">
              Enter what the scale shows. It is recorded next to the books; a
              difference does not stop the transfer, but it is shown and a big
              one tells the reviewers.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="Scaled top (g)"
                inputMode="decimal"
                placeholder={goodsTop.toFixed(2)}
                value={scaleTop}
                onChange={(e) => setScaleTop(e.target.value)}
              />
              <TextField
                label="Scaled down (g)"
                inputMode="decimal"
                placeholder={goodsDown.toFixed(2)}
                value={scaleDown}
                onChange={(e) => setScaleDown(e.target.value)}
              />
            </div>
          </div>
          {check ? (
            <ScaleReading
              booksTop={goodsTop}
              booksDown={goodsDown}
              scaleTop={Number(scaleTop)}
              scaleDown={Number(scaleDown)}
              {...check}
            />
          ) : null}
        </div>
      )}
      <TextField
        label="Note (optional)"
        placeholder="e.g. sealed bag, number 14"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button
        type="button"
        disabled={!ok}
        onClick={() =>
          release.mutate(
            {
              id: transfer.id,
              ...(note.trim() ? { note: note.trim() } : {}),
              ...(cash
                ? { lines }
                : { scaledTop: scaleTop.trim(), scaledDown: scaleDown.trim() }),
            },
            { onSuccess: onClose },
          )
        }
        className="min-h-11 w-full rounded-lg bg-primary px-4 font-medium text-primary-foreground disabled:opacity-50"
      >
        {release.isPending ? "Saving…" : "Hand to the collector"}
      </button>
    </div>
  );
}

export function ReleaseModal({
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
      title="Hand to the collector"
      footer={null}
      destroyOnHidden
      width={540}
    >
      {transfer ? <Form transfer={transfer} onClose={onClose} /> : null}
    </Modal>
  );
}
