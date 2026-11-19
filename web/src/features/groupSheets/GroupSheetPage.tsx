import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Input, Modal, Segmented, Switch } from "antd";
import {
  ArrowLeftIcon,
  CloudOffIcon,
  MinusIcon,
  PlusIcon,
  Undo2Icon,
} from "lucide-react";
import paths from "@/config/paths";
import { useAuth } from "@/features/auth/store";
import { errorMessage } from "@/shared/api/errors";
import { useConnectivity } from "@/shared/offline/connectivity";
import { Chip } from "@/shared/ui/Chip";
import {
  gsApi,
  useGsMutation,
  useGsSheet,
  type Entry,
  type SheetDetail,
} from "./api";
import { useGsOutbox, type Pending } from "./local";
import { cleanAmount, money, signed, withPending, type DayView } from "./model";

const dayLabel = (d: string, today: string) => {
  if (d === today) return "Today";
  const y = new Date(`${today}T12:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  if (d === y.toISOString().slice(0, 10)) return "Yesterday";
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: d.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric",
  });
};
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
const shortWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** One sheet: the balance, how it moved, and every entry day by day. Writers add or take out; nobody edits; mistakes are taken back. */
export default function GroupSheetPage() {
  const { id = "" } = useParams();
  const myId = useAuth((s) => s.user?.id ?? "");
  const myName = useAuth((s) => s.user?.displayName ?? "Me");
  const online = useConnectivity((s) => s.online);
  const [from, setFrom] = useState<string>();
  const q = useGsSheet(id, from);
  const pending = useGsOutbox((s) => s.items);
  const [adding, setAdding] = useState<"in" | "out" | null>(null);
  const [onlyOut, setOnlyOut] = useState(false);
  const s = q.data;

  const view = useMemo(
    () =>
      s ? withPending(s, pending, { id: myId, displayName: myName }) : null,
    [s, pending, myId, myName],
  );
  const canWrite = !!s && s.access === "write" && !s.closed;

  if (q.error && !s) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-4">
        <Link
          to={paths.groupSheets.href}
          className="inline-flex items-center gap-1 text-sm font-semibold text-brand"
        >
          <ArrowLeftIcon className="size-4" aria-hidden />
          Group Sheets
        </Link>
        <p
          role="alert"
          className="rounded-xl border border-border bg-card p-4 text-sm"
        >
          {(q.error as { status?: number }).status === 404
            ? "This sheet does not exist, or you can no longer see it."
            : errorMessage(q.error)}
        </p>
      </div>
    );
  }

  const older = () => {
    if (!s) return;
    const d = new Date(`${s.from}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 60);
    setFrom(d.toISOString().slice(0, 10));
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-3 pb-10 sm:p-4 lg:p-6">
      <Link
        to={paths.groupSheets.href}
        className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-brand"
      >
        <ArrowLeftIcon className="size-4" aria-hidden />
        Group Sheets
      </Link>

      {!s ? (
        <div className="h-48 animate-pulse rounded-2xl bg-muted" />
      ) : (
        <>
          <header className="rounded-2xl bg-navy p-5 text-white sm:p-6">
            <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
              <div className="min-w-0 flex-1">
                <h1 className="font-display text-2xl font-semibold">
                  {s.name}
                </h1>
                <p className="text-sm text-white/70">
                  {[s.groupName, s.branchName].filter(Boolean).join(" · ")}
                  {s.access === "read" ? " · you can look, not write" : ""}
                </p>
              </div>
              {s.closed ? (
                <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold">
                  Closed
                </span>
              ) : null}
            </div>
            <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-xs text-white/60">
                  Balance{view?.waiting ? " on this device" : ""}
                </div>
                <div
                  className={`tnum font-display text-4xl font-semibold sm:text-5xl ${Number(view?.balance) < 0 ? "text-red-300" : "text-gold"}`}
                >
                  {money(view?.balance ?? s.balance)}
                </div>
                {view?.waiting ? (
                  <div className="mt-1 text-xs text-sky-200">
                    {view.waiting} entr{view.waiting === 1 ? "y" : "ies"}{" "}
                    waiting to send
                  </div>
                ) : null}
              </div>
              {canWrite ? (
                <div className="flex w-full gap-2 sm:w-auto">
                  <button
                    type="button"
                    onClick={() => setAdding("in")}
                    className="inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-lg bg-gold px-5 text-sm font-semibold text-navy sm:flex-none"
                  >
                    <PlusIcon className="size-4" aria-hidden />
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdding("out")}
                    className="inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/30 px-5 text-sm font-semibold text-white hover:bg-white/10 sm:flex-none"
                  >
                    <MinusIcon className="size-4" aria-hidden />
                    Take out
                  </button>
                </div>
              ) : null}
            </div>
            <dl className="tnum mt-5 grid grid-cols-3 gap-2 border-t border-white/15 pt-4 text-sm">
              {[
                ["Today", { in: s.todayIn, out: s.todayOut }],
                ["Last 7 days", s.week],
                ["This month", s.month],
              ].map(([label, f]) => {
                const v = f as { in: string; out: string };
                return (
                  <div key={label as string}>
                    <dt className="text-xs text-white/60">{label as string}</dt>
                    <dd>
                      <span className="text-emerald-300">
                        +{Number(v.in).toLocaleString("en-GH")}
                      </span>{" "}
                      <span className="text-white/40">/</span>{" "}
                      <span className="text-red-300">
                        −{Number(v.out).toLocaleString("en-GH")}
                      </span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </header>

          {!online ? (
            <p className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <CloudOffIcon className="size-4 shrink-0" aria-hidden />
              No connection: this is the sheet as this device last saw it.
              Entries you add are kept here and sent later.
            </p>
          ) : null}
          {s.closed ? (
            <p className="rounded-xl border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
              This sheet is closed
              {s.closedAt ? ` since ${shortWhen(s.closedAt)}` : ""}. It stays
              readable and takes no new entries. A keeper can reopen it.
            </p>
          ) : null}

          <Problems
            pending={pending.filter((p) => p.sheetId === s.id && p.problem)}
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Entries</h2>
            <Segmented
              value={onlyOut ? "out" : "all"}
              onChange={(v) => setOnlyOut(v === "out")}
              options={[
                { label: "All", value: "all" },
                { label: "Only takings out", value: "out" },
              ]}
            />
          </div>

          {view && view.days.length ? (
            <ol className="space-y-3">
              {view.days.map((d) => (
                <Day key={d.date} day={d} sheet={s} onlyOut={onlyOut} />
              ))}
            </ol>
          ) : (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No entries {s.olderEntries ? "in this period" : "yet"}.
              {canWrite
                ? " Use Add when money comes in, Take out when some is used."
                : ""}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              From {dayLabel(s.from, s.today)}: {money(s.balanceBefore)} brought
              forward
              {Number(s.openingBalance) !== 0
                ? ` (opening balance ${money(s.openingBalance)}${s.openingDate ? ` on ${s.openingDate}` : ""})`
                : ""}
              .
            </span>
            {s.olderEntries ? (
              <button
                type="button"
                onClick={older}
                className="min-h-10 rounded-lg border border-border px-3 font-semibold text-foreground hover:bg-muted"
              >
                Show older entries
              </button>
            ) : null}
          </div>

          {adding ? (
            <EntryModal
              sheet={s}
              balance={view?.balance ?? s.balance}
              direction={adding}
              onClose={() => setAdding(null)}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function Day({
  day,
  sheet,
  onlyOut,
}: {
  day: DayView;
  sheet: SheetDetail;
  onlyOut: boolean;
}) {
  const entries = onlyOut
    ? day.entries.filter((e) => Number(e.amount) < 0 && !e.takesBack)
    : day.entries;
  if (!entries.length) return null;
  return (
    <li className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="tnum flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-border bg-muted/40 px-4 py-2 text-sm">
        <span className="font-semibold">{dayLabel(day.date, sheet.today)}</span>
        <span className="text-emerald-700 dark:text-emerald-400">
          +{Number(day.in).toLocaleString("en-GH")}
        </span>
        <span className="text-red-700 dark:text-red-400">
          −{Number(day.out).toLocaleString("en-GH")}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          closing <b className="text-foreground">{money(day.closing)}</b>
        </span>
      </div>
      <ul className="divide-y divide-border">
        {entries.map((e) => (
          <Line key={e.id} entry={e} sheet={sheet} />
        ))}
      </ul>
    </li>
  );
}

function Line({
  entry: e,
  sheet,
}: {
  entry: Entry & { pending?: Pending };
  sheet: SheetDetail;
}) {
  const takeBack = useGsMutation(
    (x: Entry) => gsApi.takeBack(x.id, crypto.randomUUID()),
    "Taken back",
  );
  const out = Number(e.amount) < 0;
  const struck = !!e.takenBack || !!e.takesBack;
  const late = e.moneyDate !== e.writtenAt.slice(0, 10) && !e.pending;
  const mayTakeBack =
    !e.pending &&
    !struck &&
    sheet.access === "write" &&
    !sheet.closed &&
    (e.mine || sheet.myRole === "keeper");
  return (
    <li
      className={`flex items-start gap-3 px-4 py-3 ${e.pending ? "bg-sky-50/60 dark:bg-sky-950/20" : ""}`}
    >
      <span
        className={`tnum w-24 shrink-0 text-right font-semibold ${struck ? "text-muted-foreground line-through" : out ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}
      >
        {signed(e.amount)}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm ${struck ? "text-muted-foreground line-through" : ""}`}
        >
          {e.note ||
            (e.takesBack ? (
              "Taken back"
            ) : (
              <span className="text-muted-foreground">
                {out ? "Taken out" : "Added"}
              </span>
            ))}
          {e.dayTotal ? (
            <span className="ml-2 align-middle">
              <Chip tone="green">Day total</Chip>
            </span>
          ) : null}
        </p>
        <p className="text-xs text-muted-foreground">
          {e.writtenBy.displayName} · {time(e.writtenAt)}
          {late ? ` · written ${shortWhen(e.writtenAt)}` : ""}
        </p>
        {e.takenBack ? (
          <p className="text-xs text-muted-foreground">
            Taken back by {e.takenBack.by.displayName},{" "}
            {shortWhen(e.takenBack.at)}
          </p>
        ) : null}
        <div className="mt-1 flex flex-wrap gap-1.5">
          {e.pending ? <Chip tone="sky">Waiting to send</Chip> : null}
          {e.afterRemoval ? (
            <Chip tone="amber">Sent after the writer lost access</Chip>
          ) : null}
        </div>
      </div>
      {mayTakeBack ? (
        <button
          type="button"
          title="Take back this entry"
          aria-label={`Take back ${signed(e.amount)}`}
          disabled={takeBack.isPending}
          onClick={() =>
            Modal.confirm({
              title: `Take back ${signed(e.amount)}?`,
              content:
                "An opposite entry is added and both are shown struck through. Nothing is deleted. Then write the correct entry, if there is one.",
              okText: "Take back",
              okButtonProps: { danger: true },
              onOk: () => takeBack.mutateAsync(e),
            })
          }
          className="grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Undo2Icon className="size-4" aria-hidden />
        </button>
      ) : null}
    </li>
  );
}

function Problems({ pending }: { pending: Pending[] }) {
  if (!pending.length) return null;
  return (
    <section className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">
      <p className="font-semibold">Not accepted by the server</p>
      {pending.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center gap-2">
          <span className="tnum font-semibold">
            {p.direction === "out" ? "−" : "+"}
            {p.amount}
          </span>
          <span className="min-w-0 flex-1">
            {p.note ? `${p.note}: ` : ""}
            {p.problem}
          </span>
          <button
            type="button"
            onClick={() => useGsOutbox.getState().discard(p.id)}
            className="min-h-9 rounded-lg border border-red-300 px-3 text-xs font-semibold hover:bg-red-100"
          >
            Remove from this device
          </button>
        </div>
      ))}
    </section>
  );
}

function EntryModal({
  sheet,
  balance,
  direction: start,
  onClose,
}: {
  sheet: SheetDetail;
  balance: string;
  direction: "in" | "out";
  onClose: () => void;
}) {
  const [direction, setDirection] = useState(start);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(sheet.today);
  const [dayTotal, setDayTotal] = useState(false);
  const clean = cleanAmount(amount);
  const after = clean
    ? Number(balance) + (direction === "out" ? -1 : 1) * Number(clean)
    : null;

  const save = () => {
    if (!clean) return;
    useGsOutbox.getState().add({
      id: crypto.randomUUID(),
      sheetId: sheet.id,
      direction,
      amount: clean,
      note: note.trim() || undefined,
      moneyDate: date,
      dayTotal: direction === "in" && dayTotal,
      writtenAt: new Date().toISOString(),
    });
    onClose();
  };

  return (
    <Modal
      open
      title={sheet.name}
      okText={direction === "in" ? "Add" : "Take out"}
      okButtonProps={{ disabled: !clean || !date }}
      onOk={save}
      onCancel={onClose}
      destroyOnHidden
    >
      <div className="space-y-4">
        <Segmented
          block
          size="large"
          value={direction}
          onChange={(v) => setDirection(v as "in" | "out")}
          options={[
            { label: "+ Add", value: "in" },
            { label: "− Take out", value: "out" },
          ]}
        />
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Amount (GHS)</span>
          <Input
            autoFocus
            size="large"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onPressEnter={save}
            status={amount && !clean ? "error" : undefined}
            className="tnum"
          />
          {amount && !clean ? (
            <span className="mt-1 block text-xs text-red-700">
              Type an amount like 150 or 12.50.
            </span>
          ) : null}
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            Note{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </span>
          <Input
            size="large"
            maxLength={140}
            showCount
            placeholder={
              direction === "in"
                ? "For example: Ama paid, week 47"
                : "For example: gas refill"
            }
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap items-end gap-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">
              Date the money moved
            </span>
            <input
              type="date"
              value={date}
              max={sheet.today}
              onChange={(e) => setDate(e.target.value)}
              className="min-h-10 rounded-lg border border-border bg-background px-3 text-sm"
            />
          </label>
          {direction === "in" ? (
            <label className="flex min-h-10 items-center gap-2 text-sm">
              <Switch checked={dayTotal} onChange={setDayTotal} />
              Day total
            </label>
          ) : null}
        </div>
        {direction === "in" && dayTotal ? (
          <p className="text-xs text-muted-foreground">
            One figure for everything collected that day, instead of each
            payment.
          </p>
        ) : null}
        {after !== null ? (
          <p
            className={`tnum rounded-lg p-2.5 text-sm ${after < 0 ? "bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300" : "bg-muted/60"}`}
          >
            The balance will be <b>{money(after)}</b>
            {after < 0
              ? ". That is below zero: check the amount, or save it if that is what happened."
              : "."}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
