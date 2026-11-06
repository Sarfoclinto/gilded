import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Input } from "antd";
import { lineTotal, type Lines } from "@gold/core";
import paths from "@/config/paths";
import { useAuth } from "@/features/auth/store";
import { cedis } from "@/features/calculator/format";
import { useOutbox } from "@/shared/offline/OutboxProvider";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { toast } from "@/shared/ui/toast";
import { exchangeKeys } from "../api";
import { checkExchange } from "../exchange";
import { linesText } from "../format";
import { useActiveDrawer, useBranchExchanges } from "../hooks";
import { NoteCountInput } from "../NoteCountInput";
import { exchangeCommandSchema, OUTBOX } from "../schemas";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * The branch changes notes for itself: smaller notes to give change, or bigger notes to hand out fewer. What goes out of the drawer must be
 * worth exactly what comes in, and they must be different notes. It is a drawer movement (the count stays right) and every one is audited.
 * Queued like any drawer movement, so it works without a connection.
 */
export default function NoteExchangePage() {
  const branchId = useAuth((s) => s.activeBranchId);
  const { view } = useActiveDrawer();
  const outbox = useOutbox();
  const qc = useQueryClient();
  const recent = useBranchExchanges(branchId ?? null);
  const [out, setOut] = useState<Lines>({});
  const [coming, setComing] = useState<Lines>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // In the command, "gave" is what comes into the drawer and "took" is what leaves it.
  const check = checkExchange(coming, out, view.balance);
  const open = view.status === "open" && !!view.dayId;

  async function submit() {
    if (!check.valid || !open || !view.dayId || !branchId) return;
    const cmd = {
      id: crypto.randomUUID(),
      dayId: view.dayId,
      branchId,
      gave: coming,
      took: out,
      ...(note.trim() ? { note: note.trim() } : {}),
      capturedAt: new Date().toISOString(),
    };
    const parsed = exchangeCommandSchema.safeParse(cmd);
    if (!parsed.success)
      return toast.error(parsed.error.issues[0]?.message ?? "Check the notes.");
    setBusy(true);
    const saved = await outbox.enqueue(cmd.id, OUTBOX.EXCHANGE, parsed.data);
    if (!saved.ok) {
      setBusy(false);
      return toast.error(saved.message);
    }
    await outbox.syncNow();
    toast.success("Notes changed");
    setOut({});
    setComing({});
    setNote("");
    setBusy(false);
    void qc.invalidateQueries({ queryKey: exchangeKeys.all });
  }

  const status =
    check.gaveTotal === 0 && check.tookTotal === 0
      ? null
      : check.remaining === 0 &&
          check.overlap.length === 0 &&
          Object.keys(check.short).length === 0
        ? {
            tone: "ok" as const,
            text: `Adds up exactly: ${cedis(check.tookTotal)} out, ${cedis(check.gaveTotal)} in`,
          }
        : check.remaining !== 0
          ? {
              tone: "bad" as const,
              text:
                check.remaining > 0
                  ? `Notes in are worth ${cedis(check.remaining)} more than notes out`
                  : `Notes out are worth ${cedis(-check.remaining)} more than notes in`,
            }
          : null;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-8">
      <div>
        <h1 className="text-xl font-bold">Change notes</h1>
        <p className="text-sm text-muted-foreground">
          Swap notes for the branch itself, for example smaller notes to give
          change, or bigger notes to hand out fewer. What goes out must be worth
          exactly what comes in. Every change is recorded.
        </p>
      </div>

      {!open ? (
        <Alert
          type="info"
          showIcon
          title="There is no open day."
          description="Open the day first, then change notes."
          action={<Link to={paths.drawer.open.href}>Open the day</Link>}
        />
      ) : null}

      <h2 className="text-sm font-semibold">Notes going out of the drawer</h2>
      <NoteCountInput
        value={out}
        onChange={setOut}
        disabled={!open}
        hideTotalCheck
      />
      <h2 className="text-sm font-semibold">Notes coming into the drawer</h2>
      <NoteCountInput
        value={coming}
        onChange={setComing}
        disabled={!open}
        hideTotalCheck
      />

      {status ? (
        <div
          role={status.tone === "bad" ? "alert" : "status"}
          className={`tnum rounded-lg border p-3 text-sm ${status.tone === "ok" ? "border-emerald-500/50 bg-emerald-500/10" : "border-red-500/50 bg-red-500/10"}`}
        >
          {status.text}
        </div>
      ) : null}
      {check.overlap.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          title={`Use different notes on each side (GHS ${check.overlap.join(", GHS ")} appear on both).`}
        />
      ) : null}
      {Object.keys(check.short).length > 0 ? (
        <Alert
          type="error"
          showIcon
          title={`The drawer does not have enough to send out: ${Object.entries(
            check.short,
          )
            .map(([d, n]) => `GHS ${d} (${n} short)`)
            .join(", ")}.`}
        />
      ) : null}
      <Input
        size="large"
        placeholder="Note (optional), e.g. change for the afternoon"
        maxLength={200}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={!open}
      />
      <Button
        className="w-full"
        onClick={() => void submit()}
        disabled={!check.valid || !open}
        loading={busy}
      >
        Record the change{check.valid ? ` · ${cedis(lineTotal(out))}` : ""}
      </Button>

      <h2 className="pt-2 text-sm font-semibold">
        Recent changes at this branch
      </h2>
      {recent.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : null}
      {recent.error ? (
        <p className="text-sm text-muted-foreground">
          The list needs a connection.
        </p>
      ) : null}
      {recent.data && recent.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">None yet.</p>
      ) : null}
      {recent.data?.map((e) => (
        <Card key={e.id} className="space-y-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium">
              {cedis(Number(e.value))}
            </span>
            <span className="text-xs text-muted-foreground">
              {when(e.capturedAt)}
              {e.createdBy ? ` · ${e.createdBy.displayName}` : ""}
            </span>
          </div>
          <p className="tnum text-sm">
            Out: {linesText(e.exchange.took)} · In: {linesText(e.exchange.gave)}
          </p>
          {e.note ? (
            <p className="text-xs text-muted-foreground">{e.note}</p>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
