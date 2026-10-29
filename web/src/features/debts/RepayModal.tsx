import { useState } from "react";
import { Alert, Modal, Segmented } from "antd";
import { lineTotal, type Lines } from "@gold/core";
import { useBranchNames } from "@/features/branches/api";
import { useAuth } from "@/features/auth/store";
import { cedis } from "@/features/calculator/format";
import { NoteCountInput } from "@/features/drawer/NoteCountInput";
import { digitsOnly } from "@/shared/lib/numbers";
import { SelectField } from "@/shared/ui/SelectField";
import { TextField } from "@/shared/ui/TextField";
import { useRepay } from "./api";
import { repaidShare } from "./model";
import type { Debt } from "./schemas";

function Form({ debt, onClose }: { debt: Debt; onClose: () => void }) {
  const me = useAuth((s) => s.activeBranchId);
  const branchNames = useBranchNames();
  const repay = useRepay();
  const [commandId] = useState(() => crypto.randomUUID());
  const receivable = debt.direction === "receivable";
  const outstanding = Number(debt.outstanding);
  const [method, setMethod] = useState<"cash" | "mobile_money">("cash");
  const [lines, setLines] = useState<Lines>({});
  const [amountText, setAmountText] = useState("");
  const [branch, setBranch] = useState(receivable ? "" : (me ?? ""));
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");

  const amount = method === "cash" ? lineTotal(lines) : Number(amountText) || 0;
  const ok =
    amount > 0 &&
    amount <= outstanding &&
    (method === "cash" || receivable || !!branch) &&
    !repay.isPending;

  function submit() {
    if (!ok) return;
    repay.mutate(
      {
        debtId: debt.id,
        cmd: {
          id: commandId,
          amount: String(amount),
          method,
          ...(method === "cash"
            ? { lines }
            : {
                paidByBranchId: branch || null,
                externalRef: ref.trim() || null,
              }),
          note: note.trim() || null,
          capturedAt: new Date().toISOString(),
        },
      },
      { onSuccess: onClose },
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-muted p-3 text-sm">
        <div className="font-medium">
          {debt.party.name}
          {debt.party.phone ? ` · ${debt.party.phone}` : ""}
        </div>
        <div className="tnum text-2xl font-bold">
          {cedis(outstanding)}{" "}
          <span className="text-sm font-normal text-muted-foreground">
            still owed of {cedis(Number(debt.principal))}
          </span>
        </div>
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-background"
          aria-hidden
        >
          <div
            className="h-full bg-emerald-600"
            style={{ width: `${Math.round(repaidShare(debt) * 100)}%` }}
          />
        </div>
      </div>
      <Segmented
        block
        value={method}
        onChange={(v) => setMethod(v as "cash" | "mobile_money")}
        options={[
          { label: "Cash", value: "cash" },
          { label: "Mobile money", value: "mobile_money" },
        ]}
      />
      {method === "cash" ? (
        <div>
          <p className="mb-2 text-sm font-medium">
            {receivable ? "Notes received" : "Notes paid out"}
          </p>
          <NoteCountInput value={lines} onChange={setLines} />
        </div>
      ) : (
        <>
          <div className="flex items-end gap-2">
            <TextField
              className="flex-1"
              label="Amount (GHS)"
              inputMode="numeric"
              value={amountText}
              onChange={(e) => setAmountText(digitsOnly(e.target.value))}
            />
            <button
              type="button"
              onClick={() => setAmountText(String(Math.floor(outstanding)))}
              className="min-h-11 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted"
            >
              All of it
            </button>
          </div>
          {!receivable ? (
            <SelectField
              label="Sent by branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
            >
              <option value="">Choose a branch…</option>
              {Object.entries(branchNames).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </SelectField>
          ) : null}
          <TextField
            label="Reference (optional)"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
          />
        </>
      )}
      <TextField
        label="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {amount > 0 && amount <= outstanding ? (
        <p className="tnum text-sm text-muted-foreground">
          {amount === outstanding
            ? "This clears the debt."
            : `${cedis(outstanding - amount)} will still be owed.`}
        </p>
      ) : null}
      {amount > outstanding ? (
        <Alert
          type="warning"
          showIcon
          title={`That is more than the ${cedis(outstanding)} outstanding.`}
        />
      ) : null}
      {repay.error ? (
        <Alert type="error" showIcon title={repay.error.message} />
      ) : null}
      <button
        type="button"
        onClick={submit}
        disabled={!ok}
        className="min-h-11 w-full rounded-lg bg-primary px-4 font-medium text-primary-foreground disabled:opacity-50"
      >
        {repay.isPending
          ? "Saving…"
          : receivable
            ? `Record ${cedis(amount)} received`
            : `Pay ${cedis(amount)}`}
      </button>
      <p className="text-center text-xs text-muted-foreground">
        Gold can also settle a debt: choose “Gold settles a debt” when buying
        from this customer.
      </p>
    </div>
  );
}

export function RepayModal({
  debt,
  onClose,
}: {
  debt: Debt | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={!!debt}
      onCancel={onClose}
      title={
        debt?.direction === "payable"
          ? "Pay what the branch owes"
          : "Record a repayment"
      }
      footer={null}
      destroyOnHidden
      width={540}
    >
      {debt ? <Form debt={debt} onClose={onClose} /> : null}
    </Modal>
  );
}
