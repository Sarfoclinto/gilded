import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Input } from 'antd';
import { lineTotal, type Lines } from '@gold/core';
import paths from '@/config/paths';
import { useAuth } from '@/features/auth/store';
import { cedis } from '@/features/calculator/format';
import { useOutbox } from '@/shared/offline/OutboxProvider';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { toast } from '@/shared/ui/toast';
import { linesText, signed } from '../format';
import { useActiveDrawer } from '../hooks';
import { NoteCountInput } from '../NoteCountInput';
import { compareCount } from '../projection';
import { closeDaySchema, OUTBOX } from '../schemas';

export default function CloseDayPage() {
  const navigate = useNavigate();
  const outbox = useOutbox();
  const branchId = useAuth((s) => s.activeBranchId);
  const { view } = useActiveDrawer();
  const [counted, setCounted] = useState<Lines>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const expected = view.balance ?? {};
  const cmp = useMemo(() => compareCount(expected, counted), [expected, counted]);
  const hasCount = Object.keys(counted).length > 0;
  const needsReason = hasCount && cmp.amount !== 0;
  const canSave = !!branchId && view.status === 'open' && !!view.dayId && hasCount && (!needsReason || reason.trim().length > 0) && outbox.ready && !busy;

  async function submit() {
    if (!canSave || !branchId || !view.dayId) return;
    setBusy(true);
    const cmd = {
      id: crypto.randomUUID(),
      dayId: view.dayId,
      branchId,
      counted,
      reason: needsReason ? reason.trim() : null,
      capturedAt: new Date().toISOString(),
    };
    const parsed = closeDaySchema.safeParse(cmd);
    if (!parsed.success) {
      setBusy(false);
      return toast.error(parsed.error.issues[0]?.message ?? 'Check the count.');
    }
    await outbox.enqueue(cmd.id, OUTBOX.CLOSE, parsed.data);
    void outbox.syncNow();
    toast.success(cmp.amount === 0 ? 'Day closed' : 'Day closed. The manager will review the difference.');
    navigate(paths.drawer.home.href, { replace: true });
  }

  if (view.status !== 'open') {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <h1 className="text-xl font-bold">Close the day</h1>
        <Alert type="info" showIcon title="There is no open day to close." action={<Link to={paths.drawer.home.href}>Back</Link>} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-8">
      <h1 className="text-xl font-bold">Close the day · {view.businessDate}</h1>
      <Card className="flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">Drawer should hold</span>
        <strong className="tnum text-xl">{cedis(lineTotal(expected))}</strong>
      </Card>
      {view.pendingCount > 0 ? <Alert type="warning" showIcon title="Some changes on this device are not sent yet. They are included in the expected amount." /> : null}

      <p className="text-sm text-muted-foreground">Count every note in the drawer and enter what you really have.</p>
      <NoteCountInput value={counted} onChange={setCounted} expected={expected} />

      {hasCount ? (
        cmp.amount === 0 ? (
          <Alert type="success" showIcon title="The count matches exactly." />
        ) : (
          <Card className="space-y-3 border-amber-500/60">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium">{cmp.amount < 0 ? 'Short by' : 'Over by'}</span>
              <strong className="tnum text-xl">{signed(cmp.amount)}</strong>
            </div>
            <div className="text-xs text-muted-foreground">Difference by note: {linesText(cmp.variance)}</div>
            <Input.TextArea
              rows={3}
              maxLength={500}
              placeholder="Explain the difference (required)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              status={reason.trim() ? undefined : 'warning'}
            />
            <p className="text-xs text-muted-foreground">You can still close. The manager signs off the difference later and it does not stop tomorrow from opening.</p>
          </Card>
        )
      ) : null}

      <div className="sticky bottom-0 -mx-4 border-t border-border bg-background/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur">
        <Button className="w-full" onClick={() => void submit()} disabled={!canSave} loading={busy}>
          Close the day
        </Button>
      </div>
    </div>
  );
}
