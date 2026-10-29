import { useState } from "react";
import { Alert, Input, Modal } from "antd";
import { lineTotal, type Lines } from "@gold/core";
import { useAuth } from "@/features/auth/store";
import { cedis } from "@/features/calculator/format";
import { NoteCountInput } from "@/features/drawer/NoteCountInput";
import {
  CustomerPicker,
  type CustomerValue,
} from "@/features/transactions/CustomerPicker";
import { decimalOnly } from "@/shared/lib/numbers";
import { TextField } from "@/shared/ui/TextField";
import { dateInDays } from "./model";
import { useIssueLoan } from "./api";

function Form({ onClose }: { onClose: () => void }) {
  const branchId = useAuth((s) => s.activeBranchId);
  const issue = useIssueLoan();
  const [commandId] = useState(() => crypto.randomUUID());
  const [customer, setCustomer] = useState<CustomerValue>({
    id: null,
    name: "",
    phone: "",
  });
  const [lines, setLines] = useState<Lines>({});
  const [reason, setReason] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [security, setSecurity] = useState(false);
  const [topWeight, setTopWeight] = useState("");
  const [description, setDescription] = useState("");

  const principal = lineTotal(lines);
  const weightOk = !security || Number(topWeight) > 0;
  const ok =
    !!branchId &&
    customer.name.trim().length > 0 &&
    principal > 0 &&
    weightOk &&
    !issue.isPending;

  function submit() {
    if (!ok || !branchId) return;
    issue.mutate(
      {
        id: commandId,
        branchId,
        partyType: "customer",
        customer: {
          id: customer.id,
          name: customer.name.trim(),
          phone: customer.phone.trim() || null,
        },
        principal: String(principal),
        lines,
        reason: reason.trim() || null,
        dueDate: dueDate || null,
        collateral: security
          ? {
              topWeight: topWeight.trim(),
              description: description.trim() || null,
            }
          : null,
        capturedAt: new Date().toISOString(),
      },
      { onSuccess: onClose },
    );
  }

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">1 · Who is the loan for?</h3>
        <CustomerPicker value={customer} onChange={setCustomer} />
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">
          2 · Cash handed to the customer
        </h3>
        <NoteCountInput value={lines} onChange={setLines} />
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">3 · Terms</h3>
        <TextField
          label="What is it for? (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div>
          <TextField
            label="Pay back by (optional)"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {[7, 14, 30].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setDueDate(dateInDays(n))}
                className="min-h-9 rounded-full border border-border bg-card px-3 text-xs font-medium hover:bg-muted"
              >
                In {n} days
              </button>
            ))}
            {dueDate ? (
              <button
                type="button"
                onClick={() => setDueDate("")}
                className="min-h-9 px-2 text-xs underline"
              >
                No date
              </button>
            ) : null}
          </div>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={security}
            onChange={(e) => setSecurity(e.target.checked)}
          />
          Customer leaves unrefined gold as security
        </label>
      </section>
      {security ? (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <TextField
            label="Top weight (g)"
            inputMode="decimal"
            value={topWeight}
            onChange={(e) => setTopWeight(decimalOnly(e.target.value))}
            hint="Only the top weight is recorded. The gold is kept safe and has no value until it is refined and bought."
          />
          <div>
            <label className="mb-1 block text-sm font-medium">
              Description (optional)
            </label>
            <Input.TextArea
              rows={2}
              maxLength={200}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. one lump, wrapped in red cloth"
            />
          </div>
        </div>
      ) : null}
      {principal > 0 ? (
        <div className="rounded-lg bg-muted p-3 text-sm">
          <div>
            <strong>{customer.name.trim() || "The customer"}</strong> takes{" "}
            <strong className="tnum">{cedis(principal)}</strong>
            {dueDate ? (
              <>
                {" "}
                and pays back by <strong>{dueDate}</strong>
              </>
            ) : null}
            .
          </div>
          {security && Number(topWeight) > 0 ? (
            <div className="text-muted-foreground">
              {topWeight} g of unrefined gold is held until the loan is paid.
            </div>
          ) : null}
        </div>
      ) : null}
      {issue.error ? (
        <Alert type="error" showIcon title={issue.error.message} />
      ) : null}
      <button
        type="button"
        onClick={submit}
        disabled={!ok}
        className="min-h-11 w-full rounded-lg bg-primary px-4 font-medium text-primary-foreground disabled:opacity-50"
      >
        {issue.isPending ? "Saving…" : `Give ${cedis(principal)} as a loan`}
      </button>
      <p className="text-center text-xs text-muted-foreground">
        Needs a connection and an open day. The cash leaves the drawer now.
      </p>
    </div>
  );
}

export function LoanModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="Give a loan"
      footer={null}
      destroyOnHidden
      width={560}
    >
      <Form onClose={onClose} />
    </Modal>
  );
}
