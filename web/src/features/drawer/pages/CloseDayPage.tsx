import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Checkbox, Input, Modal } from 'antd';
import { lineTotal, type Lines } from '@gold/core';
import paths from '@/config/paths';
import { useAuth } from '@/features/auth/store';
import { cedis } from '@/features/calculator/format';
import { useApiMutation } from '@/shared/api/hooks';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { decimalOnly } from '@/shared/lib/numbers';
import { dayKeys, daysApi } from '../api';
import { checkFigures, closingProblems, closingProgress, figureLabel, figureState, figureUnit, type Declared } from '../closing';
import { FigureBadge } from '../FigureBadge';
import { linesText } from '../format';
import { useSettings } from '@/features/settings/api';
import { useActiveDrawer, useClosingPreview, useDayActivity } from '../hooks';
import { DayActivityPanel } from '../DayActivityPanel';
import { NoteCountInput } from '../NoteCountInput';
import type { Figure } from '../schemas';

const unitText = (f: Figure, v: string) => (figureUnit[f] === 'g' ? `${v} g` : cedis(Number(v)));

export default function CloseDayPage() {
  const navigate = useNavigate();
  const branchId = useAuth((s) => s.activeBranchId);
  const { view } = useActiveDrawer();
  const dayId = view.status === 'open' ? view.dayId : null;
  const previewQuery = useClosingPreview(dayId);
  const preview = previewQuery.data ?? null;
  const [summaryOpen, setSummaryOpen] = useState(false);
  const activityQuery = useDayActivity(summaryOpen ? dayId : null);

  const [cash, setCash] = useState<Lines>({});
  const [text, setText] = useState({ goodsTop: '', goodsDown: '', goodsValue: '', debt: '', payable: '', custodyTop: '' });
  const [why, setWhy] = useState<Partial<Record<Figure, string>>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [commandId] = useState(() => crypto.randomUUID());
  // Blind count: the books are not shown. A mismatch is revealed (without amounts) when the button is pressed, then needs a recount or a reason.
  const blind = useSettings()['count.blind'];
  const [revealed, setRevealed] = useState(false);
  const showBooks = !blind;

  const close = useApiMutation({
    mutationFn: daysApi.close,
    invalidates: [dayKeys.all],
    onSuccess: (day) => {
      const s = day.closing?.signoff.status;
      navigate(paths.drawer.home.href, { replace: true, state: { closed: s } });
    },
    successMessage: 'Day closed',
  });

  const declared: Declared = { cash, ...text };
  const checks = useMemo(() => (preview ? checkFigures(preview, declared, view.loose) : []), [preview, cash, text, view.loose]); // eslint-disable-line react-hooks/exhaustive-deps
  const allProblems = preview ? closingProblems(checks, why, confirmed) : [];
  const problems = blind && !revealed ? allProblems.filter((p) => !p.endsWith('write why it differs.')) : allProblems;
  const progress = closingProgress(checks, Object.keys(cash).length > 0 || (preview ? Number(preview.expected.cash.value) === 0 : false));
  const outdated = close.error?.code === 'CONFIRMATION_OUTDATED';

  if (view.status !== 'open' || !dayId) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <h1 className="text-xl font-bold">Close the day</h1>
        <Alert type="info" showIcon title="There is no open day to close." action={<Link to={paths.drawer.home.href}>Back</Link>} />
      </div>
    );
  }

  function submit() {
    if (!preview || !branchId || !dayId || problems.length) return;
    if (blind && !revealed && checks.some((x) => x.needsReason && !x.invalid)) {
      setRevealed(true);
      return;
    }
    const explanations: Partial<Record<Figure, string>> = {};
    for (const c of checks) if (c.needsReason) explanations[c.figure] = (why[c.figure] ?? '').trim();
    close.mutate({
      id: commandId,
      dayId,
      branchId,
      declared: { cash, goodsTop: text.goodsTop.trim(), goodsDown: text.goodsDown.trim(), goodsValue: text.goodsValue.trim(), debt: text.debt.trim(), payable: text.payable.trim(), custodyTop: text.custodyTop.trim() },
      explanations,
      confirmation: { accepted: true, version: preview.confirmation.version },
      capturedAt: new Date().toISOString(),
    });
  }

  const field = (key: keyof typeof text, f: Figure) => {
    const c = checks.find((x) => x.figure === f);
    return (
      <Card key={f} className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <label className="font-medium" htmlFor={`fig-${f}`}>{figureLabel[f]}</label>
            {showBooks ? <div className="tnum text-xs text-muted-foreground">Books: {preview ? unitText(f, c?.expected ?? '0') : '…'}</div> : null}
          </div>
          {c && showBooks ? <FigureBadge state={figureState(c, text[key].trim() !== '')} /> : null}
        </div>
        <Input
          id={`fig-${f}`}
          size="large"
          inputMode="decimal"
          suffix={figureUnit[f] === 'g' ? 'g' : 'GHS'}
          placeholder="0"
          value={text[key]}
          onChange={(e) => setText((t) => ({ ...t, [key]: decimalOnly(e.target.value) }))}
          status={c?.invalid && text[key] !== '' ? 'error' : undefined}
        />
        {explainBox(f)}
      </Card>
    );
  };

  function explainBox(f: Figure) {
    const c = checks.find((x) => x.figure === f);
    if (!c || c.invalid || !c.needsReason) return null;
    if (f === 'cash' && Object.keys(cash).length === 0) return null;
    if (blind && !revealed) return null;
    return (
      <div className="space-y-1">
        <p className="tnum text-sm font-medium text-amber-700 dark:text-amber-300">
          {blind ? 'This does not match the books. Count again, or say why.' : c.valueDiffers ? `${c.difference > 0 ? 'Over' : 'Short'} by ${unitText(f, String(Math.abs(c.difference)))}` : 'Same value, different notes'}
        </p>
        <Input.TextArea
          rows={2}
          maxLength={500}
          placeholder="Why does it differ? (required)"
          value={why[f] ?? ''}
          onChange={(e) => setWhy((w) => ({ ...w, [f]: e.target.value }))}
          status={(why[f]?.trim().length ?? 0) >= 5 ? undefined : 'warning'}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-8">
      <div>
        <h1 className="text-xl font-bold">Close the day</h1>
        <p className="text-sm text-muted-foreground">
          {view.businessDate} · count everything the branch really holds. If a figure differs from the books, say why. Nothing is overwritten: the books and your figures are both kept.
        </p>
      </div>

      <Button variant="secondary" className="w-full" onClick={() => setSummaryOpen(true)}>
        Day summary · this day only
      </Button>
      <Modal title={`This day only · ${view.businessDate}`} open={summaryOpen} onCancel={() => setSummaryOpen(false)} footer={null} destroyOnHidden>
        <p className="mb-3 text-xs text-muted-foreground">Today's movements only. The closing count below is still checked against the books since the beginning.</p>
        {activityQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading today's figures…</p> : null}
        {activityQuery.error ? <Alert type="error" showIcon title="Could not load today's figures. This needs a connection." /> : null}
        {activityQuery.data ? <DayActivityPanel activity={activityQuery.data} /> : null}
      </Modal>

      {previewQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading what the books hold…</p> : null}
      {previewQuery.error ? <Alert type="error" showIcon title="Could not load the books. Closing needs a connection." /> : null}
      {view.pendingCount > 0 ? <Alert type="warning" showIcon title="Some changes on this device are not sent yet. Wait for them to sync before closing, so the books are complete." /> : null}
      {preview && preview.pendingPayments > 0 ? (
        <Alert
          type="warning"
          showIcon
          title={`${preview.pendingPayments} mobile money part${preview.pendingPayments > 1 ? 's are' : ' is'} still waiting for confirmation.`}
          description="They are not counted in the books yet. You can still close, or confirm them first."
          action={<Link to={paths.payments.href}>Open</Link>}
        />
      ) : null}

      {preview ? (
        <>
          <h2 className="text-sm font-semibold">1 · Cash</h2>
          <Card className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-medium">{figureLabel.cash}</h2>
                {showBooks ? <div className="tnum text-xs text-muted-foreground">Books: {cedis(Number(preview.expected.cash.value))} · {linesText(preview.expected.cash.lines)}</div> : null}
              </div>
              {(() => { const c = checks.find((x) => x.figure === 'cash'); return c && showBooks ? <FigureBadge state={figureState(c, Object.keys(cash).length > 0)} /> : null; })()}
            </div>
            <NoteCountInput value={cash} onChange={setCash} expected={showBooks ? preview.expected.cash.lines : undefined} />
            {explainBox('cash')}
            {Object.keys(cash).length === 0 ? <p className="text-xs text-muted-foreground">If the drawer is empty, leave all notes at 0.</p> : null}
          </Card>
          <h2 className="pt-2 text-sm font-semibold">2 · Gold in the branch</h2>
          {field('goodsTop', 'goods_top')}
          {field('goodsDown', 'goods_down')}
          {field('goodsValue', 'goods_value')}
          <h2 className="pt-2 text-sm font-semibold">3 · Money</h2>
          {field('debt', 'debt')}
          {field('payable', 'payable')}
          <h2 className="pt-2 text-sm font-semibold">4 · Held as security</h2>
          {field('custodyTop', 'custody_top')}

          <h2 className="pt-2 text-sm font-semibold">5 · Confirm</h2>
          <Card className="space-y-3 border-primary/40">
            <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)}>
              <span className="text-sm">{preview.confirmation.text}</span>
            </Checkbox>
          </Card>

          {outdated ? <Alert type="warning" showIcon title="The confirmation wording was updated. Read it again and tick it." action={<Button variant="secondary" onClick={() => { close.reset(); void previewQuery.refetch(); setConfirmed(false); }}>Reload wording</Button>} /> : null}
          {close.error && !outdated ? <Alert type="error" showIcon title={close.error.message} /> : null}
          {problems.length && Object.keys(cash).length + Object.values(text).filter(Boolean).length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          ) : null}

          <div className="sticky bottom-0 z-10 -mx-4 border-t border-border bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:-mx-4">
            <div className="mb-2 flex items-center justify-between gap-3 text-xs">
              <span className="text-muted-foreground">{progress.entered} of {progress.total} figures entered</span>
              {showBooks ? <span className={progress.differ ? 'font-semibold text-amber-700' : 'text-muted-foreground'}>{progress.differ ? `${progress.differ} differ from the books` : 'None differ so far'}</span> : <span className="text-muted-foreground">Counted without the books</span>}
            </div>
            <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden><div className="h-full bg-emerald-600 transition-all" style={{ width: `${(progress.entered / progress.total) * 100}%` }} /></div>
            <Button className="w-full" onClick={submit} disabled={problems.length > 0 || close.isPending} loading={close.isPending}>
              Close the day · cash {cedis(lineTotal(cash))}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}