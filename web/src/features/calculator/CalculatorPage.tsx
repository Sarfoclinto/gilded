import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { calculate } from "@gold/core";
import paths from "@/config/paths";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { PageHeader } from "@/shared/ui/PageHeader";
import { TextField } from "@/shared/ui/TextField";
import { useAuth } from "@/features/auth/store";
import { useCurrentPrice } from "@/features/prices/api";
import { cedis, percent } from "./format";
import { PayoutPanel } from "./PayoutPanel";

const decimalInput = (v: string) =>
  v.replace(/[^\d.]/g, "").replace(/(\..*?)\./g, "$1");

/**
 * The calculator itself, used on its own page and in the utility panel beside any page.
 * "Save as a purchase" opens New purchase with these values filled in; nothing is saved until the purchase is confirmed there.
 */
export function CalculatorBody({
  onSaveAsPurchase,
  wide = false,
}: { onSaveAsPurchase?: () => void; wide?: boolean } = {}) {
  const navigate = useNavigate();
  const branchId = useAuth((s) => s.activeBranchId);
  const priceQuery = useCurrentPrice(branchId);
  const [top, setTop] = useState("");
  const [down, setDown] = useState("");
  const [price, setPrice] = useState("");
  const [priceTouched, setPriceTouched] = useState(false);

  // Fill the price from today's price until the person types their own.
  useEffect(() => {
    if (!priceTouched && priceQuery.data)
      setPrice(priceQuery.data.effectivePrice);
  }, [priceQuery.data, priceTouched]);

  const r = useMemo(() => calculate({ top, down, price }), [top, down, price]);
  const amount = r.amount === null ? null : Number(r.amount);
  const fieldError = (f: "top" | "down" | "price") =>
    r.errors.find((e) => e.field === f)?.message;

  const priceNote = priceQuery.data
    ? `Today: GoldBod ${priceQuery.data.basePrice} + margin ${priceQuery.data.margin}`
    : "Enter the price";
  const hasInput = !!(top || down || priceTouched);
  const details: [string, string | null | undefined][] = [
    ["Density", r.density],
    ["Karat", r.karat],
    ["Purity", r.purity ? percent(r.purity) : null],
    ["Net weight", r.netWeight ? `${r.netWeight} g` : null],
    ["Pounds", r.pounds],
  ];

  return (
    <div
      className={
        wide
          ? "space-y-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0"
          : "space-y-4"
      }
    >
      <div className="space-y-4">
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Weights</h2>
            {hasInput ? (
              <button
                type="button"
                className="min-h-9 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted"
                onClick={() => {
                  setTop("");
                  setDown("");
                  setPriceTouched(false);
                  setPrice(priceQuery.data?.effectivePrice ?? "");
                }}
              >
                Clear
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Top (g)"
              hint="Weight on the scale"
              inputMode="decimal"
              value={top}
              onChange={(e) => setTop(decimalInput(e.target.value))}
              error={fieldError("top")}
            />
            <TextField
              label="Down (g)"
              hint="Weight in water"
              inputMode="decimal"
              value={down}
              onChange={(e) => setDown(decimalInput(e.target.value))}
              error={fieldError("down")}
            />
          </div>
          <TextField
            label="Price per pound (GHS)"
            hint={`${priceNote}${priceTouched ? " · changed by you" : ""}`}
            inputMode="decimal"
            value={price}
            onChange={(e) => {
              setPriceTouched(true);
              setPrice(decimalInput(e.target.value));
            }}
            error={fieldError("price")}
          />
          {priceTouched && priceQuery.data ? (
            <button
              type="button"
              className="min-h-9 text-xs underline"
              onClick={() => {
                setPriceTouched(false);
                setPrice(priceQuery.data.effectivePrice);
              }}
            >
              Use today's price ({priceQuery.data.effectivePrice})
            </button>
          ) : null}
        </Card>

        {r.warnings.map((w) => (
          <p
            key={w.code}
            role="alert"
            className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm"
          >
            {w.message}
          </p>
        ))}
      </div>

      <div className="space-y-4">
        <div className="rounded-xl bg-navy p-4 text-white">
          <div className="text-sm text-white/70">Amount to pay</div>
          <div className="tnum text-4xl font-bold text-gold">
            {amount === null ? "—" : cedis(amount)}
          </div>
          <dl className="tnum mt-4 grid grid-cols-3 gap-x-3 gap-y-3 text-sm">
            {details.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-white/60">{label}</dt>
                <dd className="font-semibold">{value ?? "—"}</dd>
              </div>
            ))}
          </dl>
        </div>

        {amount !== null && amount > 0 ? (
          <Button
            className="w-full"
            onClick={() => {
              onSaveAsPurchase?.();
              navigate(paths.transactions.create.href, {
                state: { prefill: { top, down, price, priceTouched } },
              });
            }}
          >
            Save as a purchase
          </Button>
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            Enter the weights to see the amount.
          </p>
        )}

        {amount !== null && amount > 0 ? <PayoutPanel amount={amount} /> : null}
      </div>
    </div>
  );
}

export default function CalculatorPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 pb-8">
      <PageHeader
        title="Calculator"
        subtitle="Work out what a piece is worth. Nothing is saved until you save it as a purchase."
      />
      <CalculatorBody wide />
    </div>
  );
}
