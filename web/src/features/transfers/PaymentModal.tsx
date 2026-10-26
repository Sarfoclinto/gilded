import { useState } from "react";
import { Alert, Modal, Segmented } from "antd";
import { lineTotal, type Lines } from "@gold/core";
import { useAuth } from "@/features/auth/store";
import { cedis } from "@/features/calculator/format";
import { NoteCountInput } from "@/features/drawer/NoteCountInput";
import { digitsOnly } from "@/shared/lib/numbers";
import { SelectField } from "@/shared/ui/SelectField";
import { TextField } from "@/shared/ui/TextField";
import { usePayTransfer } from "./api";
import type { Transfer } from "./schemas";

function Form({
  transfer,
  onClose,
}: {
  transfer: Transfer;
  onClose: () => void;
}) {
  const user = useAuth((s) => s.user);
  const pay = usePayTransfer();
  const [id] = useState(() => crypto.randomUUID());
  const mine = [transfer.originBranchId, transfer.destinationBranchId].filter(
    (b) => user?.branchIds.includes(b),
  );
  const [branchId, setBranchId] = useState(mine[0] ?? "");
  const [direction, setDirection] = useState<
    "paid_to_collector" | "received_from_collector"
  >("paid_to_collector");
  const [method, setMethod] = useState<"cash" | "mobile_money">("cash");
  const [lines, setLines] = useState<Lines>({});
  const [amountText, setAmountText] = useState("");
  const [purpose, setPurpose] = useState("");
  const [ref, setRef] = useState("");
  const amount = method === "cash" ? lineTotal(lines) : Number(amountText) || 0;
  const ok =
    amount > 0 && purpose.trim().length > 0 && !!branchId && !pay.isPending;
  const name = (b: string) =>
    b === transfer.originBranchId
      ? transfer.originBranchName
      : transfer.destinationBranchName;

  return (
    <div className="space-y-4">
      {mine.length > 1 ? (
        <SelectField
          label="Recorded at"
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
        >
          {mine.map((b) => (
            <option key={b} value={b}>
              {name(b)}
            </option>
          ))}
        </SelectField>
      ) : null}
      <Segmented
        block
        value={direction}
        onChange={(v) => setDirection(v as typeof direction)}
        options={[
          { label: "We paid the collector", value: "paid_to_collector" },
          { label: "Collector paid us", value: "received_from_collector" },
        ]}
      />
      <Segmented
        block
        value={method}
        onChange={(v) => setMethod(v as typeof method)}
        options={[
          { label: "Cash", value: "cash" },
          { label: "Mobile money", value: "mobile_money" },
        ]}
      />
      {method === "cash" ? (
        <NoteCountInput value={lines} onChange={setLines} />
      ) : (
        <>
          <TextField
            label="Amount (GHS)"
            inputMode="numeric"
            value={amountText}
            onChange={(e) => setAmountText(digitsOnly(e.target.value))}
          />
          <TextField
            label="Reference (optional)"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
          />
        </>
      )}
      <TextField
        label="What is it for?"
        placeholder="e.g. Transport, collection fee"
        value={purpose}
        onChange={(e) => setPurpose(e.target.value)}
      />
      {pay.error ? (
        <Alert type="error" showIcon title={pay.error.message} />
      ) : null}
      <button
        type="button"
        disabled={!ok}
        onClick={() =>
          pay.mutate(
            {
              id: transfer.id,
              data: {
                id,
                branchId,
                direction,
                amount: String(amount),
                method,
                purpose: purpose.trim(),
                ...(method === "cash"
                  ? { lines }
                  : ref.trim()
                    ? { externalRef: ref.trim() }
                    : {}),
              },
            },
            { onSuccess: onClose },
          )
        }
        className="min-h-11 w-full rounded-lg bg-primary px-4 font-medium text-primary-foreground disabled:opacity-50"
      >
        {pay.isPending ? "Saving…" : `Record ${cedis(amount)}`}
      </button>
    </div>
  );
}

export function PaymentModal({
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
      title="Money paid because of this transfer"
      footer={null}
      destroyOnHidden
      width={540}
    >
      {transfer ? <Form transfer={transfer} onClose={onClose} /> : null}
    </Modal>
  );
}
