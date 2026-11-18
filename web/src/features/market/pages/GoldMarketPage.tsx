import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { GlobeIcon } from 'lucide-react';
import { EXCEL_V1 } from '@gold/core';
import paths from '@/config/paths';
import { PERMISSIONS } from '@/config/permissions';
import { useAuth } from '@/features/auth/store';
import { useHasPermission } from '@/features/auth/useHasPermission';
import { useBranchNames } from '@/features/branches/api';
import { cedis } from '@/features/calculator/format';
import { useSettings } from '@/features/settings/api';
import { day, when } from '@/features/transactions/format';
import { errorMessage } from '@/shared/api/errors';
import { decimalOnly } from '@/shared/lib/numbers';
import { ageLabel } from '@/shared/offline/policy';
import { useConnectivity } from '@/shared/offline/connectivity';
import { Card } from '@/shared/ui/Card';
import { Chip } from '@/shared/ui/Chip';
import { PageHeader } from '@/shared/ui/PageHeader';
import { TextField } from '@/shared/ui/TextField';
import { usePriceHistory } from '../api';
import { boughtTotals, priceChanges, priceLine, priceStats, RANGES, worldToPound } from '../model';
import { GoldbodWorldTile } from '../GoldbodWorldTile';
import { OwnPriceChart } from '../OwnPriceChart';
import { Step } from '../Step';
import { WORLD_INTERVALS, WorldGoldChart, type WorldInterval } from '../WorldGoldChart';

const pill = (on: boolean) =>
  `h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-xs font-semibold transition-colors ${on ? 'border-navy bg-navy text-white' : 'border-border bg-background text-muted-foreground hover:text-foreground'}`;

function Pills<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)} className={pill(o.value === value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Tile({ label, value, note, dark = false }: { label: string; value: string; note?: React.ReactNode; dark?: boolean }) {
  return (
    <div className={`min-w-0 rounded-2xl p-4 ${dark ? 'bg-navy text-white' : 'border border-border bg-card'}`}>
      <div className={`text-xs ${dark ? 'text-white/70' : 'text-muted-foreground'}`}>{label}</div>
      <div className={`tnum mt-1 truncate text-2xl font-bold ${dark ? 'text-gold' : 'text-foreground'}`}>{value}</div>
      {note ? <div className={`mt-1 text-xs ${dark ? 'text-white/70' : 'text-muted-foreground'}`}>{note}</div> : null}
    </div>
  );
}

const grams = (n: number) => `${n.toLocaleString('en-GH', { maximumFractionDigits: 2 })} g`;

/**
 * The gold market in one place: the world's live price (an outside chart, for watching only), the price this branch pays and how it
 * has moved, what the branch has bought, and a way to hold the world price against ours.
 */
export default function GoldMarketPage() {
  const branchId = useAuth((s) => s.activeBranchId);
  const branchName = useBranchNames()[branchId ?? ''] ?? 'This branch';
  const showWorld = useSettings()['market.worldChart'];
  const canSettings = useHasPermission(PERMISSIONS.SETTINGS_MANAGE);
  const online = useConnectivity((s) => s.online);
  const [interval, setInterval] = useState<WorldInterval>('60');
  const [days, setDays] = useState<number>(30);
  const history = usePriceHistory(branchId, days);
  const h = history.data;

  const stats = useMemo(() => (h ? priceStats(h.points) : null), [h]);
  const price = useMemo(() => (h ? priceLine(h.points, h.from, h.asOf) : []), [h]);
  const base = useMemo(() => (h ? priceLine(h.points, h.from, h.asOf, (p) => p.base) : []), [h]);
  const bought = useMemo(() => (h ? h.daily.map((d) => ({ time: Math.floor(Date.parse(`${d.date}T12:00:00Z`) / 1000), value: Number(d.amount) })) : []), [h]);
  const totals = useMemo(() => boughtTotals(h?.daily ?? []), [h]);
  const changes = useMemo(() => priceChanges(h?.points ?? []), [h]);

  // Holding the world price against ours: typed in by the person (read off the chart above), nothing is fetched.
  const [usd, setUsd] = useState('');
  const [rate, setRate] = useState('');
  const poundGrams = Number(EXCEL_V1.poundGrams);
  const world = worldToPound(Number(usd), Number(rate), poundGrams);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-3 pb-10 sm:p-4 lg:p-6">
      <PageHeader title="Gold market" subtitle={`The world price, the price ${branchName} pays, and what it has bought.`} />

      {history.error && !h ? <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{errorMessage(history.error)}</p> : null}
      {!online && h ? <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">No connection. Our price and purchases below are as this device last received them ({ageLabel(new Date(h.asOf).getTime())}).</p> : null}

      <section aria-label="Today" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile dark label={`Price per pound · ${branchName}`} value={stats ? cedis(stats.current) : '—'} note={stats ? <>{stats.provisional ? 'Waiting for approval · ' : ''}since {when(stats.since)}</> : history.isLoading ? 'Loading…' : 'No price set yet'} />
        <Tile label="Last change" value={stats && stats.previous !== null ? `${stats.change > 0 ? '+' : '−'}${Math.abs(stats.change).toLocaleString('en-GH')}` : '—'} note={stats ? <Step change={stats.change} percent={stats.changePercent} /> : undefined} />
        <Tile label="GoldBod price" value={stats ? cedis(stats.base) : '—'} note="The published reference price" />
        <Tile label="Our margin" value={stats ? `${stats.margin >= 0 ? '+' : '−'}${Math.abs(stats.margin).toLocaleString('en-GH')}` : '—'} note="Added to the GoldBod price" />
      </section>

      {showWorld ? (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-base font-semibold"><GlobeIcon className="size-4 text-brand" aria-hidden />World gold price, live</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">US dollars per troy ounce of pure gold, as the world's markets trade it.</p>
            </div>
            <Pills label="Each bar covers" value={interval} options={WORLD_INTERVALS} onChange={setInterval} />
          </div>
          <GoldbodWorldTile goldbod={h?.goldbod} live />
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
            <b>For watching the market only.</b> This is not the price we pay: ours is the GoldBod price plus our margin, in cedis per pound. Never value a customer's gold from this chart.
          </p>
          <WorldGoldChart interval={interval} height={520} resizable />
          <p className="text-[11px] text-muted-foreground">
            Chart and data by TradingView, an outside service; it needs a connection.
            {canSettings ? <> A director can switch it off in <Link className="underline" to={paths.settings.company.href}>Company settings</Link>.</> : null}
          </p>
        </Card>
      ) : (
        <GoldbodWorldTile goldbod={h?.goldbod} live={false} />
      )}

      <Card className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Our price per pound</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              <span className="mr-3 inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-5 rounded bg-gold" aria-hidden />What {branchName} pays</span>
              <span className="mr-3 inline-flex items-center gap-1.5"><span className="inline-block w-5 border-t border-dashed border-slate-400" aria-hidden />GoldBod price</span>
              <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-navy/55" aria-hidden />Cedis paid for gold each day</span>
            </p>
          </div>
          <Pills label="Period" value={days} options={RANGES.map((r) => ({ value: r.days as number, label: r.label }))} onChange={setDays} />
        </div>
        {price.length > 0 ? (
          <OwnPriceChart price={price} base={base} bought={bought} height={340} />
        ) : (
          <div className="grid h-40 place-items-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
            {history.isLoading ? 'Loading the price history…' : 'No price has been set for this branch in this period.'}
          </div>
        )}
        {stats ? (
          <dl className="grid grid-cols-3 gap-3 border-t border-border pt-3 text-sm">
            <div><dt className="text-xs text-muted-foreground">Highest</dt><dd className="tnum font-semibold">{cedis(stats.high)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Lowest</dt><dd className="tnum font-semibold">{cedis(stats.low)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Price changes</dt><dd className="tnum font-semibold">{stats.changes}</dd></div>
          </dl>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <h2 className="text-base font-semibold">What we bought · last {RANGES.find((r) => r.days === days)?.label ?? `${days} days`}</h2>
          {totals.purchases > 0 ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div><dt className="text-xs text-muted-foreground">Purchases</dt><dd className="tnum text-lg font-bold">{totals.purchases.toLocaleString('en-GH')}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Paid for gold</dt><dd className="tnum text-lg font-bold">{cedis(totals.amount)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Top weight</dt><dd className="tnum font-semibold">{grams(totals.top)}</dd></div>
              <div>
                <dt className="text-xs text-muted-foreground">Average price per pound on purchases</dt>
                <dd className="tnum font-semibold">{totals.avgPrice ? cedis(totals.avgPrice) : '—'}</dd>
              </div>
              <p className="col-span-2 text-xs text-muted-foreground">On {totals.days} day{totals.days === 1 ? '' : 's'} with purchases. The average is the price typed on each piece, weighted by its weight; cancelled purchases are left out.</p>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">{history.isLoading ? 'Loading…' : 'No purchases in this period.'}</p>
          )}
        </Card>

        <Card className="space-y-3">
          <h2 className="text-base font-semibold">Hold the world price against ours</h2>
          <p className="text-xs text-muted-foreground">Read the world price off the chart and type today's dollar rate. A rough guide for a manager, never a valuation.</p>
          <div className="grid grid-cols-2 gap-3">
            <TextField label="World price (USD per ounce)" inputMode="decimal" placeholder="e.g. 3860" value={usd} onChange={(e) => setUsd(decimalOnly(e.target.value))} />
            <TextField label="Cedis for one US dollar" inputMode="decimal" placeholder="e.g. 11.2" value={rate} onChange={(e) => setRate(decimalOnly(e.target.value))} />
          </div>
          <div className="rounded-xl bg-muted/60 p-3 text-sm">
            {world ? (
              <>
                <div className="text-xs text-muted-foreground">A pound ({poundGrams} g) of pure gold at the world price</div>
                <div className="tnum text-2xl font-bold">{cedis(world)}</div>
                {stats ? (
                  <div className="mt-1 text-xs text-muted-foreground">
                    We pay {cedis(stats.current)} per pound: <b className="text-foreground">{((stats.current / world) * 100).toFixed(1)}%</b> of that
                    ({stats.current <= world ? `${cedis(world - stats.current)} under` : `${cedis(stats.current - world)} over`}).
                  </div>
                ) : null}
              </>
            ) : (
              <span className="text-muted-foreground">Type both numbers to see a pound of pure gold in cedis at the world price.</span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">One troy ounce is 31.1035 g. The world price is for pure (24 karat) gold; what customers bring is less pure, and our price already allows for that.</p>
        </Card>
      </div>

      <Card className="space-y-3">
        <h2 className="text-base font-semibold">Price changes</h2>
        {changes.length > 0 ? (
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[30rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">When</th>
                  <th className="pb-2 text-right font-medium">GoldBod</th>
                  <th className="pb-2 text-right font-medium">Margin</th>
                  <th className="pb-2 text-right font-medium">Price per pound</th>
                  <th className="pb-2 pl-4 font-medium">Step</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {changes.map((c, i) => (
                  <tr key={`${c.at}-${i}`} className="border-t border-border">
                    <td className="py-2 pr-3 whitespace-nowrap">{new Date(c.at) < new Date(h?.from ?? 0) ? `Before ${day(h!.from)}` : when(c.at)}</td>
                    <td className="py-2 text-right">{Number(c.base).toLocaleString('en-GH')}</td>
                    <td className="py-2 text-right">{Number(c.margin).toLocaleString('en-GH')}</td>
                    <td className="py-2 text-right font-semibold">{Number(c.price).toLocaleString('en-GH')}</td>
                    <td className="py-2 pl-4 whitespace-nowrap">
                      {c.step === null ? <span className="text-muted-foreground">—</span> : <Step change={c.step} />}
                      {c.status !== 'approved' ? <span className="ml-2"><Chip tone="amber">Waiting for approval</Chip></span> : null}
                      {c.source === 'manual' ? <span className="ml-2"><Chip tone="grey">Typed in</Chip></span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{history.isLoading ? 'Loading…' : 'No price changes in this period.'}</p>
        )}
      </Card>
    </div>
  );
}