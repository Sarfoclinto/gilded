import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert } from 'antd';
import { lineTotal, type Lines } from '@gold/core';
import paths from '@/config/paths';
import { useAuth } from '@/features/auth/store';
import { cedis } from '@/features/calculator/format';
import { useOutbox } from '@/shared/offline/OutboxProvider';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { toast } from '@/shared/ui/toast';
import { useActiveDrawer } from '../hooks';
import { NoteCountInput } from '../NoteCountInput';
import { localDate } from '../projection';
import { openDaySchema, OUTBOX } from '../schemas';

const same = (a: Lines, b: Lines) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

export default function OpenDayPage() {
  const navigate = useNavigate();
  const outbox = useOutbox();
  const branchId = useAuth((s) => s.activeBranchId);
  const { view } = useActiveDrawer();
  const [lines, setLines] = useState<Lines>({});
  const [busy, setBusy] = useState(false);
  const today = localDate();

  const blocked =
    view.status === 'open'
      ? 'A day is already open for this branch.'
      : view.status === 'closed' && view.businessDate === today
        ? 'Today was already opened and closed. The next day can be opened tomorrow.'
        : null;
  const carried = view.carryOver && Object.keys(view.carryOver).length > 0 ? view.carryOver : null;
  const canSave = !!branchId && Object.keys(lines).length > 0 && !blocked && outbox.ready && !busy;

  async function submit() {
    if (!canSave || !branchId) return;
    setBusy(true);
    const cmd = {
      id: crypto.randomUUID(),
      branchId,
      businessDate: today,
      lines,
      source: carried && same(lines, carried) ? ('carried' as const) : ('counted' as const),
      capturedAt: new Date().toISOString(),
    };
    const parsed = openDaySchema.safeParse(cmd);
    if (!parsed.success) {
      setBusy(false);
      return toast.error(parsed.error.issues[0]?.message ?? 'Check the count.');
    }
    await outbox.enqueue(cmd.id, OUTBOX.OPEN, parsed.data);
    void outbox.syncNow();
    toast.success('Day opened');
    navigate(paths.drawer.home.href, { replace: true });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-8">
      <h1 className="text-xl font-bold">Open the day · {today}</h1>
      {blocked ? <Alert type="info" showIcon title={blocked} action={<Link to={paths.drawer.home.href}>Back</Link>} /> : null}

      {carried ? (
        <Card className="flex items-center justify-between gap-3">
          <div className="text-sm">
            <div className="font-medium">Last closing count</div>
            <div className="tnum text-muted-foreground">{cedis(lineTotal(carried))}</div>
          </div>
          <Button variant="secondary" onClick={() => setLines({ ...carried })} disabled={!!blocked}>
            Use it
          </Button>
        </Card>
      ) : null}

      <p className="text-sm text-muted-foreground">Count the notes in the drawer and enter them. If the count differs from last night, the manager will see it.</p>
      <NoteCountInput value={lines} onChange={setLines} disabled={!!blocked} />

      <div className="sticky bottom-0 -mx-4 border-t border-border bg-background/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur">
        <Button className="w-full" onClick={() => void submit()} disabled={!canSave} loading={busy}>
          Open the day with {cedis(lineTotal(lines))}
        </Button>
      </div>
    </div>
  );
}
