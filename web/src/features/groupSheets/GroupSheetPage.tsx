import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Input, Modal, Segmented, Select, Switch } from "antd";
import {
  ArrowLeftIcon,
  BellIcon,
  BellRingIcon,
  CloudOffIcon,
  DownloadIcon,
  MinusIcon,
  PencilLineIcon,
  PlusIcon,
  PrinterIcon,
  Undo2Icon,
  UserPlusIcon,
} from "lucide-react";
import paths from "@/config/paths";
import { useAuth } from "@/features/auth/store";
import { useColleagues } from "@/features/personal/api";
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
import { EntryModal } from "./EntryForm";
import { EntryPhotos } from "./EntryPhotos";
import { useGsOutbox, type Pending } from "./local";
import {
  money,
  qty,
  sheetCsv,
  signed,
  withPending,
  type DayView,
} from "./model";

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
const kindLabel = (s: SheetDetail) =>
  s.kind === "people"
    ? "Savings per person"
    : s.kind === "quantity"
      ? `Money and ${s.unit ?? "quantity"}`
      : null;

/**
 * One sheet: the balance, how it moved, and every entry day by day. Writers add or take out; nobody edits; mistakes are taken back.
 * Savings sheets show each person's balance and a statement per person; quantity sheets show what is in hand as well as the cash.
 */
export default function GroupSheetPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const personId = params.get("person") ?? undefined;
  const myId = useAuth((s) => s.user?.id ?? "");
  const myName = useAuth((s) => s.user?.displayName ?? "Me");
  const online = useConnectivity((s) => s.online);
  const [from, setFrom] = useState<string>();
  const q = useGsSheet(id, from, personId);
  const pending = useGsOutbox((s) => s.items);
  const [adding, setAdding] = useState<"in" | "out" | null>(null);
  const [onlyOut, setOnlyOut] = useState(false);
  const [alerting, setAlerting] = useState(false);
  const s = q.data;

  const view = useMemo(
    () =>
      s ? withPending(s, pending, { id: myId, displayName: myName }) : null,
    [s, pending, myId, myName],
  );
  const canWrite = !!s && s.access === "write" && !s.closed;
  const person = personId
    ? s?.people?.find((p) => p.id === personId)
    : undefined;

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
  const download = () => {
    if (!s || !view) return;
    const blob = new Blob(["﻿" + sheetCsv(s, view.days)], {
      type: "text/csv;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download =
      `${s.name}${person ? ` - ${person.name}` : ""} ${s.from} to ${s.today}.csv`.replace(
        /[\\/:*?"<>|]/g,
        "-",
      );
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const showPerson = (pid?: string) => {
    setFrom(undefined);
    setParams(pid ? { person: pid } : {}, { replace: true });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-3 pb-10 sm:p-4 lg:p-6">
      <Link
        to={paths.groupSheets.href}
        className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-brand print:hidden"
      >
        <ArrowLeftIcon className="size-4" aria-hidden />
        Group Sheets
      </Link>

      {!s ? (
        <div className="h-48 animate-pulse rounded-2xl bg-muted" />
      ) : (
        <>
          <header className="rounded-2xl bg-navy p-5 text-white sm:p-6 print:border print:border-black print:bg-white print:text-black">
            <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
              <div className="min-w-0 flex-1">
                <h1 className="font-display text-2xl font-semibold">
                  {s.name}
                  {person ? (
                    <span className="text-white/70 print:text-black">
                      {" "}
                      · {person.name}
                    </span>
                  ) : null}
                </h1>
                <p className="text-sm text-white/70 print:text-black">
                  {[s.groupName, s.branchName, kindLabel(s)]
                    .filter(Boolean)
                    .join(" · ")}
                  {s.access === "read" ? " · you can look, not write" : ""}
                </p>
              </div>
              {s.closed ? (
                <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold">
                  Closed
                </span>
              ) : null}
              <div className="flex gap-1 print:hidden">
                <button
                  type="button"
                  onClick={() => setAlerting(true)}
                  title={
                    s.alert
                      ? "You are told when money is taken out"
                      : "Tell me when money is taken out"
                  }
                  aria-label="Alerts"
                  className={`grid size-10 place-items-center rounded-lg hover:bg-white/10 ${s.alert ? "text-gold" : "text-white/70"}`}
                >
                  {s.alert ? (
                    <BellRingIcon className="size-5" aria-hidden />
                  ) : (
                    <BellIcon className="size-5" aria-hidden />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  title="Print"
                  aria-label="Print"
                  className="grid size-10 place-items-center rounded-lg text-white/70 hover:bg-white/10"
                >
                  <PrinterIcon className="size-5" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={download}
                  title="Download as a spreadsheet (CSV)"
                  aria-label="Download as CSV"
                  className="grid size-10 place-items-center rounded-lg text-white/70 hover:bg-white/10"
                >
                  <DownloadIcon className="size-5" aria-hidden />
                </button>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                <div>
                  <div className="text-xs text-white/60 print:text-black">
                    {person
                      ? `${person.name}'s savings`
                      : s.kind === "people"
                        ? "Total savings"
                        : "Balance"}
                    {view?.waiting ? " on this device" : ""}
                  </div>
                  <div
                    className={`tnum font-display text-4xl font-semibold sm:text-5xl ${Number(person ? (view?.days[0]?.closing ?? person.balance) : view?.balance) < 0 ? "text-red-300" : "text-gold"} print:text-black`}
                  >
                    {money(
                      person
                        ? (view?.days[0]?.closing ?? person.balance)
                        : (view?.balance ?? s.balance),
                    )}
                  </div>
                </div>
                {s.kind === "quantity" ? (
                  <div>
                    <div className="text-xs text-white/60 print:text-black">
                      In hand
                    </div>
                    <div
                      className={`tnum font-display text-3xl font-semibold ${Number(view?.stock) < 0 ? "text-red-300" : "text-white"} print:text-black`}
                    >
                      {qty(view?.stock ?? s.stock, s.unit)}
                    </div>
                  </div>
                ) : null}
              </div>
              {canWrite ? (
                <div className="flex w-full gap-2 sm:w-auto print:hidden">
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
            {view?.waiting ? (
              <div className="mt-1 text-xs text-sky-200 print:hidden">
                {view.waiting} entr{view.waiting === 1 ? "y" : "ies"} waiting to
                send
              </div>
            ) : null}
            {!person ? (
              <dl className="tnum mt-5 grid grid-cols-3 gap-2 border-t border-white/15 pt-4 text-sm print:border-black">
                {(
                  [
                    ["Today", { in: s.todayIn, out: s.todayOut }],
                    ["Last 7 days", s.week],
                    ["This month", s.month],
                  ] as const
                ).map(([label, v]) => (
                  <div key={label}>
                    <dt className="text-xs text-white/60 print:text-black">
                      {label}
                    </dt>
                    <dd>
                      <span className="text-emerald-300 print:text-black">
                        +{Number(v.in).toLocaleString("en-GH")}
                      </span>{" "}
                      <span className="text-white/40">/</span>{" "}
                      <span className="text-red-300 print:text-black">
                        −{Number(v.out).toLocaleString("en-GH")}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </header>

          {!online ? (
            <p className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 print:hidden">
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

          {s.kind === "people" ? (
            <People sheet={s} active={personId} onPick={showPerson} />
          ) : null}

          <Problems
            pending={pending.filter((p) => p.sheetId === s.id && p.problem)}
          />

          <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
            <h2 className="text-base font-semibold">
              {person ? `${person.name}'s entries` : "Entries"}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                From
                <input
                  type="date"
                  value={s.from}
                  max={s.today}
                  onChange={(e) => e.target.value && setFrom(e.target.value)}
                  className="min-h-9 rounded-lg border border-border bg-background px-2 text-sm text-foreground"
                />
              </label>
              <Segmented
                value={onlyOut ? "out" : "all"}
                onChange={(v) => setOnlyOut(v === "out")}
                options={[
                  { label: "All", value: "all" },
                  { label: "Only takings out", value: "out" },
                ]}
              />
            </div>
          </div>
          <p className="hidden text-sm print:block">
            From {s.from} to {s.today}. Printed{" "}
            {new Date().toLocaleString("en-GB")} by {myName}.
          </p>

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
              {s.kind === "quantity" && s.stockBefore != null
                ? `, ${qty(s.stockBefore, s.unit)} in hand`
                : ""}
              {!person && Number(s.openingBalance) !== 0
                ? ` (opening balance ${money(s.openingBalance)}${s.openingDate ? ` on ${s.openingDate}` : ""})`
                : ""}
              .
            </span>
            {s.olderEntries ? (
              <button
                type="button"
                onClick={older}
                className="min-h-10 rounded-lg border border-border px-3 font-semibold text-foreground hover:bg-muted print:hidden"
              >
                Show older entries
              </button>
            ) : null}
          </div>

          {adding ? (
            <EntryModal
              sheet={s}
              balance={view?.balance ?? s.balance}
              stock={view?.stock}
              direction={adding}
              personId={personId}
              onClose={() => setAdding(null)}
            />
          ) : null}
          {alerting ? (
            <AlertModal sheet={s} onClose={() => setAlerting(false)} />
          ) : null}
        </>
      )}
    </div>
  );
}

/** Savings sheets: everyone's balance at a glance; tapping a person shows their statement. Keepers add and rename people. */
function People({
  sheet: s,
  active,
  onPick,
}: {
  sheet: SheetDetail;
  active?: string;
  onPick: (id?: string) => void;
}) {
  const keeper = s.myRole === "keeper";
  const online = useConnectivity((st) => st.online);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [name, setName] = useState("");
  const [userId, setUserId] = useState<string>();
  const colleagues = useColleagues(adding);
  const add = useGsMutation(
    (b: { name?: string; userId?: string }) =>
      gsApi.addPerson(s.id, { id: crypto.randomUUID(), ...b }),
    "Added",
  );
  const rename = useGsMutation(
    (b: { id: string; name: string }) => gsApi.renamePerson(b.id, b.name),
    "Renamed",
  );
  const people = s.people ?? [];
  return (
    <section aria-label="People" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">People</h2>
        {keeper ? (
          <button
            type="button"
            disabled={!online}
            onClick={() => {
              setName("");
              setUserId(undefined);
              setAdding(true);
            }}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-brand hover:bg-muted disabled:opacity-50 print:hidden"
          >
            <UserPlusIcon className="size-4" aria-hidden />
            Add a person
          </button>
        ) : null}
      </div>
      {people.length ? (
        <ul className="grid gap-2 sm:grid-cols-2 print:hidden">
          <li className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onPick(undefined)}
              aria-pressed={!active}
              className={`flex min-h-[3.75rem] min-w-0 flex-1 items-center justify-between rounded-xl border px-3 py-2.5 text-left ${!active ? "border-gold bg-gold/10" : "border-border bg-card hover:bg-muted"}`}
            >
              <span className="font-semibold">Everyone</span>
              <span className="tnum text-sm font-semibold">
                {money(s.balance)}
              </span>
            </button>
            {keeper ? <span className="size-10 shrink-0" aria-hidden /> : null}
          </li>
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onPick(p.id)}
                aria-pressed={active === p.id}
                className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left ${active === p.id ? "border-gold bg-gold/10" : "border-border bg-card hover:bg-muted"}`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{p.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {p.entries} entr{p.entries === 1 ? "y" : "ies"}
                  </span>
                </span>
                <span
                  className={`tnum text-sm font-semibold ${Number(p.balance) < 0 ? "text-red-700" : ""}`}
                >
                  {money(p.balance)}
                </span>
              </button>
              {keeper ? (
                <button
                  type="button"
                  aria-label={`Rename ${p.name}`}
                  onClick={() => setRenaming({ id: p.id, name: p.name })}
                  className="grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
                >
                  <PencilLineIcon className="size-4" aria-hidden />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          {keeper
            ? "Add the people who save here, then writers can record each one's savings."
            : "No one on this sheet yet. A keeper adds people."}
        </p>
      )}
      <Modal
        open={adding}
        title="Add a person"
        okText="Add"
        confirmLoading={add.isPending}
        okButtonProps={{ disabled: !userId && !name.trim() }}
        onCancel={() => setAdding(false)}
        onOk={async () => {
          await add.mutateAsync(userId ? { userId } : { name: name.trim() });
          setAdding(false);
        }}
      >
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">
              Someone who uses the app
            </span>
            <Select
              allowClear
              showSearch
              size="large"
              className="w-full"
              placeholder="Choose a person"
              optionFilterProp="label"
              value={userId}
              onChange={(v) => {
                setUserId(v);
                if (v) setName("");
              }}
              loading={colleagues.isLoading}
              options={(colleagues.data ?? []).map((c) => ({
                value: c.id,
                label: c.displayName,
              }))}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">
              Or anyone, by name
            </span>
            <Input
              size="large"
              maxLength={80}
              placeholder="For example: Auntie Akos"
              value={name}
              disabled={!!userId}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Their savings start at zero. Bring an existing balance over as their
            first entry.
          </p>
        </div>
      </Modal>
      <Modal
        open={!!renaming}
        title="Rename"
        okText="Save"
        confirmLoading={rename.isPending}
        okButtonProps={{ disabled: !renaming?.name.trim() }}
        onCancel={() => setRenaming(null)}
        onOk={async () => {
          if (renaming)
            await rename.mutateAsync({
              id: renaming.id,
              name: renaming.name.trim(),
            });
          setRenaming(null);
        }}
      >
        <Input
          autoFocus
          size="large"
          maxLength={80}
          value={renaming?.name ?? ""}
          onChange={(e) =>
            setRenaming((r) => (r ? { ...r, name: e.target.value } : r))
          }
        />
      </Modal>
    </section>
  );
}

function AlertModal({
  sheet: s,
  onClose,
}: {
  sheet: SheetDetail;
  onClose: () => void;
}) {
  const [on, setOn] = useState(!!s.alert);
  const [min, setMin] = useState(
    s.alert && Number(s.alert.minAmount) > 0 ? s.alert.minAmount : "",
  );
  const set = useGsMutation(
    (v: { on: boolean; min?: string }) => gsApi.setAlert(s.id, v.on, v.min),
    (_d, v) => (v.on ? "You will be told" : "Alert switched off"),
  );
  const minOk =
    !min.trim() || /^\d{1,12}(\.\d{1,2})?$/.test(min.replace(/[,\s]/g, ""));
  return (
    <Modal
      open
      title="Alerts on this sheet"
      okText="Save"
      confirmLoading={set.isPending}
      okButtonProps={{ disabled: !minOk }}
      onCancel={onClose}
      onOk={async () => {
        await set.mutateAsync({
          on,
          min: min.trim() ? min.replace(/[,\s]/g, "") : undefined,
        });
        onClose();
      }}
    >
      <div className="space-y-3">
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={on} onChange={setOn} />
          Tell me when money is taken out of "{s.name}"
        </label>
        {on ? (
          <label className="block">
            <span className="mb-1 block text-sm font-medium">
              Only from this amount up (GHS){" "}
              <span className="font-normal text-muted-foreground">
                (empty for any amount)
              </span>
            </span>
            <Input
              size="large"
              inputMode="decimal"
              placeholder="Any amount"
              value={min}
              status={minOk ? undefined : "error"}
              onChange={(e) => setMin(e.target.value)}
            />
          </label>
        ) : null}
        <p className="text-xs text-muted-foreground">
          You get a notification in the app. Nobody else sees that you asked,
          and you are never told about your own entries.
        </p>
      </div>
    </Modal>
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
  const quantity = sheet.kind === "quantity";
  return (
    <li className="overflow-hidden rounded-2xl border border-border bg-card print:break-inside-avoid">
      <div className="tnum flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-border bg-muted/40 px-4 py-2 text-sm">
        <span className="font-semibold">{dayLabel(day.date, sheet.today)}</span>
        <span className="text-emerald-700 dark:text-emerald-400">
          +{Number(day.in).toLocaleString("en-GH")}
        </span>
        <span className="text-red-700 dark:text-red-400">
          −{Number(day.out).toLocaleString("en-GH")}
        </span>
        {quantity && (Number(day.qtyIn) || Number(day.qtyOut)) ? (
          <span className="text-muted-foreground">
            {sheet.unit}: +{qty(day.qtyIn)} / −{qty(day.qtyOut)}
          </span>
        ) : null}
        <span className="ml-auto text-xs text-muted-foreground">
          closing <b className="text-foreground">{money(day.closing)}</b>
          {quantity && day.stock != null ? (
            <>
              {" · "}
              <b className="text-foreground">{qty(day.stock, sheet.unit)}</b>
            </>
          ) : null}
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
  const a = Number(e.amount);
  const q = Number(e.quantity ?? 0);
  const out = a < 0 || (a === 0 && q < 0);
  const struck = !!e.takenBack || !!e.takesBack;
  const late = e.moneyDate !== e.writtenAt.slice(0, 10) && !e.pending;
  const keeper = sheet.myRole === "keeper";
  const mayTakeBack =
    !e.pending &&
    !struck &&
    sheet.access === "write" &&
    !sheet.closed &&
    (e.mine || keeper);
  // own entries (and keepers): a receipt usually belongs to the person who paid, and a camera on every line would be noise
  const mayAddPhoto =
    !struck &&
    !sheet.closed &&
    !e.pending &&
    sheet.access !== "none" &&
    (e.mine || keeper);
  return (
    <li
      className={`flex items-start gap-3 px-4 py-3 print:break-inside-avoid ${e.pending ? "bg-sky-50/60 dark:bg-sky-950/20" : ""}`}
    >
      <span
        className={`tnum w-24 shrink-0 text-right font-semibold ${struck ? "text-muted-foreground line-through" : out ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}
      >
        {a !== 0 ? signed(e.amount) : null}
        {q !== 0 ? (
          <span
            className={`block text-xs font-medium ${a !== 0 ? "text-muted-foreground" : ""}`}
          >
            {qty(q, sheet.unit, true)}
          </span>
        ) : null}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm ${struck ? "text-muted-foreground line-through" : ""}`}
        >
          {e.person ? (
            <b className="mr-1.5 font-semibold">{e.person.name}</b>
          ) : null}
          {e.note ||
            (e.takesBack ? (
              "Taken back"
            ) : (
              <span className="text-muted-foreground">
                {a > 0
                  ? "Added"
                  : a < 0
                    ? "Taken out"
                    : q > 0
                      ? "Came in"
                      : "Went out"}
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
        {!e.takesBack ? (
          <EntryPhotos entry={e} canAdd={mayAddPhoto} keeper={keeper} />
        ) : null}
      </div>
      {mayTakeBack ? (
        <button
          type="button"
          title="Take back this entry"
          aria-label={`Take back ${signed(e.amount)}`}
          disabled={takeBack.isPending}
          onClick={() =>
            Modal.confirm({
              title: `Take back ${a !== 0 ? signed(e.amount) : qty(q, sheet.unit, true)}?`,
              content:
                "An opposite entry is added and both are shown struck through. Nothing is deleted. Then write the correct entry, if there is one.",
              okText: "Take back",
              okButtonProps: { danger: true },
              onOk: () => takeBack.mutateAsync(e),
            })
          }
          className="grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground print:hidden"
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
    <section className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200 print:hidden">
      <p className="font-semibold">Not accepted by the server</p>
      {pending.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center gap-2">
          <span className="tnum font-semibold">
            {p.amount ? `${p.direction === "out" ? "−" : "+"}${p.amount}` : ""}
            {p.quantity
              ? ` ${p.qtyDirection === "out" ? "−" : "+"}${p.quantity}`
              : ""}
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
