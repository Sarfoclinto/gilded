import { useState } from 'react';
import { Alert, Input, Modal } from 'antd';
import { useDebounced } from '@/shared/lib/useDebounced';
import { Button } from '@/shared/ui/Button';
import { useCustomerPage, useMergeCustomers, type CustomerRow } from './api';

function Form({ keep, onDone }: { keep: CustomerRow; onDone: () => void }) {
  const [q, setQ] = useState('');
  const text = useDebounced(q, 250);
  const found = useCustomerPage(text.trim().length >= 2 ? text : '', 1, 8);
  const [pick, setPick] = useState<CustomerRow | null>(null);
  const merge = useMergeCustomers();
  const options = text.trim().length >= 2 ? (found.data?.items ?? []).filter((c) => c.id !== keep.id) : [];

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Find the <strong>duplicate</strong> of {keep.name}. Its purchases, debts and held gold move to {keep.name}, and the duplicate is removed. This cannot be undone.
      </p>
      {!pick ? (
        <>
          <Input autoFocus size="large" placeholder="Search the duplicate by name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="divide-y divide-border rounded-lg border border-border">
            {options.map((c) => (
              <li key={c.id}>
                <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left hover:bg-muted" onClick={() => setPick(c)}>
                  <span className="font-medium">{c.name}</span>
                  <span className="text-sm text-muted-foreground">{c.phone ?? 'no phone'} · {c.purchases} purchase{c.purchases === 1 ? '' : 's'}</span>
                </button>
              </li>
            ))}
            {options.length === 0 ? <li className="px-3 py-3 text-sm text-muted-foreground">{text.trim().length < 2 ? 'Type at least two letters.' : 'No other customer found.'}</li> : null}
          </ul>
        </>
      ) : (
        <>
          <Alert type="warning" showIcon title={`Merge “${pick.name}” (${pick.phone ?? 'no phone'}, ${pick.purchases} purchases) into “${keep.name}”?`} />
          {merge.error ? <Alert type="error" showIcon title={merge.error.message} /> : null}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setPick(null)}>Choose another</Button>
            <Button className="flex-1" loading={merge.isPending} onClick={() => merge.mutate({ keepId: keep.id, removeId: pick.id }, { onSuccess: onDone })}>Merge</Button>
          </div>
        </>
      )}
    </div>
  );
}

export function MergeModal({ keep, onClose }: { keep: CustomerRow | null; onClose: () => void }) {
  return (
    <Modal open={!!keep} onCancel={onClose} title={keep ? `Merge a duplicate into ${keep.name}` : ''} footer={null} destroyOnHidden>
      {keep ? <Form keep={keep} onDone={onClose} /> : null}
    </Modal>
  );
}