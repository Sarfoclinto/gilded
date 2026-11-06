import { useMemo, useState } from "react";
import { Alert, Input, Modal } from "antd";
import { calculate, lineTotal, type Lines } from "@gold/core";
import { cedis } from "@/features/calculator/format";
import { NoteCountInput } from "@/features/drawer/NoteCountInput";
import { useActiveDrawer } from "@/features/drawer/hooks";
import { OUTBOX } from "@/features/drawer/schemas";
import { useSettings } from "@/features/settings/api";
import { useOutbox } from "@/shared/offline/OutboxProvider";
import { decimalOnly } from "@/shared/lib/numbers";
import { toast } from "@/shared/ui/toast";
import { payTransactionSchema } from "./schemas";
import type { TransactionView } from "./view";

const shortOf = (want: Lines, have: Lines | null): Record<string, number> => {
  const out: Record<string, number> = {};
  if (!have) return out;
  for (const [d, n] of Object.entries(want))
    if (n > (have[d] ?? 0)) out[d] = n - (have[d] ?? 0);
  return out;
};

/**
 * Hand over the cash for a purchase someone else (or you, a moment ago) saved. The amount is fixed by the purchase and cannot be
 * edited here: only which notes make it up. The notes start as the ones the recorder suggested. Queued like any drawer action, so it
 * works without a connection; the server pays a purchase once, so a second desk paying the same one is told it was already paid.
 */
export function PayModal({
  t,
  open,
  onClose,
}: {
  t: TransactionView;
  open: boolean;
  onClose: () => void;
}) {
  const outbox = useOutbox();
  const settings = useSettings();
  const { view: drawer } = useActiveDrawer();
  const due = Number(t.payout.cashDue);
  const [lines, setLines] = useState<Lines>(() => ({
    ...(t.payout.suggestedLines ?? {}),
  }));
  const blind = settings["payout.blindCheck"];
  const [checking, setChecking] = useState(blind);
  const [weights, setWeights] = useState<
    Array<{ top: string; down: string; price: string }>
  >(() => t.items.map(() => ({ top: "", down: "", price: "" })));
  const [busy, setBusy] = useState(false);

  const total = lineTotal(lines);
  const remaining = due - total;
  const short = useMemo(
    () => shortOf(lines, drawer.balance),
    [lines, drawer.balance],
  );
  const checkAmount = useMemo(() => {
    let sum = 0;
    for (const w of weights) {
      if (!w.top || !w.down || !w.price) return null;
      const r = calculate({ top: w.top, down: w.down, price: w.price });
      if (!r.amount) return null;
      sum += Number(r.amount);
    }
    return Math.round(sum * 100) / 100;
  }, [weights]);
  const needCheck = blind && checkAmount === null;
  const canPay =
    remaining === 0 &&
    Object.keys(short).length === 0 &&
    drawer.status === "open" &&
    !needCheck;

  const submit = async () => {
    if (!drawer.dayId)
      return toast.error("Open the day before paying cash out.");
    const cmd = {
      transactionId: t.id,
      branchId: t.branchId,
      lines,
      capturedAt: new Date().toISOString(),
      checkAmount:
        checking && checkAmount !== null ? String(checkAmount) : null,
    };
    const parsed = payTransactionSchema.safeParse(cmd);
    if (!parsed.success)
      return toast.error(parsed.error.issues[0]?.message ?? "Check the notes.");
    setBusy(true);
    // One entry per purchase: asking twice replaces the first instead of paying twice.
    const saved = await outbox.enqueue(`pay-${t.id}`, OUTBOX.PAY, parsed.data);
    if (!saved.ok) {
      setBusy(false);
      return toast.error(saved.message);
    }
    void outbox.syncNow();
    toast.success(`Paid out ${cedis(due)}`);
    setBusy(false);
    onClose();
  };

  return (
    <Modal
      title={`Pay out · ${t.reference ?? t.customerName}`}
      open={open}
      onCancel={onClose}
      onOk={() => void submit()}
      okText={`Hand over ${cedis(due)}`}
      okButtonProps={{ disabled: !canPay }}
      confirmLoading={busy}
      destroyOnHidden
    >
      <div className="space-y-4">
        <div className="rounded-xl border-2 border-foreground/80 p-3 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Pay {t.customerName}
          </p>
          <p className="tnum text-3xl font-black">{cedis(due)}</p>
          <p className="text-xs text-muted-foreground">
            The amount is fixed by the purchase. Only the notes can change.
          </p>
        </div>

        <div>
          <h3 className="mb-1 text-sm font-semibold">Notes you hand over</h3>
          <NoteCountInput value={lines} onChange={setLines} hideTotalCheck />
          <p
            role={remaining === 0 ? "status" : "alert"}
            className={`tnum mt-2 rounded-lg border p-2 text-sm ${remaining === 0 ? "border-emerald-500/50 bg-emerald-500/10" : "border-amber-500/50 bg-amber-500/10"}`}
          >
            {remaining === 0
              ? `Adds up exactly: ${cedis(total)}`
              : remaining > 0
                ? `Still to hand over: ${cedis(remaining)}`
                : `Too much by ${cedis(-remaining)}`}
          </p>
        </div>

        {Object.keys(short).length > 0 ? (
          <Alert
            type="error"
            showIcon
            title={`The drawer does not have enough: ${Object.entries(short)
              .map(([d, n]) => `GHS ${d} (${n} short)`)
              .join(", ")}.`}
          />
        ) : null}
        {drawer.status !== "open" ? (
          <Alert
            type="warning"
            showIcon
            title="The day is not open here, so cash cannot be paid out yet."
          />
        ) : null}

        <div className="rounded-xl border border-dashed border-border p-3">
          <label className="flex items-center justify-between gap-2 text-sm font-medium">
            <span>
              Check against the weights{blind ? " (required)" : " (optional)"}
            </span>
            {blind ? null : (
              <input
                type="checkbox"
                checked={checking}
                onChange={(e) => setChecking(e.target.checked)}
                aria-label="Check against the weights"
              />
            )}
          </label>
          {checking ? (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-muted-foreground">
                Enter top, down and price from the receipt and the gold, the way
                you would in your sheet. It must match what was recorded.
              </p>
              {t.items.map((it, i) => (
                <div key={it.id} className="grid grid-cols-3 gap-2">
                  {(["top", "down", "price"] as const).map((k) => (
                    <Input
                      key={k}
                      size="large"
                      inputMode="decimal"
                      placeholder={
                        k === "top"
                          ? "Top"
                          : k === "down"
                            ? "Down"
                            : "Price per lb"
                      }
                      aria-label={`${t.items.length > 1 ? `Item ${i + 1} ` : ""}${k}`}
                      value={weights[i]?.[k] ?? ""}
                      onChange={(e) =>
                        setWeights((w) =>
                          w.map((x, j) =>
                            j === i
                              ? { ...x, [k]: decimalOnly(e.target.value) }
                              : x,
                          ),
                        )
                      }
                    />
                  ))}
                </div>
              ))}
              <p className="tnum text-sm">
                {checkAmount === null
                  ? "Your figure: fill in every box"
                  : `Your figure: ${cedis(checkAmount)} (before rounding to notes)`}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
