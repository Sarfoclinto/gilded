import { useState } from 'react';
import { Modal } from 'antd';
import { GoldPicker } from './GoldPicker';
import { useEditTransfer, useTransferableItems } from './api';
import type { Transfer } from './schemas';

function Form({ transfer, onClose }: { transfer: Transfer; onClose: () => void }) {
  const items = useTransferableItems(transfer.originBranchId);
  const edit = useEditTransfer();
  const [picked, setPicked] = useState<string[]>([]);
  const rows = items.data ?? [];
  return (
    <div className="space-y-3">
      <GoldPicker rows={rows} picked={picked} onChange={setPicked} loading={items.isLoading} />
      <button
        type="button"
        disabled={picked.length === 0 || edit.isPending}
        onClick={() => edit.mutate({ id: transfer.id, data: { addItemIds: picked } }, { onSuccess: onClose })}
        className="min-h-11 w-full rounded-lg bg-primary px-4 font-medium text-primary-foreground disabled:opacity-50"
      >
        {edit.isPending ? 'Adding…' : `Add ${picked.length || ''} piece${picked.length === 1 ? '' : 's'}`}
      </button>
    </div>
  );
}

export function AddItemsModal({ transfer, onClose }: { transfer: Transfer | null; onClose: () => void }) {
  return (
    <Modal open={!!transfer} onCancel={onClose} title="Add gold to this transfer" footer={null} destroyOnHidden width={560}>
      {transfer ? <Form transfer={transfer} onClose={onClose} /> : null}
    </Modal>
  );
}