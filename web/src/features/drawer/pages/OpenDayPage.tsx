import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Input } from "antd";
import { lineTotal, subtractLines, type Lines } from "@gold/core";
import paths from "@/config/paths";
import { useAuth } from "@/features/auth/store";
import { cedis } from "@/features/calculator/format";
import { useApiMutation } from "@/shared/api/hooks";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { dayKeys, daysApi } from "../api";
import { linesText } from "../format";
import { useActiveDrawer } from "../hooks";
import { NoteCountInput } from "../NoteCountInput";
import { localDate } from "../projection";

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
  // One id per form: pressing the button twice, or retrying after a lost answer, can only open one day.
  const [commandId] = useState(() => crypto.randomUUID());
  const today = localDate();

  const open = useApiMutation({
    mutationFn: daysApi.open,
    invalidates: [dayKeys.all],
    successMessage: "Day opened",
    onSuccess: () => navigate(paths.drawer.home.href, { replace: true }),
  });

  const blocked =
    view.status === "open"
      ? "A day is already open for this branch."
      : view.status === "closed" && view.businessDate === today
        ? "Today was already opened and closed. The next day can be opened tomorrow."
        : null;

  // What the books say the drawer holds. null before the branch's very first day (the count then sets the starting balance).
  const books = state?.carryOver ?? null;
  const first = state !== null && books === null;
  const hasCount = Object.keys(lines).length > 0;
  const differs = books !== null && hasCount && !same(lines, books);
  const diffAmount = books ? lineTotal(lines) - lineTotal(books) : 0;
  const needsReason = differs;
  const canSave =
    !!branchId &&
    hasCount &&
    !blocked &&
    !open.isPending &&
    (!needsReason || explanation.trim().length >= 5);

  function submit() {
    if (!canSave || !branchId) return;
    open.mutate({
      id: commandId,
      branchId,
      businessDate: today,
      lines,
      source: books && same(lines, books) ? "carried" : "counted",
      capturedAt: new Date().toISOString(),
      explanation: needsReason ? explanation.trim() : null,
    });
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

      {first ? (
        <Alert
          type="info"
          showIcon
          title="This is the first day for this branch. What you count now becomes the starting balance."
        />
      ) : books ? (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 text-sm">
            <div className="text-xs uppercase text-muted-foreground">
              The books say the drawer holds
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

      <h2 className="text-sm font-semibold">Count the notes you really have</h2>
      <NoteCountInput
        value={lines}
        onChange={setLines}
        disabled={!!blocked}
        expected={books ?? undefined}
      />

      {differs ? (
        <Card className="space-y-3 border-amber-500/60">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium">
              {diffAmount === 0
                ? "Same value, different notes"
                : diffAmount < 0
                  ? "Your count is short by"
                  : "Your count is over by"}
            </span>
            <strong
              className={`tnum text-xl ${diffAmount < 0 ? "text-red-600" : ""}`}
            >
              {diffAmount === 0 ? "" : cedis(Math.abs(diffAmount))}
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
          loading={open.isPending}
        >
          Open the day with {cedis(lineTotal(lines))}
        </Button>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Opening needs a connection, because your count is checked against the
          books.
        </p>
      </div>
    </div>
  );
}
