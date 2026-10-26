import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Alert } from "antd";
import { calculate } from "@gold/core";
import paths from "@/config/paths";
import { useAuth } from "@/features/auth/store";
import { useActiveDrawer } from "@/features/drawer/hooks";
import { useCurrentPrice } from "@/features/prices/api";
import { cedis } from "@/features/calculator/format";
import {
  PayoutPanel,
  type PayoutSelection,
} from "@/features/calculator/PayoutPanel";
import { useCollateral, useDebts } from "@/features/debts/api";
import { useOutbox } from "@/shared/offline/OutboxProvider";
import { useConnectivity } from "@/shared/offline/connectivity";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { TextField } from "@/shared/ui/TextField";
import { toast } from "@/shared/ui/toast";
import { TX_CREATE } from "@/app/outbox";
import { decimalOnly as decimalInput } from "@/shared/lib/numbers";
import {
  CustomerPicker,
  type CustomerValue,
  type RepresentativeValue,
} from "../CustomerPicker";
import { useCustomerDirectory } from "@/features/customers/directory";
import { createTransactionSchema } from "../schemas";
import { SplitEditor } from "../SplitEditor";
import {
  newSplit,
  nonCashTotal,
  splitProblems,
  toSplitParts,
  type SplitDraft,
} from "../split";

const MAX_ITEMS = 20;

interface DraftItem {
  id: string;
  label: string;
  top: string;
  down: string;
  price: string;
  priceTouched: boolean;
}
const newItem = (price = ""): DraftItem => ({
  id: crypto.randomUUID(),
  label: "",
  top: "",
  down: "",
  price,
  priceTouched: false,
});

export default function NewTransactionPage() {
  const navigate = useNavigate();
  const branchId = useAuth((s) => s.activeBranchId);
  const online = useConnectivity((s) => s.online);
  const priceQuery = useCurrentPrice(branchId);
  const outbox = useOutbox();
  const { view: drawer, settled } = useActiveDrawer();
  // Block only when we KNOW there is no open day. If the drawer was never loaded (first launch offline), allow it; the server flags it.
  const dayBlocked =
    settled && (drawer.status === "none" || drawer.status === "closed");

  // One id per form session: tapping Save twice can only ever create one transaction.
  const txId = useRef(crypto.randomUUID());
  const [customer, setCustomer] = useState<CustomerValue>({
    id: null,
    name: "",
    phone: "",
  });
  const [rep, setRep] = useState<RepresentativeValue | null>(null);
  // A new customer gets its id here, on the device, so it works offline and the representative can be tied to it.
  const newCustomerId = useRef(crypto.randomUUID());
  const [parts, setParts] = useState<SplitDraft[]>([]);

  // Arriving from "Refine and buy" on held gold: the customer is fixed and the held gold is released by this purchase.
  const [params] = useSearchParams();
  const collateralId = params.get("collateral");
  const held = useCollateral({ branchId, status: "held" }, !!collateralId);
  const security = collateralId
    ? ((held.data ?? []).find((c) => c.id === collateralId) ?? null)
    : null;
  useEffect(() => {
    if (security)
      setCustomer({
        id: security.customer.id,
        name: security.customer.name,
        phone: security.customer.phone ?? "",
      });
  }, [security]);
  // The customer's open debts to this branch, for "gold settles a debt".
  const debts = useDebts(
    {
      branchId,
      direction: "receivable",
      openOnly: true,
      customerId: customer.id,
    },
    !!customer.id,
  );
  const customerDebts = customer.id ? (debts.data ?? []) : [];
  const [items, setItems] = useState<DraftItem[]>([newItem()]);
  const [payout, setPayout] = useState<PayoutSelection | null>(null);
  const [saving, setSaving] = useState(false);

  // Fill each item's price from today's price until the person types their own.
  useEffect(() => {
    const p = priceQuery.data?.effectivePrice;
    if (p)
      setItems((prev) =>
        prev.map((i) => (i.priceTouched || i.price ? i : { ...i, price: p })),
      );
  }, [priceQuery.data]);

  const patch = (id: string, change: Partial<DraftItem>) =>
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, ...change } : i)),
    );

  const results = useMemo(
    () =>
      items.map((i) => calculate({ top: i.top, down: i.down, price: i.price })),
    [items],
  );
  const complete = results.every(
    (r) => r.amount !== null && r.errors.length === 0,
  );
  const total = complete
    ? results.reduce((s, r) => s + Number(r.amount), 0)
    : 0;
  // Ignore repeats of the same payout so the panel's effect can never cause a render loop.
  const onPayout = useCallback(
    (p: PayoutSelection | null) =>
      setPayout((prev) =>
        JSON.stringify(prev) === JSON.stringify(p) ? prev : p,
      ),
    [],
  );

  const nonCash = nonCashTotal(parts);
  const payableNow = payout ? Number(payout.payable) : 0;
  const problems = splitProblems(parts, {
    payable: payableNow || total,
    customerPicked: !!customer.id,
    customerReady:
      customer.name.trim().length > 0 && customer.phone.trim().length >= 6,
    outstanding: Object.fromEntries(
      customerDebts.map((d) => [d.id, Math.floor(Number(d.outstanding))]),
    ),
  });
  const needsPrice = priceQuery.notSet;

  const phoneOk = customer.phone.replace(/\D/g, "").length >= 6;
  const repOk =
    rep === null || (rep.name.trim().length > 0 && (!!customer.id || phoneOk));
  const canSave =
    repOk &&
    !!branchId &&
    customer.name.trim().length > 0 &&
    complete &&
    total > 0 &&
    payout !== null &&
    problems.length === 0 &&
    outbox.ready &&
    !saving &&
    !dayBlocked;

  async function save() {
    if (!canSave || !branchId || !payout) return;
    setSaving(true);
    const cmd = {
      id: txId.current,
      branchId,
      customerId: customer.id ?? (phoneOk ? newCustomerId.current : null),
      collateralId: security?.id ?? null,
      customerName: customer.name.trim(),
      customerPhone: customer.phone.trim() || null,
      representative:
        rep && rep.name.trim()
          ? { name: rep.name.trim(), phone: rep.phone.trim() || null }
          : null,
      items: items.map((i) => ({
        id: i.id,
        label: i.label.trim() || null,
        top: i.top,
        down: i.down,
        price: i.price,
      })),
      clientAmount: String(total),
      payout: {
        policy: payout.policy,
        strategy: payout.strategy,
        payable: payout.payable,
        lines: payout.lines,
        ...(parts.length ? { split: toSplitParts(parts) } : {}),
      },
      capturedAt: new Date().toISOString(),
      priceAsOf: priceQuery.data?.asOf ?? new Date().toISOString(),
    };
    const parsed = createTransactionSchema.safeParse(cmd);
    if (!parsed.success) {
      setSaving(false);
      toast.error(parsed.error.issues[0]?.message ?? "Check the form.");
      return;
    }
    if (cmd.customerId)
      useCustomerDirectory
        .getState()
        .remember({
          id: cmd.customerId,
          name: cmd.customerName,
          phone: cmd.customerPhone,
          atBranch: true,
        });
    await outbox.enqueue(cmd.id, TX_CREATE, parsed.data);
    toast.success(
      online
        ? "Saved"
        : "Saved on this device. It will sync when you are back online.",
    );
    void outbox.syncNow();
    navigate(paths.transactions.detail.to(cmd.id), { replace: true });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-8">
      <h1 className="text-xl font-bold">New transaction</h1>

      {dayBlocked ? (
        <Card
          role="alert"
          className="flex items-center justify-between gap-3 border-amber-500/60 bg-amber-500/10"
        >
          <p className="text-sm">
            {drawer.status === "closed"
              ? "Today is closed."
              : "The day is not open."}{" "}
            Open the day before paying customers.
          </p>
          <Link to={paths.drawer.open.href}>
            <Button variant="secondary">Open day</Button>
          </Link>
        </Card>
      ) : null}

      {needsPrice ? (
        <Alert
          type="warning"
          showIcon
          title="No price has been set for this branch yet."
          description="Enter the price per pound on each item, or ask a manager to publish today's price."
        />
      ) : null}
      {collateralId ? (
        security ? (
          <Alert
            type="info"
            showIcon
            title={`Buying the ${security.topWeight} g held as security for ${security.customer.name}`}
            description="Saving releases the held gold. To settle their loan with it, add “Gold settles a debt” under the payout."
            action={
              security.debtOutstanding &&
              Number(security.debtOutstanding) > 0 &&
              !parts.some((p) => p.method === "debt_offset") ? (
                <Button
                  variant="secondary"
                  onClick={() =>
                    setParts((p) => [
                      ...p,
                      newSplit("debt_offset", {
                        debtId: security.debtId,
                        amount: String(
                          Math.floor(Number(security.debtOutstanding)),
                        ),
                      }),
                    ])
                  }
                >
                  Settle the loan
                </Button>
              ) : undefined
            }
          />
        ) : held.isLoading ? null : (
          <Alert
            type="error"
            showIcon
            title="That held gold was not found or is no longer held."
          />
        )
      ) : null}

      <Card>
        <CustomerPicker
          value={customer}
          onChange={setCustomer}
          locked={!!security}
          branchId={branchId ?? null}
          representative={rep}
          onRepresentative={setRep}
        />
      </Card>

      {items.map((it, idx) => {
        const r = results[idx]!;
        const err = (f: "top" | "down" | "price") =>
          r.errors.find((e) => e.field === f)?.message;
        return (
          <Card key={it.id} className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Item {idx + 1}</h2>
              {items.length > 1 ? (
                <button
                  className="min-h-10 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted"
                  onClick={() =>
                    setItems((p) => p.filter((x) => x.id !== it.id))
                  }
                >
                  Remove
                </button>
              ) : null}
            </div>
            <TextField
              label="Description (optional)"
              placeholder="e.g. ring, nuggets"
              value={it.label}
              onChange={(e) => patch(it.id, { label: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="Top (g)"
                inputMode="decimal"
                value={it.top}
                onChange={(e) =>
                  patch(it.id, { top: decimalInput(e.target.value) })
                }
                error={err("top")}
              />
              <TextField
                label="Down (g)"
                inputMode="decimal"
                value={it.down}
                onChange={(e) =>
                  patch(it.id, { down: decimalInput(e.target.value) })
                }
                error={err("down")}
              />
              <TextField
                className="col-span-2"
                label="Price per pound (GHS)"
                inputMode="decimal"
                value={it.price}
                onChange={(e) =>
                  patch(it.id, {
                    price: decimalInput(e.target.value),
                    priceTouched: true,
                  })
                }
                error={err("price")}
              />
            </div>
            {r.warnings.map((w) => (
              <p
                key={w.code}
                role="alert"
                className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-2 text-xs"
              >
                {w.message}
              </p>
            ))}
            <div className="tnum flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">
                {r.karat
                  ? `${r.karat} karat · ${r.netWeight} g net`
                  : "Fill in the weights"}
              </span>
              <strong className="text-lg">
                {r.amount ? cedis(r.amount) : "—"}
              </strong>
            </div>
          </Card>
        );
      })}

      <Button
        variant="secondary"
        className="w-full"
        disabled={items.length >= MAX_ITEMS}
        onClick={() =>
          setItems((p) => [...p, newItem(priceQuery.data?.effectivePrice)])
        }
      >
        Add another item
      </Button>

      <Card className="flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">
          Total ({items.length} item{items.length > 1 ? "s" : ""})
        </span>
        <span className="tnum text-3xl font-bold">
          {complete && total > 0 ? cedis(total) : "—"}
        </span>
      </Card>

      {complete && total > 0 ? (
        <PayoutPanel
          amount={total}
          onResult={onPayout}
          nonCash={nonCash}
          split={(payable) => (
            <SplitEditor
              parts={parts}
              onChange={setParts}
              payable={payable}
              debts={customerDebts}
              customerPicked={!!customer.id}
              problems={problems}
            />
          )}
        />
      ) : null}

      <div className="sticky bottom-0 -mx-4 border-t border-border bg-background/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur">
        {!online ? (
          <p className="mb-2 text-center text-xs text-amber-700 dark:text-amber-300">
            Offline: this will be saved on this device and sent later.
          </p>
        ) : null}
        <Button
          className="w-full"
          onClick={() => void save()}
          disabled={!canSave}
          loading={saving}
        >
          Save transaction
        </Button>
        {!outbox.durable ? (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            This browser cannot keep offline data after you close it.
          </p>
        ) : null}
      </div>
    </div>
  );
}
