import { useEffect, useMemo, useState } from 'react';
import { calculate } from '@gold/core';
import { Card } from '@/shared/ui/Card';
import { TextField } from '@/shared/ui/TextField';
import { useAuth } from '@/features/auth/store';
import { useCurrentPrice } from '@/features/prices/api';
import { cedis, percent } from './format';
import { PayoutPanel } from './PayoutPanel';

const decimalInput = (v: string) => v.replace(/[^\d.]/g, '').replace(/(\..*?)\./g, '$1');

export default function CalculatorPage() {
  const branchId = useAuth((s) => s.activeBranchId);
  const priceQuery = useCurrentPrice(branchId);
  const [top, setTop] = useState('');
  const [down, setDown] = useState('');
  const [price, setPrice] = useState('');
  const [priceTouched, setPriceTouched] = useState(false);

  // Fill the price from today's price until the person types their own.
  useEffect(() => {
    if (!priceTouched && priceQuery.data) setPrice(priceQuery.data.effectivePrice);
  }, [priceQuery.data, priceTouched]);

  const r = useMemo(() => calculate({ top, down, price }), [top, down, price]);
  const amount = r.amount === null ? null : Number(r.amount);
  const fieldError = (f: 'top' | 'down' | 'price') => r.errors.find((e) => e.field === f)?.message;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-xl font-bold">Calculator</h1>

      <Card className="grid grid-cols-2 gap-3">
        <TextField
          label="Top (g)"
          hint="Weight on the scale"
          inputMode="decimal"
          value={top}
          onChange={(e) => setTop(decimalInput(e.target.value))}
          error={fieldError('top')}
        />
        <TextField
          label="Down (g)"
          hint="Weight in water"
          inputMode="decimal"
          value={down}
          onChange={(e) => setDown(decimalInput(e.target.value))}
          error={fieldError('down')}
        />
        <TextField
          className="col-span-2"
          label="Price per pound (GHS)"
          hint={
            priceQuery.data
              ? `Today: GoldBod ${priceQuery.data.basePrice} + margin ${priceQuery.data.margin}${priceTouched ? ' · changed by you' : ''}`
              : 'Enter the price'
          }
          inputMode="decimal"
          value={price}
          onChange={(e) => {
            setPriceTouched(true);
            setPrice(decimalInput(e.target.value));
          }}
          error={fieldError('price')}
        />
      </Card>

      {r.warnings.map((w) => (
        <p key={w.code} role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          {w.message}
        </p>
      ))}

      <Card>
        <div className="text-sm text-muted">Amount</div>
        <div className="tnum text-4xl font-bold">{amount === null ? '—' : cedis(amount)}</div>
        <dl className="tnum mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          {[
            ['Density', r.density],
            ['Karat', r.karat],
            ['Purity', r.purity ? percent(r.purity) : null],
            ['Net weight (g)', r.netWeight],
            ['Pounds', r.pounds],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-muted">{label}</dt>
              <dd className="font-semibold">{value ?? '—'}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {amount !== null && amount > 0 ? <PayoutPanel amount={amount} /> : null}
    </div>
  );
}
