import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { calculate } from "@gold/core";
import paths from "@/config/paths";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
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
}: { onSaveAsPurchase?: () => void } = {}) {
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

  return (
    <div className="space-y-4">
      <Card className="grid grid-cols-2 gap-3">
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
        <TextField
          className="col-span-2"
          label="Price per pound (GHS)"
          hint={
            priceQuery.data
              ? `Today: GoldBod ${priceQuery.data.basePrice} + margin ${priceQuery.data.margin}${priceTouched ? " · changed by you" : ""}`
              : "Enter the price"
          }
          inputMode="decimal"
          value={price}
          onChange={(e) => {
            setPriceTouched(true);
            setPrice(decimalInput(e.target.value));
          }}
          error={fieldError("price")}
        />
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

      <Card>
        <div className="text-sm text-muted-foreground">Amount</div>
        <div className="tnum text-4xl font-bold">
          {amount === null ? "—" : cedis(amount)}
        </div>
        <dl className="tnum mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          {[
            ["Density", r.density],
            ["Karat", r.karat],
            ["Purity", r.purity ? percent(r.purity) : null],
            ["Net weight (g)", r.netWeight],
            ["Pounds", r.pounds],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-semibold">{value ?? "—"}</dd>
            </div>
          ))}
        </dl>
      </Card>

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
      ) : null}

      {amount !== null && amount > 0 ? <PayoutPanel amount={amount} /> : null}
    </div>
  );
}

export default function CalculatorPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-xl font-bold">Calculator</h1>
      <CalculatorBody />
    </div>
  );
}
