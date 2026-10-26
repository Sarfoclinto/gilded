import { useState } from "react";
import { Alert, Modal } from "antd";
import {
  CollectorFields,
  cleanCollector,
  collectorReady,
} from "./CollectorFields";
import { useEditTransfer } from "./api";
import type { CollectorInput, Transfer } from "./schemas";

function Form({
  transfer,
  onClose,
}: {
  transfer: Transfer;
  onClose: () => void;
}) {
  const edit = useEditTransfer();
  const c = transfer.collector;
  const [value, setValue] = useState<CollectorInput>(
    c
      ? {
          type: c.type,
          userId: c.userId ?? undefined,
          name: c.type === "external" ? (c.name ?? "") : undefined,
          phone: c.phone ?? "",
          idType: c.idType ?? "",
          idNumber: c.idNumber ?? "",
          relationship: c.relationship ?? "",
        }
      : { type: "staff" },
  );
  const ok = collectorReady(value) && !edit.isPending;
  return (
    <div className="space-y-4">
      {transfer.status === "released" ? (
        <Alert
          type="info"
          showIcon
          title="The change is written in the transfer's timeline, with who made it."
        />
      ) : null}
      <CollectorFields value={value} onChange={setValue} />
      <button
        type="button"
        disabled={!ok}
        onClick={() =>
          edit.mutate(
            { id: transfer.id, data: { collector: cleanCollector(value) } },
            { onSuccess: onClose },
          )
        }
        className="min-h-11 w-full rounded-lg bg-primary px-4 font-medium text-primary-foreground disabled:opacity-50"
      >
        {edit.isPending ? "Saving…" : "Save collector"}
      </button>
    </div>
  );
}

export function CollectorModal({
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
      title="Who is carrying it"
      footer={null}
      destroyOnHidden
      width={520}
    >
      {transfer ? <Form transfer={transfer} onClose={onClose} /> : null}
    </Modal>
  );
}
