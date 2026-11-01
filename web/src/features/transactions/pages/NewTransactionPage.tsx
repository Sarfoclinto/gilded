import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { readPrefill } from "@/features/calculator/carryOver";
import { Alert } from "antd";
import { calculate } from "@gold/core";
import paths from "@/config/paths";
import { useAuth } from "@/features/auth/store";
import { useActiveDrawer } from "@/features/drawer/hooks";
import { useCurrentPrice } from "@/features/prices/api";
import { cedis, percent } from "@/features/calculator/format";
import { useSettings } from "@/features/settings/api";
import {
  opensReceipt,
  usePersonalSettings,
} from "@/features/settings/personal";
import {
  PayoutPanel,
  type PayoutSelection,
} from "@/features/calculator/PayoutPanel";
import { useCollateral, useDebts } from "@/features/debts/api";
import { useOutbox } from "@/shared/offline/OutboxProvider";
import { useConnectivity } from "@/shared/offline/connectivity";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { PageHeader } from "@/shared/ui/PageHeader";
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
import { TownPicker, type TownValue } from "@/features/towns/TownPicker";
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
  const companySettings = useSettings();
  const twoStep = companySettings["payout.twoStep"];
  const openReceipt = usePersonalSettings((s) => s.openReceipt);
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
  const [town, setTown] = useState<TownValue | null>(null);
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
  // Arriving from a calculator ("Save as a purchase"): the first item starts with its values. Nothing is saved until Save here.
  const location = useLocation();
  const [items, setItems] = useState<DraftItem[]>(() => {
    const pre = readPrefill(location.state);
    return pre
      ? [
          {
            ...newItem(pre.price),
            top: pre.top,
            down: pre.down,
            priceTouched: pre.priceTouched,
          },
        ]
      : [newItem()];
  });
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

  // Already on this page when the panel's "Save as a purchase" is used: add the values as one more item, keeping what is typed.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const pre = readPrefill(location.state);
    if (!pre) return;
    setItems((prev) =>
      [
        ...prev.filter((i) => i.top || i.down),
        {
          ...newItem(pre.price),
          top: pre.top,
          down: pre.down,
          priceTouched: pre.priceTouched,
        },
      ].slice(0, MAX_ITEMS),
    );
  }, [location.key]); // eslint-disable-line react-hooks/exhaustive-deps

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
      originTown: town ? { id: town.id, name: town.name } : null,
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
        ? twoStep
          ? "Saved. Ready to be paid out."
          : "Saved"
        : "Saved on this device. It will sync when you are back online.",
    );
    void outbox.syncNow();
    // With a receipt printer the receipt opens straight away, ready to print; otherwise the purchase page, which has a Receipt button.
    navigate(
      opensReceipt(openReceipt, companySettings["receipt.printer"])
        ? paths.transactions.receipt.to(cmd.id, "?print=1")
        : paths.transactions.detail.to(cmd.id),
      { replace: true },
    );
  }

  const filled = complete && total > 0;
  const summary = (
    <div className="rounded-xl bg-navy p-4 text-white">
      <p className="text-sm text-white/70">
        Total · {items.length} item{items.length > 1 ? "s" : ""}
      </p>
      <p className="tnum text-3xl font-bold text-gold">
        {filled ? cedis(total) : "—"}
      </p>
      {payout && filled ? (
        <p className="tnum mt-1 text-sm text-white/70">
          {twoStep ? "To be paid out" : "To pay now"}{" "}
          {cedis(Number(payout.payable))}
        </p>
      ) : null}
      {customer.name.trim() ? (
        <p className="mt-2 truncate text-sm text-white/80">
          For {customer.name.trim()}
        </p>
      ) : null}
    </div>
  );
  const saveBar = (
    <>
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
        {twoStep ? "Save and send to pay" : "Save transaction"}
      </Button>
      {!outbox.durable ? (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          This browser cannot keep offline data after you close it.
        </p>
      ) : null}
    </>
  );
  const Step = ({
    n,
    title,
    hint,
  }: {
    n: number;
    title: string;
    hint?: string;
  }) => (
    <div className="flex items-center gap-2">
      <span className="grid size-6 place-items-center rounded-full bg-navy text-xs font-semibold text-white">
        {n}
      </span>
      <h2 className="text-base font-semibold">{title}</h2>
      {hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 pb-8">
      <PageHeader
        title="New transaction"
        subtitle="Buy gold from a customer. Nothing is final until you save."
      />

      {dayBlocked ? (
        <Card
          role="alert"
          className="flex items-center justify-between gap-3 border-amber-500/60 bg-amber-500/10"
        >
          <p className="text-sm">
            {drawer.status === "closed"
              ? "Today is closed."
              : "The day is not open."}{" "}
            {drawer.status === "closed"
              ? "If a customer has come in, open it again with a reason."
              : "Open the day before paying customers."}
          </p>
          <Link to={paths.drawer.open.href}>
            <Button variant="secondary">
              {drawer.status === "closed" ? "Open again" : "Open day"}
            </Button>
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

      <div className="space-y-4 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6 lg:space-y-0">
        <div className="space-y-4">
          <Step n={1} title="Customer" />
          <Card>
            <CustomerPicker
              value={customer}
              onChange={setCustomer}
              locked={!!security}
              branchId={branchId ?? null}
              representative={rep}
              onRepresentative={setRep}
            />
            <div className="mt-3">
              <TownPicker value={town} onChange={setTown} />
            </div>
          </Card>

          <Step
            n={2}
            title="Gold"
            hint="Weigh each piece, or group pieces of the same quality"
          />
          {items.map((it, idx) => {
            const r = results[idx]!;
            const err = (f: "top" | "down" | "price") =>
              r.errors.find((e) => e.field === f)?.message;
            return (
              <Card key={it.id} className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Item {idx + 1}</h3>
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
                    hint="On the scale"
                    inputMode="decimal"
                    value={it.top}
                    onChange={(e) =>
                      patch(it.id, { top: decimalInput(e.target.value) })
                    }
                    error={err("top")}
                  />
                  <TextField
                    label="Down (g)"
                    hint="In water"
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
                    hint={
                      it.priceTouched && priceQuery.data
                        ? `Changed by you · today is ${priceQuery.data.effectivePrice}`
                        : undefined
                    }
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
                <div className="tnum rounded-lg bg-muted/60 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      {r.karat
                        ? `${r.karat} karat · ${r.netWeight} g net`
                        : "Fill in the weights"}
                    </span>
                    <strong className="text-lg">
                      {r.amount ? cedis(r.amount) : "—"}
                    </strong>
                  </div>
                  {r.density || r.pounds ? (
                    <dl className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                      {r.density ? (
                        <div className="flex gap-1">
                          <dt>Density</dt>
                          <dd className="font-medium text-foreground">
                            {r.density}
                          </dd>
                        </div>
                      ) : null}
                      {r.purity ? (
                        <div className="flex gap-1">
                          <dt>Purity</dt>
                          <dd className="font-medium text-foreground">
                            {percent(r.purity)}
                          </dd>
                        </div>
                      ) : null}
                      {r.pounds ? (
                        <div className="flex gap-1">
                          <dt>Pounds</dt>
                          <dd className="font-medium text-foreground">
                            {r.pounds}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                  ) : null}
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

          {filled ? (
            <>
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
            </>
          ) : null}
        </div>

        {/* Desktop: the total and Save stay beside the form while it scrolls. */}
        <aside className="hidden space-y-3 lg:sticky lg:top-4 lg:block">
          {summary}
          {saveBar}
        </aside>
      </div>

      {/* Phone and tablet: the total sits above Save, which stays at the bottom. */}
      <div className="sticky bottom-0 -mx-4 space-y-2 border-t border-border bg-background/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
        <div className="tnum flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Total</span>
          <span className="text-2xl font-bold">
            {filled ? cedis(total) : "—"}
          </span>
        </div>
        {saveBar}
      </div>
    </div>
  );
}
