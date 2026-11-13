import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Input } from "antd";
import { lineTotal, subtractLines, type Lines } from "@gold/core";
import paths from "@/config/paths";
import { useAuth } from "@/features/auth/store";
import { cedis } from "@/features/calculator/format";
import { useApiMutation } from "@/shared/api/hooks";
import { errorMessage } from "@/shared/api/errors";
import { useConnectivity } from "@/shared/offline/connectivity";
import { useOutbox } from "@/shared/offline/OutboxProvider";
import { ageLabel } from "@/shared/offline/policy";
import { toast } from "@/shared/ui/toast";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { dayKeys, daysApi } from "../api";
import { linesText } from "../format";
import { useSettings } from "@/features/settings/api";
import { useActiveDrawer } from "../hooks";
import { NoteCountInput } from "../NoteCountInput";
import { localDate } from "../projection";
import { clockBehind, mustQueue } from "../offlineDay";
import { OUTBOX, type OpenDayInput } from "../schemas";

const longDate = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

const same = (a: Lines, b: Lines) =>
  Object.keys(subtractLines(a, b)).length === 0;

export default function OpenDayPage() {
  const navigate = useNavigate();
  const branchId = useAuth((s) => s.activeBranchId);
  const { view, state } = useActiveDrawer();
  const [lines, setLines] = useState<Lines>({});
  const [explanation, setExplanation] = useState("");
  // Blind count: the books are not shown; a mismatch is revealed (without the amount) when the button is pressed.
  const blind = useSettings()["count.blind"];
  const [revealed, setRevealed] = useState(false);
  // One id per form: pressing the button twice, or retrying after a lost answer, can only open one day.
  const [commandId] = useState(() => crypto.randomUUID());
  const today = localDate();

  const online = useConnectivity((s) => s.online);
  const outbox = useOutbox();
  const [saving, setSaving] = useState(false);
  // No connection, a day that so far exists only on this computer, or entries still waiting to be sent: the opening is saved here
  // and sent in order. The day opens on this computer at once.
  const queue = mustQueue(view, online);

  /** Save the opening on this computer. `basis` is what this computer's books said, so the server knows what the count was compared with. */
  async function saveHere(cmd: OpenDayInput) {
    setSaving(true);
    try {
      const saved = await outbox.enqueue(cmd.id, OUTBOX.DAY_OPEN, {
        ...cmd,
        basis: { cash: view.carryOver ?? {}, asOf: state?.asOf },
      });
      if (!saved.ok) return void toast.error(saved.message);
      toast.success(
        "Day opened on this computer. It will be sent when there is a connection.",
      );
      navigate(paths.drawer.home.href, { replace: true });
    } finally {
      setSaving(false);
    }
  }

  const open = useApiMutation({
    mutationFn: daysApi.open,
    invalidates: [dayKeys.all],
    successMessage: "Day opened",
    silent: true,
    onSuccess: () => navigate(paths.drawer.home.href, { replace: true }),
    // The connection dropped while sending: nothing is lost, the opening is saved here instead (the same id, so it can only open one day).
    onError: (e, cmd) =>
      e.retryable || e.kind === "offline"
        ? void saveHere(cmd)
        : void toast.error(errorMessage(e)),
  });

  const blocked =
    view.status === "open"
      ? "A day is already open for this branch."
      : view.status === "unknown"
        ? "This computer has not loaded the drawer yet. Connect to the internet once, then open the day."
        : clockBehind(today, view.businessDate)
          ? `This computer's date (${today}) is before the last day it knows (${view.businessDate}). Correct the computer's clock, then open the day.`
          : null;
  // Closed earlier today, but a customer has come in: a second session on the same date, with a reason. The closed count is not touched.
  const afterClose = view.status === "closed" && view.businessDate === today;

  // What the books say the drawer holds. null before the branch's very first day (the count then sets the starting balance).
  // (The drawer view already follows a closing made on this computer that the server has not received yet.)
  const books = view.carryOver ?? null;
  const first = state !== null && view.status === "none" && books === null;
  const hasCount = Object.keys(lines).length > 0;
  const differs = books !== null && hasCount && !same(lines, books);
  const diffAmount = books ? lineTotal(lines) - lineTotal(books) : 0;
  // Note rule off for this branch: only a different TOTAL needs a reason.
  const needsReason =
    differs && (!view.loose || diffAmount !== 0) && (!blind || revealed);
  const busy = open.isPending || saving;
  const canSave = afterClose
    ? !!branchId && !blocked && !busy && explanation.trim().length >= 5
    : !!branchId &&
      hasCount &&
      !blocked &&
      !busy &&
      (!needsReason || explanation.trim().length >= 5);

  function submit() {
    if (!canSave || !branchId) return;
    if (blind && !afterClose && differs && !revealed) {
      setRevealed(true);
      return;
    }
    const cmd: OpenDayInput = afterClose
      ? {
          id: commandId,
          branchId,
          businessDate: today,
          lines: books ?? {},
          source: "carried",
          capturedAt: new Date().toISOString(),
          explanation: explanation.trim(),
          afterClose: true,
        }
      : {
          id: commandId,
          branchId,
          businessDate: today,
          lines,
          source: books && same(lines, books) ? "carried" : "counted",
          capturedAt: new Date().toISOString(),
          explanation: needsReason ? explanation.trim() : null,
        };
    if (queue) void saveHere(cmd);
    else open.mutate(cmd);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-8">
      <div>
        <h1 className="text-xl font-bold">Open the day</h1>
        <p className="text-sm text-muted-foreground">
          {longDate(today)} · count the drawer before the first customer.
        </p>
      </div>
      {blocked ? (
        <Alert
          type="info"
          showIcon
          title={blocked}
          action={<Link to={paths.drawer.home.href}>Back</Link>}
        />
      ) : null}
      {queue && !blocked ? (
        <Alert
          type="warning"
          showIcon
          title={
            online
              ? "Entries on this computer are still waiting to be sent."
              : "No connection to the server."
          }
          description={`The day will open on this computer now and be sent in order when there is a connection. Your count is compared with this computer's own books${state?.asOf ? ` (the server's figures from ${ageLabel(new Date(state.asOf).getTime())}, plus everything made here since)` : ""}.`}
        />
      ) : null}

      {afterClose ? (
        <Card className="space-y-3 border-amber-500/60">
          <p className="text-sm font-medium">
            Today was already closed. The closed count stays exactly as it was.
          </p>
          <p className="text-sm text-muted-foreground">
            Open it again only for a customer who must be served now. The drawer
            starts from the closing books
            {books ? ` (${cedis(lineTotal(books))})` : ""}, you count it again
            when you close, and the manager is told.
          </p>
          <Input.TextArea
            rows={3}
            maxLength={500}
            placeholder="Why is the day opened again? (required)"
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            status={explanation.trim().length >= 5 ? undefined : "warning"}
          />
        </Card>
      ) : null}

      {afterClose ? null : first ? (
        <Alert
          type="info"
          showIcon
          title="This is the first day for this branch. What you count now becomes the starting balance."
        />
      ) : books && !blind ? (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 text-sm">
            <div className="text-xs uppercase text-muted-foreground">
              {queue
                ? "This computer's books say the drawer holds"
                : "The books say the drawer holds"}
            </div>
            <div className="tnum text-2xl font-bold">
              {cedis(lineTotal(books))}
            </div>
            <div className="tnum text-xs text-muted-foreground">
              {linesText(books)}
            </div>
          </div>
          <Button
            variant="secondary"
            onClick={() => setLines({ ...books })}
            disabled={!!blocked}
          >
            It is all there
          </Button>
        </Card>
      ) : null}

      {afterClose ? null : (
        <h2 className="text-sm font-semibold">
          Count the notes you really have
        </h2>
      )}
      {afterClose ? null : (
        <NoteCountInput
          value={lines}
          onChange={setLines}
          disabled={!!blocked}
          expected={blind ? undefined : (books ?? undefined)}
        />
      )}

      {differs &&
      (!view.loose || diffAmount !== 0) &&
      !afterClose &&
      (!blind || revealed) ? (
        <Card className="space-y-3 border-amber-500/60">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium">
              {blind
                ? "Your count does not match the books"
                : diffAmount === 0
                  ? "Same value, different notes"
                  : diffAmount < 0
                    ? "Your count is short by"
                    : "Your count is over by"}
            </span>
            <strong
              className={`tnum text-xl ${diffAmount < 0 ? "text-red-600" : ""}`}
            >
              {blind || diffAmount === 0 ? "" : cedis(Math.abs(diffAmount))}
            </strong>
          </div>
          <Input.TextArea
            rows={3}
            maxLength={500}
            placeholder="Explain why the count differs from the books (required)"
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            status={explanation.trim().length >= 5 ? undefined : "warning"}
          />
          <p className="text-xs text-muted-foreground">
            The day still opens. The books are corrected to your count and the
            manager can see why.
          </p>
        </Card>
      ) : null}

      {open.error?.code === "EXPLANATION_REQUIRED" ? (
        <Alert type="warning" showIcon title={open.error.message} />
      ) : null}

      <div className="sticky bottom-0 -mx-4 border-t border-border bg-background/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur">
        <Button
          className="w-full"
          onClick={submit}
          disabled={!canSave}
          loading={busy}
        >
          {afterClose
            ? "Open the day again"
            : `Open the day with ${cedis(lineTotal(lines))}`}
        </Button>
        {afterClose ? null : (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            {queue
              ? "Saved on this computer and sent later. The server checks your count against its books when it arrives."
              : "Your count is checked against the books."}
          </p>
        )}
      </div>
    </div>
  );
}
