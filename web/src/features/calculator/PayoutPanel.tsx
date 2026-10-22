import { useEffect, useMemo, useState } from 'react';
import { DENOMINATIONS, solveNotes, toPayable, type PayablePolicy, type SolveStrategy } from '@gold/core';
import { Card } from '@/shared/ui/Card';
import { cedis } from './format';
import { useNoteLimits } from './useNoteLimits';

const policyLabels: Record<PayablePolicy, string> = {
  down: 'Round down (customer gets less)',
  nearest: 'Nearest 5',
  up: 'Round up (we absorb it)',
};

export interface PayoutSelection {
  policy: PayablePolicy;
  strategy: SolveStrategy;
  payable: string;
  lines: Record<string, number>;
  totalNotes: number;
}

/** Pass `onResult` to receive the current payout (or null when the drawer cannot make it), e.g. to save it. */
export function PayoutPanel({ amount, onResult }: { amount: number; onResult?: (p: PayoutSelection | null) => void }) {
  const [policy, setPolicy] = useState<PayablePolicy>('down');
  const [strategy, setStrategy] = useState<SolveStrategy>('prefer-100s');
  const [override, setOverride] = useState<{ forAmount: number; value: number } | null>(null);
  const { draft, update, limits } = useNoteLimits();

  const rounded = useMemo(() => toPayable(amount, policy), [amount, policy]);
  // An override only applies to the amount it was chosen for.
  const payable = override && override.forAmount === amount ? override.value : rounded.payable;
  const difference = payable - amount;
  const result = useMemo(() => solveNotes(payable, limits, strategy), [payable, limits, strategy]);

  useEffect(() => {
    if (!onResult) return;
    if (!result.ok) return onResult(null);
    const lines = Object.fromEntries(Object.entries(result.lines).filter(([, n]) => (n ?? 0) > 0)) as Record<string, number>;
    onResult({ policy, strategy, payable: String(payable), lines, totalNotes: result.totalNotes });
  }, [result, policy, strategy, payable, onResult]);

  return (
    <Card className="space-y-4">
      <h2 className="text-base font-semibold">Payout</h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Rounding</span>
          <select
            className="min-h-11 w-full rounded-lg border border-line bg-surface px-2"
            value={policy}
            onChange={(e) => {
              setOverride(null);
              setPolicy(e.target.value as PayablePolicy);
            }}
          >
            {(Object.keys(policyLabels) as PayablePolicy[]).map((p) => (
              <option key={p} value={p}>
                {policyLabels[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Notes</span>
          <select
            className="min-h-11 w-full rounded-lg border border-line bg-surface px-2"
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as SolveStrategy)}
          >
            <option value="prefer-100s">Prefer 100s</option>
            <option value="fewest-notes">Fewest notes</option>
          </select>
        </label>
      </div>

      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted">To pay</span>
        <span className="tnum text-2xl font-bold">{cedis(payable)}</span>
      </div>
      {difference !== 0 ? (
        <p className="tnum -mt-3 text-right text-xs text-muted">
          {difference < 0 ? `${cedis(-difference)} less than calculated` : `${cedis(difference)} absorbed by the business`}
        </p>
      ) : null}

      {result.ok ? (
        <div>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {result.display.map((row) => (
              <li key={row.denomination} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div>
                  <div className="font-semibold">GHS {row.denomination} × {row.total}</div>
                  <div className="text-xs text-muted">
                    {[
                      row.packs ? `${row.packs} pack${row.packs > 1 ? 's' : ''}` : null,
                      row.bundles ? `${row.bundles} bundle${row.bundles > 1 ? 's' : ''}` : null,
                      row.loose ? `${row.loose} loose` : null,
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </div>
                </div>
                <div className="tnum text-sm text-muted">{cedis(row.value)}</div>
              </li>
            ))}
          </ul>
          <p className="tnum mt-2 text-right text-sm">
            <span className="text-muted">Total pieces </span>
            <strong>{result.totalNotes.toLocaleString('en-GH')}</strong>
          </p>
        </div>
      ) : (
        <div role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">
            {result.code === 'CANNOT_MAKE_AMOUNT' ? 'The notes in the drawer cannot make this exact amount.' : result.message}
          </p>
          {result.code === 'CANNOT_MAKE_AMOUNT' ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {result.nearestBelow != null ? (
                <button
                  className="min-h-10 rounded-lg border border-line bg-surface px-3"
                  onClick={() => setOverride({ forAmount: amount, value: result.nearestBelow! })}
                >
                  Pay {cedis(result.nearestBelow)}
                </button>
              ) : null}
              {result.nearestAbove != null ? (
                <button
                  className="min-h-10 rounded-lg border border-line bg-surface px-3"
                  onClick={() => setOverride({ forAmount: amount, value: result.nearestAbove! })}
                >
                  Pay {cedis(result.nearestAbove)}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      <details className="text-sm">
        <summary className="min-h-10 cursor-pointer py-2 font-medium">Notes available in the drawer</summary>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {DENOMINATIONS.map((d) => (
            <div key={d} className="rounded-lg border border-line p-2">
              <label className="flex items-center gap-2 font-medium">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={draft[d].enabled}
                  onChange={(e) => update(d, { enabled: e.target.checked })}
                />
                GHS {d}
              </label>
              <input
                inputMode="numeric"
                placeholder="No limit"
                aria-label={`Count of GHS ${d} notes`}
                disabled={!draft[d].enabled}
                value={draft[d].count}
                onChange={(e) => update(d, { count: e.target.value.replace(/\D/g, '') })}
                className="tnum mt-2 min-h-10 w-full rounded-lg border border-line bg-surface px-2 disabled:opacity-40"
              />
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">Saved on this device until the cash drawer count is connected.</p>
      </details>
    </Card>
  );
}
