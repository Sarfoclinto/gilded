import { useState } from "react";
import { Alert, Input, Modal } from "antd";
import { BanIcon } from "lucide-react";
import { cedis } from "@/features/calculator/format";
import { dayKeys } from "@/features/drawer/api";
import { debtKeys, collateralKeys } from "@/features/debts/api";
import { paymentKeys } from "@/features/payments/api";
import { useApiMutation } from "@/shared/api/hooks";
import { toast } from "@/shared/ui/toast";
import { transactionKeys, transactionsApi } from "./api";
import { paymentMethodText, type TransactionView } from "./view";

const MIN_REASON = 5;

/**
 * Cancelling a wrongly saved purchase. The person says why; the server puts back everything the purchase did (gold off the books, cash
 * back into the drawer that is open now, an amount owed closed, a debt settled with this gold owed again, security held again) by new
 * entries. The purchase stays, marked cancelled, so the receipt number is never reused and the history shows what happened.
 */
export function CancelModal({
  open,
  onClose,
  t,
}: {
  open: boolean;
  onClose: () => void;
  t: TransactionView;
}) {
  const [reason, setReason] = useState("");
  const [sure, setSure] = useState(false);
  const cash = t.payments
    .filter((p) => p.method === "cash" && p.status !== "failed")
    .reduce((s, p) => s + Number(p.amount), 0);
  const others = t.payments.filter(
    (p) => p.method !== "cash" && p.status !== "failed",
  );
  const sent = others.some(
    (p) => p.method === "mobile_money" && p.status === "confirmed",
  );

  const cancel = useApiMutation({
    mutationFn: () => transactionsApi.cancel(t.id, reason.trim()),
    invalidates: [
      transactionKeys.all,
      dayKeys.all,
      debtKeys.all,
      collateralKeys.all,
      paymentKeys.all,
    ],
    silent: true,
    onSuccess: (r) => {
      toast.success(
        `${t.reference ?? "The purchase"} is cancelled${Number(r.cashBack) > 0 ? `. ${cedis(r.cashBack!)} is back in the drawer` : ""}.`,
      );
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const ok =
    reason.trim().length >= MIN_REASON && sure && !cancel.isPending && !sent;
  return (
    <Modal
      open={open}
      onCancel={onClose}
      centered
      destroyOnHidden
      title={
        <span className="flex items-center gap-2">
          <BanIcon className="size-5 text-red-600" aria-hidden />
          Cancel this purchase
        </span>
      }
      okText={cancel.isPending ? "Cancelling…" : "Cancel the purchase"}
      okButtonProps={{ danger: true, disabled: !ok, loading: cancel.isPending }}
      cancelText="Keep it"
      onOk={() => cancel.mutate()}
      styles={{ body: { maxHeight: "70dvh", overflowY: "auto" } }}
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
          <div className="font-semibold">{t.customerName}</div>
          <div className="text-muted-foreground">
            {t.reference ?? "Not numbered yet"} · {t.items.length} piece
            {t.items.length === 1 ? "" : "s"} · {cedis(t.payout.payable)}
          </div>
        </div>

        {sent ? (
          <Alert
            type="error"
            showIcon
            title="Mobile money for this purchase has already been sent and confirmed."
            description="Get the money back first and record the refund by hand. This purchase cannot be cancelled here."
          />
        ) : (
          <div className="space-y-2 text-sm">
            <p className="font-medium">What cancelling does</p>
            <ul className="space-y-1.5">
              <li className="flex gap-2">
                <span
                  className="mt-0.5 size-1.5 shrink-0 rounded-full bg-red-500"
                  aria-hidden
                />
                <span>
                  The gold comes <b>off the books</b>. Hand it back to the
                  customer.
                </span>
              </li>
              {cash > 0 ? (
                <li className="flex gap-2">
                  <span
                    className="mt-0.5 size-1.5 shrink-0 rounded-full bg-red-500"
                    aria-hidden
                  />
                  <span>
                    <b>{cedis(cash)} in cash</b> goes back into the drawer that
                    is open now. Take it back from the customer, note for note
                    if you can.
                  </span>
                </li>
              ) : null}
              {t.payout.stage === "to_pay" ? (
                <li className="flex gap-2">
                  <span
                    className="mt-0.5 size-1.5 shrink-0 rounded-full bg-red-500"
                    aria-hidden
                  />
                  <span>
                    The cash still to be paid is <b>no longer owed</b>.
                  </span>
                </li>
              ) : null}
              {others.map((p) => (
                <li key={p.id} className="flex gap-2">
                  <span
                    className="mt-0.5 size-1.5 shrink-0 rounded-full bg-red-500"
                    aria-hidden
                  />
                  <span>
                    {p.method === "owed" ? (
                      <>
                        The <b>{cedis(p.amount)} owed</b> to the customer for it
                        is closed.
                      </>
                    ) : null}
                    {p.method === "debt_offset" ? (
                      <>
                        The customer's debt that <b>{cedis(p.amount)}</b> of
                        this gold settled is <b>owed again</b>.
                      </>
                    ) : null}
                    {p.method === "mobile_money" ? (
                      <>
                        The <b>{cedis(p.amount)} mobile money</b> that was not
                        sent yet is marked failed. Do not send it.
                      </>
                    ) : null}
                    {!["owed", "debt_offset", "mobile_money"].includes(
                      p.method,
                    ) ? (
                      <>
                        {paymentMethodText[p.method] ?? p.method}{" "}
                        {cedis(p.amount)} is reversed.
                      </>
                    ) : null}
                  </span>
                </li>
              ))}
              <li className="flex gap-2">
                <span
                  className="mt-0.5 size-1.5 shrink-0 rounded-full bg-muted-foreground"
                  aria-hidden
                />
                <span>
                  The purchase stays in the history, marked cancelled with your
                  reason. Nothing is deleted, and the receipt number is not
                  reused.
                </span>
              </li>
            </ul>
          </div>
        )}

        {!sent ? (
          <>
            <div>
              <label
                className="mb-1 block text-sm font-medium"
                htmlFor="cancel-reason"
              >
                Why is it cancelled?
              </label>
              <Input.TextArea
                id="cancel-reason"
                rows={3}
                maxLength={500}
                autoFocus
                placeholder="e.g. Wrong customer chosen · Weighed on a faulty scale · Saved twice by mistake"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                status={
                  reason.trim().length > 0 && reason.trim().length < MIN_REASON
                    ? "warning"
                    : undefined
                }
              />
              <p className="mt-1 text-xs text-muted-foreground">
                At least {MIN_REASON} characters. The reviewers of this branch
                are told, and it goes in the audit trail.
              </p>
            </div>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1 size-4 accent-red-600"
                checked={sure}
                onChange={(e) => setSure(e.target.checked)}
              />
              <span>
                I have the gold {cash > 0 ? "and the cash " : ""}in hand, and
                this cannot be undone.
              </span>
            </label>
            {cancel.error ? (
              <Alert type="error" showIcon title={cancel.error.message} />
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}
