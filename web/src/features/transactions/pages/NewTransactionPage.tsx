import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { calculate } from '@gold/core';
import paths from '@/config/paths';
import { useAuth } from '@/features/auth/store';
import { useCurrentPrice } from '@/features/prices/api';
import { cedis } from '@/features/calculator/format';
import { PayoutPanel, type PayoutSelection } from '@/features/calculator/PayoutPanel';
import { useOutbox } from '@/shared/offline/OutboxProvider';
import { useConnectivity } from '@/shared/offline/connectivity';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { TextField } from '@/shared/ui/TextField';
import { toast } from '@/shared/ui/toast';
import { TX_CREATE } from '@/app/outbox';
import { createTransactionSchema } from '../schemas';

const MAX_ITEMS = 20;
const decimalInput = (v: string) => v.replace(/[^\d.]/g, '').replace(/(\..*?)\./g, '$1');

interface DraftItem {
  id: string;
  label: string;
  top: string;
  down: string;
  price: string;
  priceTouched: boolean;
}
const newItem = (price = ''): DraftItem => ({ id: crypto.randomUUID(), label: '', top: '', down: '', price, priceTouched: false });

export default function NewTransactionPage() {
  const navigate = useNavigate();
  const branchId = useAuth((s) => s.activeBranchId);
  const online = useConnectivity((s) => s.online);
  const priceQuery = useCurrentPrice(branchId);
  const outbox = useOutbox();

  // One id per form session: tapping Save twice can only ever create one transaction.
  const txId = useRef(crypto.randomUUID());
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [items, setItems] = useState<DraftItem[]>([newItem()]);
  const [payout, setPayout] = useState<PayoutSelection | null>(null);
  const [saving, setSaving] = useState(false);

  // Fill each item's price from today's price until the person types their own.
  useEffect(() => {
    const p = priceQuery.data?.effectivePrice;
    if (p) setItems((prev) => prev.map((i) => (i.priceTouched || i.price ? i : { ...i, price: p })));
  }, [priceQuery.data]);

  const patch = (id: string, change: Partial<DraftItem>) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...change } : i)));

  const results = useMemo(() => items.map((i) => calculate({ top: i.top, down: i.down, price: i.price })), [items]);
  const complete = results.every((r) => r.amount !== null && r.errors.length === 0);
  const total = complete ? results.reduce((s, r) => s + Number(r.amount), 0) : 0;
  // Ignore repeats of the same payout so the panel's effect can never cause a render loop.
  const onPayout = useCallback(
    (p: PayoutSelection | null) => setPayout((prev) => (JSON.stringify(prev) === JSON.stringify(p) ? prev : p)),
    [],
  );

  const canSave = !!branchId && name.trim().length > 0 && complete && total > 0 && payout !== null && outbox.ready && !saving;

  async function save() {
    if (!canSave || !branchId || !payout) return;
    setSaving(true);
    const cmd = {
      id: txId.current,
      branchId,
      customerName: name.trim(),
      customerPhone: phone.trim() || null,
      items: items.map((i) => ({ id: i.id, label: i.label.trim() || null, top: i.top, down: i.down, price: i.price })),
      clientAmount: String(total),
      payout: { policy: payout.policy, strategy: payout.strategy, payable: payout.payable, lines: payout.lines },
      capturedAt: new Date().toISOString(),
      priceAsOf: priceQuery.data?.asOf ?? new Date().toISOString(),
    };
    const parsed = createTransactionSchema.safeParse(cmd);
    if (!parsed.success) {
      setSaving(false);
      toast.error(parsed.error.issues[0]?.message ?? 'Check the form.');
      return;
    }
    await outbox.enqueue(cmd.id, TX_CREATE, parsed.data);
    toast.success(online ? 'Saved' : 'Saved on this device. It will sync when you are back online.');
    void outbox.syncNow();
    navigate(paths.transactions.detail.to(cmd.id), { replace: true });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-8">
      <h1 className="text-xl font-bold">New transaction</h1>

      <Card className="grid gap-3 sm:grid-cols-2">
        <TextField label="Customer name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        <TextField label="Phone (optional)" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
      </Card>

      {items.map((it, idx) => {
        const r = results[idx]!;
        const err = (f: 'top' | 'down' | 'price') => r.errors.find((e) => e.field === f)?.message;
        return (
          <Card key={it.id} className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Item {idx + 1}</h2>
              {items.length > 1 ? (
                <button className="min-h-10 rounded-lg px-3 text-sm text-muted hover:bg-line/40" onClick={() => setItems((p) => p.filter((x) => x.id !== it.id))}>
                  Remove
                </button>
              ) : null}
            </div>
            <TextField label="Description (optional)" placeholder="e.g. ring, nuggets" value={it.label} onChange={(e) => patch(it.id, { label: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <TextField label="Top (g)" inputMode="decimal" value={it.top} onChange={(e) => patch(it.id, { top: decimalInput(e.target.value) })} error={err('top')} />
              <TextField label="Down (g)" inputMode="decimal" value={it.down} onChange={(e) => patch(it.id, { down: decimalInput(e.target.value) })} error={err('down')} />
              <TextField
                className="col-span-2"
                label="Price per pound (GHS)"
                inputMode="decimal"
                value={it.price}
                onChange={(e) => patch(it.id, { price: decimalInput(e.target.value), priceTouched: true })}
                error={err('price')}
              />
            </div>
            {r.warnings.map((w) => (
              <p key={w.code} role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-2 text-xs">
                {w.message}
              </p>
            ))}
            <div className="tnum flex items-baseline justify-between text-sm">
              <span className="text-muted">{r.karat ? `${r.karat} karat · ${r.netWeight} g net` : 'Fill in the weights'}</span>
              <strong className="text-lg">{r.amount ? cedis(r.amount) : '—'}</strong>
            </div>
          </Card>
        );
      })}

      <Button variant="secondary" className="w-full" disabled={items.length >= MAX_ITEMS} onClick={() => setItems((p) => [...p, newItem(priceQuery.data?.effectivePrice)])}>
        Add another item
      </Button>

      <Card className="flex items-baseline justify-between">
        <span className="text-sm text-muted">Total ({items.length} item{items.length > 1 ? 's' : ''})</span>
        <span className="tnum text-3xl font-bold">{complete && total > 0 ? cedis(total) : '—'}</span>
      </Card>

      {complete && total > 0 ? <PayoutPanel amount={total} onResult={onPayout} /> : null}

      <div className="sticky bottom-0 -mx-4 border-t border-line bg-bg/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur">
        {!online ? <p className="mb-2 text-center text-xs text-amber-700 dark:text-amber-300">Offline: this will be saved on this device and sent later.</p> : null}
        <Button className="w-full" onClick={() => void save()} disabled={!canSave} loading={saving}>
          Save transaction
        </Button>
        {!outbox.durable ? <p className="mt-2 text-center text-xs text-muted">This browser cannot keep offline data after you close it.</p> : null}
      </div>
    </div>
  );
}
