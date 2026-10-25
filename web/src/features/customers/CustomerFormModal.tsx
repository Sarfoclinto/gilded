import { useState } from 'react';
import { Alert, Input, Modal } from 'antd';
import { Button } from '@/shared/ui/Button';
import { TextField } from '@/shared/ui/TextField';
import { useCreateCustomer, useUpdateCustomer, type CustomerDetail, type CustomerRow } from './api';

function Form({ customer, onDone }: { customer: CustomerRow | null; onDone: (c: CustomerDetail) => void }) {
  const create = useCreateCustomer();
  const update = useUpdateCustomer();
  const [commandId] = useState(() => crypto.randomUUID());
  const [name, setName] = useState(customer?.name ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [notes, setNotes] = useState(customer?.notes ?? '');
  const pending = create.isPending || update.isPending;
  const error = (create.error ?? update.error)?.message;

  const changed = !customer || name.trim() !== customer.name || phone.trim() !== (customer.phone ?? '') || notes.trim() !== (customer.notes ?? '');
  const ok = name.trim().length >= 2 && phone.replace(/\s/g, '').length >= 6 && changed && !pending;

  function submit() {
    if (!ok) return;
    if (customer) update.mutate({ id: customer.id, changes: { name: name.trim(), phone: phone.trim(), notes: notes.trim() || null } }, { onSuccess: onDone });
    else create.mutate({ id: commandId, name: name.trim(), phone: phone.trim(), notes: notes.trim() || null }, { onSuccess: onDone });
  }

  return (
    <div className="space-y-3">
      <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <TextField label="Phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} hint="Used to recognise the same person next time." />
      <div>
        <label className="mb-1 block text-sm font-medium">Notes (optional)</label>
        <Input.TextArea rows={3} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {customer ? <p className="text-xs text-muted-foreground">Debts show the new name. Past receipts keep the name used on the day.</p> : null}
      {error ? <Alert type="error" showIcon title={error} /> : null}
      <Button className="w-full" onClick={submit} disabled={!ok} loading={pending}>{customer ? 'Save' : 'Add customer'}</Button>
    </div>
  );
}

export function CustomerFormModal({ open, customer, onClose, onDone }: { open: boolean; customer: CustomerRow | null; onClose: () => void; onDone: (c: CustomerDetail) => void }) {
  return (
    <Modal open={open} onCancel={onClose} title={customer ? `Edit ${customer.name}` : 'Add a customer'} footer={null} destroyOnHidden>
      <Form customer={customer} onDone={onDone} />
    </Modal>
  );
}