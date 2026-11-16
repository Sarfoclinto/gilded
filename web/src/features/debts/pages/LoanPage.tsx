import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Input } from "antd";
import { lineTotal, type Lines } from "@gold/core";
import paths from "@/config/paths";
import { useAuth } from "@/features/auth/store";
import { useBranchNames } from "@/features/branches/api";
import { cedis } from "@/features/calculator/format";
import { NoteCountInput } from "@/features/drawer/NoteCountInput";
import { PhotoDraft } from "@/features/photos/PhotoDraft";
import { usePhotoQueue } from "@/features/photos/PhotoProvider";
import type { Prepared } from "@/features/photos/process";
import {
  CustomerPicker,
  type CustomerValue,
} from "@/features/transactions/CustomerPicker";
import { decimalOnly } from "@/shared/lib/numbers";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { TextField } from "@/shared/ui/TextField";
import { CustomerDebtNotice } from "../CustomerDebtNotice";
import { useIssueLoan } from "../api";
import { dateInDays } from "../model";

/**
 * Give a loan, on its own page (it was a window). Four short steps down one page: who, the cash, the terms, and, if the customer leaves
 * unrefined gold as security, its weight and an optional photo of it on the scale. The photo is never required. The loan needs a
 * connection and an open day, as before; the photos are sent in the background once the loan is saved.
 */
export default function LoanPage() {
  const navigate = useNavigate();
  const branchId = useAuth((s) => s.activeBranchId);
  const user = useAuth((s) => s.user);
  const branchName = useBranchNames()[branchId ?? ""] ?? "Branch";
  const queue = usePhotoQueue();
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
  const [photos, setPhotos] = useState<Prepared[]>([]);

  const principal = lineTotal(lines);
  const weightOk = !security || Number(topWeight) > 0;
  const known = !!customer.id || customer.phone.replace(/\D/g, "").length >= 6; // the borrower must be someone we can find again
  const ok =
    !!branchId &&
    customer.name.trim().length > 0 &&
    known &&
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
      {
        onSuccess: (debt) => {
          // the held gold now exists: hand it the photos; they send in the background, so nothing waits for them
          const heldId = debt.collateral?.id;
          if (security && heldId && queue && user)
            for (const p of photos)
              void queue.add(
                p,
                {
                  entityType: "collateral",
                  entityId: heldId,
                  slot: "collateral",
                },
                user.id,
              );
          navigate(paths.debts.href, { replace: true });
        },
      },
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-3 pb-28 sm:p-4 lg:p-6">
      <Link
        to={paths.debts.href}
        className="text-sm text-muted-foreground underline"
      >
        ← Debts and loans
      </Link>
      <div>
        <h1 className="text-xl font-bold">Give a loan</h1>
        <p className="text-sm text-muted-foreground">
          Needs a connection and an open day. The cash leaves the drawer now.
        </p>
      </div>

      <Card className="space-y-2">
        <h2 className="text-sm font-semibold">1 · Who is the loan for?</h2>
        <CustomerPicker
          value={customer}
          onChange={setCustomer}
          branchId={branchId ?? null}
        />
        <CustomerDebtNotice
          customerId={customer.id}
          name={customer.name}
          adding={principal}
        />
      </Card>

      <Card className="space-y-2">
        <h2 className="text-sm font-semibold">
          2 · Cash handed to the customer
        </h2>
        <NoteCountInput value={lines} onChange={setLines} />
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">3 · Terms</h2>
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
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">4 · Security</h2>
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={security}
            onChange={(e) => setSecurity(e.target.checked)}
          />
          Customer leaves unrefined gold as security
        </label>
        {security ? (
          <div className="space-y-3">
            <TextField
              label="Top weight (g)"
              inputMode="decimal"
              value={topWeight}
              onChange={(e) => setTopWeight(decimalOnly(e.target.value))}
              hint="Only the top weight is recorded. The gold is kept safe and has no value until it is refined and bought."
            />
            <PhotoDraft
              value={photos}
              onChange={setPhotos}
              title="Photo of the gold on the scale (optional)"
              hint="Nothing is blocked if you skip it. It shows what was left, and its weight, if there is ever a question."
              branchName={branchName}
              reference={
                customer.name.trim()
                  ? `Loan · ${customer.name.trim()}`
                  : "Loan security"
              }
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
      </Card>

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
              {topWeight} g of unrefined gold is held until the loan is paid
              {photos.length
                ? `, with ${photos.length} photo${photos.length === 1 ? "" : "s"}`
                : ""}
              .
            </div>
          ) : null}
        </div>
      ) : null}
      {issue.error ? (
        <Alert type="error" showIcon title={issue.error.message} />
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto max-w-2xl">
          <Button
            className="w-full"
            onClick={submit}
            disabled={!ok}
            loading={issue.isPending}
          >
            Give {cedis(principal)} as a loan
          </Button>
        </div>
      </div>
    </div>
  );
}
