import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from 'antd';
import { ArrowDownIcon, ArrowDownToLineIcon, ArrowLeftRightIcon, ArrowUpFromLineIcon, ArrowUpIcon, HistoryIcon } from 'lucide-react';
import { DENOMINATIONS, lineTotal, noteCount } from '@gold/core';
import paths from '@/config/paths';
import { PERMISSIONS } from '@/config/permissions';
import { useAuth } from '@/features/auth/store';
import { Can, useHasPermission } from '@/features/auth/useHasPermission';
import { cedis } from '@/features/calculator/format';
import { when } from '@/features/transactions/format';
import { errorMessage } from '@/shared/api/errors';
import { grams } from '@/shared/lib/numbers';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Chip } from '@/shared/ui/Chip';
import { PageHeader } from '@/shared/ui/PageHeader';
import { drawerFlow } from '../dayModel';
import { dayFlagText, linesText, signoffText } from '../format';
import { useActiveDrawer, useClosingPreview } from '../hooks';
import { MovementModal } from '../MovementModal';

const longDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

function Flow({ label, value, signed }: { label: string; value: number; signed?: boolean }) {
  const colour = !signed || value === 0 ? '' : value > 0 ? 'text-emerald-300' : 'text-red-300';
  return (
    <div className="min-w-0">
      <dt className="text-xs text-white/60">{label}</dt>
      <dd className={`tnum text-sm font-semibold ${colour}`}>{signed && value !== 0 ? (value > 0 ? '+' : '−') : ''}{cedis(Math.abs(value))}</dd>
    </div>
  );
}

export default function DrawerPage() {
  const branchId = useAuth((s) => s.activeBranchId);
  const { view, state, query } = useActiveDrawer();
  const [moving, setMoving] = useState<'topup' | 'withdrawal' | 'allowance' | null>(null);
  const day = state?.day ?? null;
  const canManage = useHasPermission(PERMISSIONS.DAYS_MANAGE);
  const canExchange = useHasPermission(PERMISSIONS.NOTES_EXCHANGE);
  const books = useClosingPreview(canManage && view.status === 'open' ? view.dayId : null).data;
  const open = view.status === 'open' && view.balance;
  const flow = open ? drawerFlow(view.openingLines, state?.movements ?? [], view.balance) : null;
  const total = open ? lineTotal(view.balance as Record<string, number>) : 0;
  const closing = day?.closing ?? null;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-3 pb-8 sm:p-4 lg:p-6">
      <PageHeader
        title="Cash drawer"
        subtitle="What is in the drawer, and what went in and out today."
        actions={<Link to={paths.drawer.history.href}><Button variant="secondary"><HistoryIcon className="size-4" aria-hidden />Day history</Button></Link>}
      />

      {query.error && !state ? <Alert type="error" showIcon title={errorMessage(query.error)} /> : null}
      {view.pendingCount > 0 ? (
        <Alert type="warning" showIcon title={`${view.pendingCount} change${view.pendingCount > 1 ? 's' : ''} on this device not sent yet. The balance below already includes them.`} />
      ) : null}
      {view.negative ? <Alert type="error" showIcon title="More notes were paid out than the drawer should hold. Recount before closing and tell the manager." /> : null}

      {view.status === 'unknown' ? (
        <Card className="text-sm text-muted-foreground">{query.isLoading ? 'Loading the drawer…' : 'The drawer has not been loaded yet. Connect once to load it.'}</Card>
      ) : null}

      {view.status === 'none' || view.status === 'closed' ? (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-sm text-muted-foreground">{view.status === 'none' ? 'No day opened yet' : `Closed · ${view.businessDate ? longDate(view.businessDate) : ''}`}</div>
              <div className="text-xl font-bold">{view.status === 'none' ? 'Open the day to start paying customers' : 'This day is closed'}</div>
            </div>
            {closing ? <Chip tone={closing.signoff.status === 'pending' ? 'amber' : closing.signoff.status === 'rejected' ? 'red' : 'green'}>{signoffText[closing.signoff.status]}</Chip> : null}
          </div>
          {view.status === 'closed' && view.closingLines ? (
            <div>
              <div className="text-xs uppercase text-muted-foreground">Counted at close</div>
              <div className="tnum text-3xl font-bold">{cedis(lineTotal(view.closingLines))}</div>
              <div className="tnum text-xs text-muted-foreground">{linesText(view.closingLines)}</div>
            </div>
          ) : null}
          <Can permission={PERMISSIONS.DAYS_MANAGE}>
            <Link to={paths.drawer.open.href} className="block"><Button className="w-full sm:w-auto">Open the day</Button></Link>
          </Can>
          {view.status === 'closed' ? <p className="text-xs text-muted-foreground">The next day can be opened tomorrow.</p> : null}
        </Card>
      ) : null}

      {open && flow ? (
        <>
          <section className="rounded-2xl bg-navy p-4 text-white sm:p-5" aria-label="The drawer now">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-white/70">
              <span>Open · {view.businessDate ? longDate(view.businessDate) : ''}</span>
              <span className="flex flex-wrap gap-1">{day?.flags.map((f) => <Chip key={f} tone="amber">{dayFlagText[f] ?? f}</Chip>)}</span>
            </div>
            <div className="mt-1 text-sm text-white/70">In the drawer now</div>
            <div className="tnum text-4xl font-bold text-gold">{cedis(total)}</div>
            <div className="tnum text-xs text-white/60">{noteCount(view.balance as Record<string, number>).toLocaleString('en-GH')} notes{day ? ` · opened by ${day.openedBy.displayName}, ${when(day.openedAt)}` : ''}</div>
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-white/10 pt-3 sm:grid-cols-4">
              <Flow label="Opened with" value={flow.opened} />
              <Flow label="Cash in" value={flow.cashIn} signed />
              <Flow label="Cash out" value={-flow.cashOut} signed />
              <Flow label="Purchases and other" value={flow.other} signed />
            </dl>
            <Can permission={PERMISSIONS.DAYS_MANAGE}>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setMoving('topup')} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700">
                  <ArrowDownToLineIcon className="size-5" aria-hidden /> Cash in
                </button>
                <button type="button" onClick={() => setMoving('withdrawal')} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700">
                  <ArrowUpFromLineIcon className="size-5" aria-hidden /> Cash out
                </button>
                {canExchange ? <Link to={paths.drawer.exchange.href} className="flex min-h-11 items-center justify-center rounded-lg border border-white/30 px-4 text-sm font-semibold hover:bg-white/10">Change notes</Link> : <span />}
                <Link to={paths.drawer.close.href} className="block"><button type="button" className="min-h-11 w-full rounded-lg bg-gold px-4 text-sm font-semibold text-navy hover:opacity-90">Close the day</button></Link>
                <button type="button" onClick={() => setMoving('allowance')} className="col-span-2 min-h-10 text-center text-xs text-white/70 underline">Office allowance</button>
              </div>
            </Can>
          </section>

          <section className="space-y-2" aria-label="Notes in the drawer">
            <h2 className="text-sm font-semibold">Notes in the drawer</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {DENOMINATIONS.map((d) => {
                const n = view.balance?.[`${d}`] ?? 0;
                const share = total > 0 ? Math.max(0, (n * d) / total) : 0;
                return (
                  <div key={d} className={`rounded-xl border p-3 ${n < 0 ? 'border-red-400 bg-red-500/5' : 'border-border bg-card'}`}>
                    <div className="text-xs text-muted-foreground">GHS {d}</div>
                    <div className={`tnum text-xl font-bold ${n < 0 ? 'text-red-600' : n === 0 ? 'text-muted-foreground' : ''}`}>{n.toLocaleString('en-GH')}</div>
                    <div className="tnum text-xs text-muted-foreground">{n ? cedis(n * d) : '—'}</div>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted" aria-hidden><div className="h-full bg-gold" style={{ width: `${Math.round(share * 100)}%` }} /></div>
                  </div>
                );
              })}
            </div>
          </section>

          {books ? (
            <Card className="space-y-3">
              <h2 className="text-sm font-semibold">What the books hold now</h2>
              <dl className="tnum grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
                {[
                  ['Gold, top weight', grams(books.expected.goodsTop)],
                  ['Gold, down weight', grams(books.expected.goodsDown)],
                  ['Value of gold', cedis(books.expected.goodsValue)],
                  ['Owed to us', cedis(books.expected.debt)],
                  ['We owe', cedis(books.expected.payable)],
                  ['Unrefined gold held', grams(books.expected.custodyTop)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
              {books.pendingPayments > 0 ? (
                <p className="text-xs text-amber-700">{books.pendingPayments} mobile money part{books.pendingPayments > 1 ? 's' : ''} still waiting for confirmation. <Link to={paths.payments.href} className="underline">Open</Link></p>
              ) : null}
            </Card>
          ) : null}

          <Card className="space-y-2 p-0">
            <h2 className="px-4 pt-3 text-sm font-semibold">Cash in and out today</h2>
            {state && state.movements.length > 0 ? (
              <ul className="divide-y divide-border text-sm">
                {state.movements.map((m) => (
                  <li key={m.id} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ${m.kind === 'exchange' ? 'bg-sky-500/15 text-sky-700' : m.kind === 'topup' ? 'bg-emerald-500/15 text-emerald-700' : 'bg-red-500/15 text-red-700'}`}>
                        {m.kind === 'exchange' ? <ArrowLeftRightIcon className="size-4" aria-label="Changed" /> : m.kind === 'topup' ? <ArrowDownIcon className="size-4" aria-label="In" /> : <ArrowUpIcon className="size-4" aria-label="Out" />}
                      </span>
                      <div className="min-w-0">
                        <div className="font-medium">{m.note}</div>
                        <div className="text-xs text-muted-foreground">{m.createdBy.displayName} · {when(m.capturedAt)} · {m.exchange ? `${linesText(m.exchange.gave)} back, ${linesText(m.exchange.took)} out` : linesText(m.lines)}</div>
                      </div>
                    </div>
                    {m.kind === 'exchange' && m.exchange ? (
                      <strong className="tnum whitespace-nowrap text-sky-700">{cedis(lineTotal(m.exchange.took))}</strong>
                    ) : (
                      <strong className={`tnum whitespace-nowrap ${m.kind === 'topup' ? 'text-emerald-700' : 'text-red-700'}`}>{m.kind === 'topup' ? '+' : '−'}{cedis(lineTotal(m.lines))}</strong>
                    )}
                  </li>
                ))}
              </ul>
            ) : <p className="px-4 pb-4 text-sm text-muted-foreground">No cash has been added or taken out yet today.</p>}
          </Card>

          {view.dayId && branchId ? <MovementModal key={moving ?? 'closed'} open={moving !== null} initialKind={moving ?? 'topup'} onClose={() => setMoving(null)} dayId={view.dayId} branchId={branchId} /> : null}
        </>
      ) : null}
    </div>
  );
}