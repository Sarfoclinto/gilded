import { useEffect, useState } from "react";
import { Alert, Modal, Segmented } from "antd";
import { lineTotal, type Lines } from "@gold/core";
import { useBranchNames } from "@/features/branches/api";
import { cedis } from "@/features/calculator/format";
import { NoteCountInput } from "@/features/drawer/NoteCountInput";
import { digitsOnly } from "@/shared/lib/numbers";
import { Button } from "@/shared/ui/Button";
import { SelectField } from "@/shared/ui/SelectField";
import { TextField } from "@/shared/ui/TextField";
import { useConfirmPayment, useFailPayment, type Replacement } from "./api";

export interface ResolveTarget {
  transactionId: string;
  paymentId: string;
  amount: string;
  customerName: string;
  reference?: string | null;
}

interface Row {
  key: string;
  kind: Replacement["kind"];
  amount: string;
  lines: Lines;
  branch: string;
}
const row = (kind: Row["kind"] = "cash"): Row => ({
  key: crypto.randomUUID(),
  kind,
  amount: "",
  lines: {},
  branch: "",
});
const rowAmount = (r: Row) =>
  r.kind === "cash" ? lineTotal(r.lines) : Number(r.amount) || 0;

/**
 * Someone at the sending branch says what happened to a mobile money part: it arrived (confirm),
 * or it did not (failed), in which case what the customer is still owed must be paid another way.
 */
export function ResolvePaymentModal({
  target,
  onClose,
}: {
  target: ResolveTarget | null;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"confirm" | "fail">("confirm");
  const [rows, setRows] = useState<Row[]>([row()]);
  const confirm = useConfirmPayment();
  const fail = useFailPayment();
  const branchNames = useBranchNames();

  useEffect(() => {
    if (target) {
      setMode("confirm");
      setRows([row()]);
      confirm.reset();
      fail.reset();
    }
  }, [target?.paymentId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!target) return null;
  const amount = Number(target.amount);
  const covered = rows.reduce((s, r) => s + rowAmount(r), 0);
  const rest = amount - covered;
  const rowsOk = rows.every(
    (r) => rowAmount(r) > 0 && (r.kind !== "mobile_money" || r.branch),
  );
  const canFail = rest === 0 && rowsOk;
  const patch = (key: string, p: Partial<Row>) =>
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const busy = confirm.isPending || fail.isPending;
  const err = (mode === "confirm" ? confirm.error : fail.error)?.message;

  function submit() {
    if (!target) return;
    const done = { onSuccess: onClose };
    if (mode === "confirm")
      return confirm.mutate(
        { transactionId: target.transactionId, paymentId: target.paymentId },
        done,
      );
    if (!canFail) return;
    const replacements: Replacement[] = rows.map((r) =>
      r.kind === "cash"
        ? { kind: "cash", amount: String(lineTotal(r.lines)), lines: r.lines }
        : {
            kind: r.kind,
            amount: String(Number(r.amount)),
            paidByBranchId: r.kind === "mobile_money" ? r.branch : null,
          },
    );
    fail.mutate(
      {
        transactionId: target.transactionId,
        paymentId: target.paymentId,
        replacements,
      },
      done,
    );
  }

  return (
    <Modal
      open
      onCancel={onClose}
      title={`${cedis(amount)} mobile money for ${target.customerName}`}
      footer={null}
      destroyOnHidden
      width={560}
    >
      <div className="space-y-4">
        <Segmented
          block
          value={mode}
          onChange={(v) => setMode(v as "confirm" | "fail")}
          options={[
            { label: "It was sent", value: "confirm" },
            { label: "It did not go through", value: "fail" },
          ]}
        />
        {mode === "confirm" ? (
          <p className="text-sm text-muted-foreground">
            Confirm only after the money has really left this branch’s mobile
            money account and reached the customer.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Say how the customer is paid instead. The parts must add up to{" "}
              {cedis(amount)}.
            </p>
            {rows.map((r) => (
              <div
                key={r.key}
                className="space-y-2 rounded-lg border border-border p-3"
              >
                <div className="flex items-end gap-2">
                  <SelectField
                    className="flex-1"
                    label="Paid by"
                    value={r.kind}
                    onChange={(e) =>
                      patch(r.key, { kind: e.target.value as Row["kind"] })
                    }
                  >
                    <option value="cash">Cash from the drawer</option>
                    <option value="mobile_money">Mobile money again</option>
                    <option value="owed">The branch owes them</option>
                  </SelectField>
                  {rows.length > 1 ? (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setRows((all) => all.filter((x) => x.key !== r.key))
                      }
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
                {r.kind === "cash" ? (
                  <NoteCountInput
                    value={r.lines}
                    onChange={(lines) => patch(r.key, { lines })}
                  />
                ) : (
                  <TextField
                    label="Amount (GHS)"
                    inputMode="numeric"
                    value={r.amount}
                    onChange={(e) =>
                      patch(r.key, { amount: digitsOnly(e.target.value) })
                    }
                  />
                )}
                {r.kind === "mobile_money" ? (
                  <SelectField
                    label="Sent by branch"
                    value={r.branch}
                    onChange={(e) => patch(r.key, { branch: e.target.value })}
                  >
                    <option value="">Choose a branch…</option>
                    {Object.entries(branchNames).map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </SelectField>
                ) : null}
              </div>
            ))}
            <div className="flex items-center justify-between">
              <Button
                variant="secondary"
                onClick={() => setRows((all) => [...all, row("owed")])}
              >
                Add another way
              </Button>
              <span
                className={`tnum text-sm font-medium ${rest === 0 ? "text-emerald-600" : "text-amber-600"}`}
              >
                {rest === 0
                  ? "Covered"
                  : rest > 0
                    ? `${cedis(rest)} still to cover`
                    : `${cedis(-rest)} too much`}
              </span>
            </div>
          </div>
        )}
        {err ? <Alert type="error" showIcon title={err} /> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            loading={busy}
            disabled={busy || (mode === "fail" && !canFail)}
          >
            {mode === "confirm" ? "Mark as received" : "Mark as failed"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
