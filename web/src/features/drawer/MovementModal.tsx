import { useState } from "react";
import { Input, Modal } from "antd";
import {
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  UsersIcon,
} from "lucide-react";
import type { Lines } from "@gold/core";
import { useOutbox } from "@/shared/offline/OutboxProvider";
import { toast } from "@/shared/ui/toast";
import { NoteCountInput } from "./NoteCountInput";
import { lineTotal } from "@gold/core";
import { useSettings } from "@/features/settings/api";
import { allowanceDue } from "./allowance";
import { movementCommandSchema, OUTBOX } from "./schemas";

type Kind = "topup" | "withdrawal" | "allowance";

/** How each kind looks and reads. Colour is never the only signal: every card has an icon and words. */
const KINDS: Record<
  Kind,
  {
    title: string;
    hint: string;
    icon: typeof UsersIcon;
    card: string;
    chip: string;
    strip: string;
    ok: string;
    verb: string;
  }
> = {
  topup: {
    title: "Cash in",
    hint: "Money into the drawer",
    icon: ArrowDownToLineIcon,
    card: "border-emerald-500 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
    chip: "bg-emerald-500/15 text-emerald-700",
    strip: "bg-emerald-600",
    ok: "#059669",
    verb: "Record cash in",
  },
  withdrawal: {
    title: "Cash out",
    hint: "Money out of the drawer",
    icon: ArrowUpFromLineIcon,
    card: "border-red-500 bg-red-500/10 text-red-800 dark:text-red-300",
    chip: "bg-red-500/15 text-red-700",
    strip: "bg-red-600",
    ok: "#dc2626",
    verb: "Record cash out",
  },
  allowance: {
    title: "Allowance",
    hint: "Office, per person",
    icon: UsersIcon,
    card: "border-amber-500 bg-amber-500/10 text-amber-800 dark:text-amber-300",
    chip: "bg-amber-500/15 text-amber-700",
    strip: "bg-amber-600",
    ok: "#d97706",
    verb: "Record allowance",
  },
};

/** Cash in (top-up from the safe or head office) or cash out (withdrawal). Queued like everything else, so it works offline. */
export function MovementModal({
  open,
  onClose,
  dayId,
  branchId,
  initialKind = "topup",
}: {
  open: boolean;
  onClose: () => void;
  dayId: string;
  branchId: string;
  initialKind?: Kind;
}) {
  const outbox = useOutbox();
  const rate = useSettings()["allowance.perPerson"];
  const [kind, setKind] = useState<Kind>(initialKind);
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
    const saved = await outbox.enqueue(cmd.id, OUTBOX.MOVEMENT, parsed.data);
    if (!saved.ok) {
      setBusy(false);
      return toast.error(saved.message);
    }
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

  const k = KINDS[kind];
  return (
    <Modal
      title="Cash in or out"
      open={open}
      onCancel={onClose}
      onOk={() => void submit()}
      okText={k.verb}
      okButtonProps={{ style: { background: k.ok, borderColor: k.ok } }}
      confirmLoading={busy}
      destroyOnHidden
      centered
      width={560}
      styles={{
        body: { maxHeight: "70dvh", overflowY: "auto", paddingRight: 4 },
      }}
    >
      <div className="space-y-4">
        <div
          role="radiogroup"
          aria-label="What kind of movement"
          className="grid grid-cols-3 gap-2"
        >
          {(Object.keys(KINDS) as Kind[]).map((key) => {
            const o = KINDS[key];
            const on = key === kind;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setKind(key)}
                className={`flex min-h-[5.25rem] flex-col items-center justify-center gap-1 rounded-xl border-2 px-1.5 py-2 text-center transition ${on ? o.card : "border-border bg-card text-muted-foreground hover:bg-muted"}`}
              >
                <o.icon className="size-6" aria-hidden />
                <span className="text-sm font-semibold leading-tight">
                  {o.title}
                </span>
                <span className="text-[11px] leading-tight opacity-80">
                  {o.hint}
                </span>
              </button>
            );
          })}
        </div>

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
        ) : (
          <Input
            size="large"
            placeholder={
              kind === "topup"
                ? "Where is it from? e.g. restock from safe"
                : "What is it for? e.g. errand, sent to head office"
            }
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}

        <NoteCountInput
          value={lines}
          onChange={setLines}
          hideTotalCheck
          accent={k.strip}
          sign={kind === "topup" ? "+" : "−"}
        />
      </div>
    </Modal>
  );
}
