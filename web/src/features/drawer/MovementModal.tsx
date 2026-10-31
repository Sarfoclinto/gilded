import { useState } from "react";
import { Input, Modal, Segmented } from "antd";
import type { Lines } from "@gold/core";
import { useOutbox } from "@/shared/offline/OutboxProvider";
import { toast } from "@/shared/ui/toast";
import { NoteCountInput } from "./NoteCountInput";
import { lineTotal } from "@gold/core";
import { useSettings } from "@/features/settings/api";
import { allowanceDue } from "./allowance";
import { movementCommandSchema, OUTBOX } from "./schemas";

/** Cash in (top-up from the safe or head office) or cash out (withdrawal). Queued like everything else, so it works offline. */
export function MovementModal({
  open,
  onClose,
  dayId,
  branchId,
}: {
  open: boolean;
  onClose: () => void;
  dayId: string;
  branchId: string;
}) {
  const outbox = useOutbox();
  const rate = useSettings()["allowance.perPerson"];
  const [kind, setKind] = useState<"topup" | "withdrawal" | "allowance">(
    "topup",
  );
  const [people, setPeople] = useState("");
  const [lines, setLines] = useState<Lines>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const n = Number(people);
    const cmd = {
      id: crypto.randomUUID(),
      dayId,
      branchId,
      kind,
      lines,
      note: kind === "allowance" ? "" : note,
      ...(kind === "allowance" ? { people: n } : {}),
      capturedAt: new Date().toISOString(),
    };
    const parsed = movementCommandSchema.safeParse(cmd);
    if (!parsed.success)
      return toast.error(parsed.error.issues[0]?.message ?? "Check the form.");
    if (Object.keys(lines).length === 0)
      return toast.error("Enter at least one note count.");
    if (kind === "allowance" && lineTotal(lines) !== allowanceDue(n, rate))
      return toast.error(
        `The notes must add up to GHS ${allowanceDue(n, rate).toLocaleString("en-GH")} (${n} × ${rate}).`,
      );
    setBusy(true);
    await outbox.enqueue(cmd.id, OUTBOX.MOVEMENT, parsed.data);
    void outbox.syncNow();
    toast.success(
      kind === "topup"
        ? "Top-up recorded"
        : kind === "allowance"
          ? "Allowance recorded"
          : "Withdrawal recorded",
    );
    setPeople("");
    setLines({});
    setNote("");
    setBusy(false);
    onClose();
  };

  return (
    <Modal
      title="Cash in or out"
      open={open}
      onCancel={onClose}
      onOk={() => void submit()}
      okText="Record"
      confirmLoading={busy}
      destroyOnHidden
    >
      <div className="space-y-4">
        <Segmented
          block
          value={kind}
          onChange={(v) => setKind(v as "topup" | "withdrawal" | "allowance")}
          options={[
            { label: "Top-up (cash in)", value: "topup" },
            { label: "Withdrawal (cash out)", value: "withdrawal" },
            { label: "Office allowance", value: "allowance" },
          ]}
        />
        <NoteCountInput value={lines} onChange={setLines} />
        {kind === "allowance" ? (
          <div className="space-y-1">
            <Input
              size="large"
              inputMode="numeric"
              placeholder="How many people are in the office today?"
              value={people}
              onChange={(e) =>
                setPeople(e.target.value.replace(/\D/g, "").slice(0, 3))
              }
            />
            <p className="tnum text-xs text-muted-foreground">
              {Number(people) > 0
                ? `Pay GHS ${allowanceDue(Number(people), rate).toLocaleString("en-GH")} (${people} × ${rate}). Choose the notes you take from the drawer.`
                : `GHS ${rate} for each person, taken from the drawer.`}
            </p>
          </div>
        ) : null}
        <Input
          size="large"
          className={kind === "allowance" ? "hidden" : undefined}
          placeholder="What is this for? e.g. restock from safe"
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Modal>
  );
}
