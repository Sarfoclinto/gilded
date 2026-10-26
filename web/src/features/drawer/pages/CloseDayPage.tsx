import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Checkbox, Input, Modal } from "antd";
import { lineTotal, type Lines } from "@gold/core";
import paths from "@/config/paths";
import { useAuth } from "@/features/auth/store";
import { cedis } from "@/features/calculator/format";
import { useApiMutation } from "@/shared/api/hooks";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { decimalOnly } from "@/shared/lib/numbers";
import { dayKeys, daysApi } from "../api";
import {
  checkFigures,
  closingProblems,
  figureLabel,
  figureUnit,
  type Declared,
} from "../closing";
import { linesText } from "../format";
import { useActiveDrawer, useClosingPreview, useDayActivity } from "../hooks";
import { DayActivityPanel } from "../DayActivityPanel";
import { NoteCountInput } from "../NoteCountInput";
import type { Figure } from "../schemas";

const unitText = (f: Figure, v: string) =>
  figureUnit[f] === "g" ? `${v} g` : cedis(Number(v));

export default function CloseDayPage() {
  const navigate = useNavigate();
  const branchId = useAuth((s) => s.activeBranchId);
  const { view } = useActiveDrawer();
  const dayId = view.status === "open" ? view.dayId : null;
  const previewQuery = useClosingPreview(dayId);
  const preview = previewQuery.data ?? null;
  const [summaryOpen, setSummaryOpen] = useState(false);
  const activityQuery = useDayActivity(summaryOpen ? dayId : null);

  const [cash, setCash] = useState<Lines>({});
  const [text, setText] = useState({
    goodsTop: "",
    goodsDown: "",
    goodsValue: "",
    debt: "",
    payable: "",
    custodyTop: "",
  });
  const [why, setWhy] = useState<Partial<Record<Figure, string>>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [commandId] = useState(() => crypto.randomUUID());

  const close = useApiMutation({
    mutationFn: daysApi.close,
    invalidates: [dayKeys.all],
    onSuccess: (day) => {
      const s = day.closing?.signoff.status;
      navigate(paths.drawer.home.href, { replace: true, state: { closed: s } });
    },
    successMessage: "Day closed",
  });

  const declared: Declared = { cash, ...text };
  const checks = useMemo(
    () => (preview ? checkFigures(preview, declared) : []),
    [preview, cash, text],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const problems = preview ? closingProblems(checks, why, confirmed) : [];
  const outdated = close.error?.code === "CONFIRMATION_OUTDATED";

  if (view.status !== "open" || !dayId) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <h1 className="text-xl font-bold">Close the day</h1>
        <Alert
          type="info"
          showIcon
          title="There is no open day to close."
          action={<Link to={paths.drawer.home.href}>Back</Link>}
        />
      </div>
    );
  }

  function submit() {
    if (!preview || !branchId || !dayId || problems.length) return;
    const explanations: Partial<Record<Figure, string>> = {};
    for (const c of checks)
      if (c.needsReason) explanations[c.figure] = (why[c.figure] ?? "").trim();
    close.mutate({
      id: commandId,
      dayId,
      branchId,
      declared: {
        cash,
        goodsTop: text.goodsTop.trim(),
        goodsDown: text.goodsDown.trim(),
        goodsValue: text.goodsValue.trim(),
        debt: text.debt.trim(),
        payable: text.payable.trim(),
        custodyTop: text.custodyTop.trim(),
      },
      explanations,
      confirmation: { accepted: true, version: preview.confirmation.version },
      capturedAt: new Date().toISOString(),
    });
  }

  const field = (key: keyof typeof text, f: Figure) => {
    const c = checks.find((x) => x.figure === f);
    return (
      <Card key={f} className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <label className="font-medium" htmlFor={`fig-${f}`}>
            {figureLabel[f]}
          </label>
          <span className="tnum text-xs text-muted-foreground">
            Books: {preview ? unitText(f, c?.expected ?? "0") : "…"}
          </span>
        </div>
        <Input
          id={`fig-${f}`}
          size="large"
          inputMode="decimal"
          suffix={figureUnit[f] === "g" ? "g" : "GHS"}
          placeholder="0"
          value={text[key]}
          onChange={(e) =>
            setText((t) => ({ ...t, [key]: decimalOnly(e.target.value) }))
          }
          status={c?.invalid && text[key] !== "" ? "error" : undefined}
        />
        {explainBox(f)}
      </Card>
    );
  };

  function explainBox(f: Figure) {
    const c = checks.find((x) => x.figure === f);
    if (!c || c.invalid || !c.needsReason) return null;
    return (
      <div className="space-y-1">
        <p className="tnum text-sm font-medium text-amber-700 dark:text-amber-300">
          {c.valueDiffers
            ? `${c.difference > 0 ? "Over" : "Short"} by ${unitText(f, String(Math.abs(c.difference)))}`
            : "Same value, different notes"}
        </p>
        <Input.TextArea
          rows={2}
          maxLength={500}
          placeholder="Why does it differ? (required)"
          value={why[f] ?? ""}
          onChange={(e) => setWhy((w) => ({ ...w, [f]: e.target.value }))}
          status={(why[f]?.trim().length ?? 0) >= 5 ? undefined : "warning"}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-8">
      <h1 className="text-xl font-bold">Close the day · {view.businessDate}</h1>
      <p className="text-sm text-muted-foreground">
        Count everything the branch really holds and enter it below. If a figure
        differs from the books, say why. Nothing is overwritten: the books and
        your figures are both kept.
      </p>

      <Button
        variant="secondary"
        className="w-full"
        onClick={() => setSummaryOpen(true)}
      >
        Day summary · this day only
      </Button>
      <Modal
        title={`This day only · ${view.businessDate}`}
        open={summaryOpen}
        onCancel={() => setSummaryOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <p className="mb-3 text-xs text-muted-foreground">
          Today's movements only. The closing count below is still checked
          against the books since the beginning.
        </p>
        {activityQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">
            Loading today's figures…
          </p>
        ) : null}
        {activityQuery.error ? (
          <Alert
            type="error"
            showIcon
            title="Could not load today's figures. This needs a connection."
          />
        ) : null}
        {activityQuery.data ? (
          <DayActivityPanel activity={activityQuery.data} />
        ) : null}
      </Modal>

      {previewQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">
          Loading what the books hold…
        </p>
      ) : null}
      {previewQuery.error ? (
        <Alert
          type="error"
          showIcon
          title="Could not load the books. Closing needs a connection."
        />
      ) : null}
      {view.pendingCount > 0 ? (
        <Alert
          type="warning"
          showIcon
          title="Some changes on this device are not sent yet. Wait for them to sync before closing, so the books are complete."
        />
      ) : null}
      {preview && preview.pendingPayments > 0 ? (
        <Alert
          type="warning"
          showIcon
          title={`${preview.pendingPayments} mobile money part${preview.pendingPayments > 1 ? "s are" : " is"} still waiting for confirmation.`}
          description="They are not counted in the books yet. You can still close, or confirm them first."
          action={<Link to={paths.payments.href}>Open</Link>}
        />
      ) : null}

      {preview ? (
        <>
          <Card className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="font-medium">{figureLabel.cash}</span>
              <span className="tnum text-xs text-muted-foreground">
                Books: {cedis(Number(preview.expected.cash.value))} ·{" "}
                {linesText(preview.expected.cash.lines)}
              </span>
            </div>
            <NoteCountInput
              value={cash}
              onChange={setCash}
              expected={preview.expected.cash.lines}
            />
            {explainBox("cash")}
            {Object.keys(cash).length === 0 ? (
              <p className="text-xs text-muted-foreground">
                If the drawer is empty, leave all notes at 0.
              </p>
            ) : null}
          </Card>
          {field("goodsTop", "goods_top")}
          {field("goodsDown", "goods_down")}
          {field("goodsValue", "goods_value")}
          {field("debt", "debt")}
          {field("payable", "payable")}
          {field("custodyTop", "custody_top")}

          <Card className="space-y-3 border-primary/40">
            <Checkbox
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            >
              <span className="text-sm">{preview.confirmation.text}</span>
            </Checkbox>
          </Card>

          {outdated ? (
            <Alert
              type="warning"
              showIcon
              title="The confirmation wording was updated. Read it again and tick it."
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    close.reset();
                    void previewQuery.refetch();
                    setConfirmed(false);
                  }}
                >
                  Reload wording
                </Button>
              }
            />
          ) : null}
          {close.error && !outdated ? (
            <Alert type="error" showIcon title={close.error.message} />
          ) : null}
          {problems.length &&
          Object.keys(cash).length +
            Object.values(text).filter(Boolean).length >
            0 ? (
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}

          <div className="sticky bottom-0 -mx-4 border-t border-border bg-background/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur">
            <Button
              className="w-full"
              onClick={submit}
              disabled={problems.length > 0 || close.isPending}
              loading={close.isPending}
            >
              Close the day · cash {cedis(lineTotal(cash))}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
