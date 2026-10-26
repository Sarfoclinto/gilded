import { useState } from "react";
import { Alert, Checkbox, Modal } from "antd";
import { cedis } from "@/features/calculator/format";
import { useEditTransfer, useTransferableItems } from "./api";
import type { Transfer } from "./schemas";

function Form({
  transfer,
  onClose,
}: {
  transfer: Transfer;
  onClose: () => void;
}) {
  const items = useTransferableItems(transfer.originBranchId);
  const edit = useEditTransfer();
  const [picked, setPicked] = useState<string[]>([]);
  const rows = items.data ?? [];
  return (
    <div className="space-y-3">
      {rows.length === 0 && !items.isLoading ? (
        <Alert
          type="info"
          showIcon
          title="No more gold is available at this branch."
        />
      ) : null}
      <ul className="max-h-96 divide-y divide-border overflow-auto rounded-lg border border-border">
        {rows.map((i) => (
          <li key={i.itemId} className="px-3 py-2">
            <Checkbox
              checked={picked.includes(i.itemId)}
              onChange={(e) =>
                setPicked(
                  e.target.checked
                    ? [...picked, i.itemId]
                    : picked.filter((x) => x !== i.itemId),
                )
              }
            >
              <span className="font-medium">{i.customerName}</span> · {i.label}
              <span className="tnum block text-xs text-muted-foreground">
                {i.reference} · top {i.top} g · down {i.down} g ·{" "}
                {cedis(Number(i.value))}
              </span>
            </Checkbox>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={picked.length === 0 || edit.isPending}
        onClick={() =>
          edit.mutate(
            { id: transfer.id, data: { addItemIds: picked } },
            { onSuccess: onClose },
          )
        }
        className="min-h-11 w-full rounded-lg bg-primary px-4 font-medium text-primary-foreground disabled:opacity-50"
      >
        {edit.isPending
          ? "Adding…"
          : `Add ${picked.length || ""} piece${picked.length === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}

export function AddItemsModal({
  transfer,
  onClose,
}: {
  transfer: Transfer | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={!!transfer}
      onCancel={onClose}
      title="Add gold to this transfer"
      footer={null}
      destroyOnHidden
      width={560}
    >
      {transfer ? <Form transfer={transfer} onClose={onClose} /> : null}
    </Modal>
  );
}
