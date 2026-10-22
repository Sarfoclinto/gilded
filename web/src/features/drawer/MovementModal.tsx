import { useState } from 'react';
import { Input, Modal, Segmented } from 'antd';
import type { Lines } from '@gold/core';
import { useOutbox } from '@/shared/offline/OutboxProvider';
import { toast } from '@/shared/ui/toast';
import { NoteCountInput } from './NoteCountInput';
import { movementCommandSchema, OUTBOX } from './schemas';

/** Cash in (top-up from the safe or head office) or cash out (withdrawal). Queued like everything else, so it works offline. */
export function MovementModal({ open, onClose, dayId, branchId }: { open: boolean; onClose: () => void; dayId: string; branchId: string }) {
  const outbox = useOutbox();
  const [kind, setKind] = useState<'topup' | 'withdrawal'>('topup');
  const [lines, setLines] = useState<Lines>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const cmd = { id: crypto.randomUUID(), dayId, branchId, kind, lines, note, capturedAt: new Date().toISOString() };
    const parsed = movementCommandSchema.safeParse(cmd);
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? 'Check the form.');
    if (Object.keys(lines).length === 0) return toast.error('Enter at least one note count.');
    setBusy(true);
    await outbox.enqueue(cmd.id, OUTBOX.MOVEMENT, parsed.data);
    void outbox.syncNow();
    toast.success(kind === 'topup' ? 'Top-up recorded' : 'Withdrawal recorded');
    setLines({});
    setNote('');
    setBusy(false);
    onClose();
  };

  return (
    <Modal title="Cash in or out" open={open} onCancel={onClose} onOk={() => void submit()} okText="Record" confirmLoading={busy} destroyOnHidden>
      <div className="space-y-4">
        <Segmented
          block
          value={kind}
          onChange={(v) => setKind(v as 'topup' | 'withdrawal')}
          options={[
            { label: 'Top-up (cash in)', value: 'topup' },
            { label: 'Withdrawal (cash out)', value: 'withdrawal' },
          ]}
        />
        <NoteCountInput value={lines} onChange={setLines} />
        <Input
          size="large"
          placeholder="What is this for? e.g. restock from safe"
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Modal>
  );
}
