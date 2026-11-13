import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Command } from "cmdk";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  ArrowRightIcon,
  BookOpenIcon,
  BuildingIcon,
  CornerDownLeftIcon,
  HandCoinsIcon,
  Loader2Icon,
  LockIcon,
  PlusIcon,
  ReceiptIcon,
  SearchIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  TruckIcon,
  UserCogIcon,
  UsersIcon,
  WifiOffIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import paths from "@/config/paths";
import { useAuth } from "@/features/auth/store";
import { errorMessage } from "@/shared/api/errors";
import { Chip } from "@/shared/ui/Chip";
import { highlight } from "./match";
import { searchablePages } from "./pages";
import { useRecentSearch, type RecentRow } from "./recent";
import { GROUP_SHORT, type Row, type RowGroup } from "./rows";
import { useSearchUi } from "./store";
import { MIN_LENGTH, useGlobalSearch, type Section } from "./useGlobalSearch";

const ICON: Record<RowGroup, LucideIcon> = {
  pages: ArrowRightIcon,
  customers: UsersIcon,
  purchases: ReceiptIcon,
  debts: HandCoinsIcon,
  held: ShieldCheckIcon,
  transfers: TruckIcon,
  payments: SmartphoneIcon,
  users: UserCogIcon,
  branches: BuildingIcon,
  guide: BookOpenIcon,
};
/** Each kind of result has its own colour, so the eye finds "the purchases" before reading a word. */
const TILE: Record<RowGroup, string> = {
  pages: "bg-muted text-muted-foreground",
  customers: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  purchases: "bg-gold/20 text-brand dark:text-gold",
  debts: "bg-red-500/10 text-red-700 dark:text-red-300",
  held: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  transfers: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  payments: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  users: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  branches: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  guide: "bg-teal-500/10 text-teal-700 dark:text-teal-300",
};

const Kbd = ({ children }: { children: React.ReactNode }) => (
  <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-background px-1 font-sans text-[11px] font-medium text-muted-foreground">
    {children}
  </kbd>
);

function Marked({ text, q }: { text: string; q: string }) {
  return (
    <>
      {highlight(text, q).map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-[3px] bg-gold/35 px-px text-inherit">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

function ResultRow({
  row,
  q,
  onOpen,
  onAction,
}: {
  row: Pick<Row, "key" | "group" | "title" | "subtitle"> & Partial<Row>;
  q: string;
  onOpen: () => void;
  onAction?: () => void;
}) {
  const Icon = ICON[row.group];
  return (
    <Command.Item
      value={row.key}
      onSelect={onOpen}
      className="group relative flex min-h-14 cursor-pointer select-none items-center gap-3 rounded-xl px-2.5 py-2 outline-none data-[selected=true]:bg-muted sm:min-h-12"
    >
      <span
        aria-hidden
        className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-gold opacity-0 group-data-[selected=true]:opacity-100"
      />
      <span
        aria-hidden
        className={`grid size-9 shrink-0 place-items-center rounded-lg ${TILE[row.group]}`}
      >
        <Icon className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[15px] font-semibold leading-tight text-foreground sm:text-sm">
            <Marked text={row.title} q={q} />
          </span>
          {row.chips?.map((c) => (
            <Chip key={c.text} tone={c.tone}>
              {c.text}
            </Chip>
          ))}
        </span>
        {/* On a phone the second line may wrap once, so the weights and the karat are not cut off. */}
        <span className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground sm:line-clamp-1">
          <Marked text={row.subtitle} q={q} />
        </span>
      </span>
      {row.value ? (
        <span className="shrink-0 text-right leading-tight">
          <span
            className={`tnum block text-sm font-bold ${row.valueTone === "red" ? "text-red-600 dark:text-red-400" : row.valueTone === "green" ? "text-emerald-600" : "text-foreground"}`}
          >
            {row.value}
          </span>
          {row.valueNote ? (
            <span className="block text-[11px] text-muted-foreground">
              {row.valueNote}
            </span>
          ) : null}
        </span>
      ) : null}
      {row.action && onAction ? (
        <button
          type="button"
          title={row.action.label}
          aria-label={`${row.action.label} for ${row.title}`}
          // Not a second "selected" thing for the arrow keys: reached by tap, click, or Shift+Enter on the row.
          tabIndex={-1}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onAction();
          }}
          className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-background text-brand hover:bg-gold/20 sm:size-8 sm:opacity-0 sm:group-hover:opacity-100 sm:group-data-[selected=true]:opacity-100"
        >
          <PlusIcon className="size-4" />
        </button>
      ) : null}
      <CornerDownLeftIcon
        aria-hidden
        className="hidden size-3.5 shrink-0 text-muted-foreground sm:block sm:opacity-0 sm:group-data-[selected=true]:opacity-100"
      />
    </Command.Item>
  );
}

const heading =
  "px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

export interface PaletteViewProps {
  typed: string;
  onTyped: (v: string) => void;
  only: RowGroup | null;
  onOnly: (g: RowGroup | null) => void;
  /** What is being searched for, after the pause in typing. */
  q: string;
  ready: boolean;
  sections: Section[];
  /** Every group that has something, for the filter chips (the same whatever `only` is). */
  found: { key: RowGroup; total: number }[];
  loading: boolean;
  busy: boolean;
  deviceOnly: boolean;
  failed: string | null;
  recent: RecentRow[];
  shortcuts: Row[];
  onOpen: (
    row: Pick<Row, "key" | "group" | "title" | "subtitle" | "href" | "state">,
  ) => void;
  onAction: (row: Row) => void;
  onForget: (key: string) => void;
  onClose: () => void;
}

/** The search as it looks, given what there is to show. No data fetching in here, so it can be looked at with made-up data. */
export function SearchPaletteView(p: PaletteViewProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(
    () =>
      new Map(
        p.sections.flatMap((s) => s.rows.map((r) => [r.key, r] as const)),
      ),
    [p.sections],
  );
  const nothing = p.ready && !p.loading && !p.busy && p.sections.length === 0;

  // Which row the arrow keys are on. Results arrive after the typing, so the first row is chosen here each time the answer changes:
  // Enter then opens the best match without an arrow key first.
  const first = p.ready
    ? p.sections[0]?.rows[0]?.key
    : (p.recent[0]?.key ?? p.shortcuts[0]?.key);
  const [active, setActive] = useState("");
  useEffect(() => {
    setActive(first ?? "");
    listRef.current?.scrollTo({ top: 0 });
  }, [p.q, p.only, first]);

  return (
    <Command
      shouldFilter={false}
      loop
      value={active}
      onValueChange={setActive}
      label="Search"
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(e) => {
        // Shift+Enter: the row's second action (for a customer, start a purchase).
        if (e.key === "Enter" && e.shiftKey) {
          const key = (
            e.currentTarget.querySelector(
              '[cmdk-item][aria-selected="true"]',
            ) as HTMLElement | null
          )?.getAttribute("data-value");
          const row = key ? rows.get(key) : undefined;
          if (row?.action) {
            e.preventDefault();
            p.onAction(row);
          }
        }
      }}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 pt-[env(safe-area-inset-top)] sm:px-4">
        {p.busy || p.loading ? (
          <Loader2Icon
            className="size-5 shrink-0 animate-spin text-brand"
            aria-hidden
          />
        ) : (
          <SearchIcon
            className="size-5 shrink-0 text-muted-foreground"
            aria-hidden
          />
        )}
        <Command.Input
          ref={inputRef}
          autoFocus
          value={p.typed}
          onValueChange={p.onTyped}
          placeholder="Name, phone, receipt number, amount…"
          // 16px on phones so iOS does not zoom the page when the box is focused
          className="h-14 min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground/70 sm:h-13 sm:text-[15px]"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {p.typed ? (
          <button
            type="button"
            aria-label="Clear"
            onClick={() => {
              p.onTyped("");
              inputRef.current?.focus();
            }}
            className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <XIcon className="size-4" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={p.onClose}
          className="shrink-0 rounded-lg px-2 py-2 text-sm font-semibold text-brand sm:hidden"
        >
          Cancel
        </button>
        <span className="hidden sm:block">
          <Kbd>Esc</Kbd>
        </span>
      </div>

      {p.ready && p.found.length > 1 ? (
        <div
          className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-border px-3 py-2 [scrollbar-width:none] sm:px-4"
          role="tablist"
          aria-label="Show only"
        >
          {[
            { key: null as RowGroup | null, label: "All", total: 0 },
            ...p.found.map((f) => ({
              key: f.key as RowGroup | null,
              label: GROUP_SHORT[f.key],
              total: f.total,
            })),
          ].map((f) => {
            const on = p.only === f.key;
            return (
              <button
                key={f.key ?? "all"}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => {
                  p.onOnly(f.key);
                  inputRef.current?.focus();
                }}
                className={`flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-semibold transition-colors ${on ? "border-navy bg-navy text-white" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}
              >
                {f.label}
                {f.key ? (
                  <span
                    className={`tnum rounded-full px-1.5 text-[10px] ${on ? "bg-white/20" : "bg-muted"}`}
                  >
                    {f.total > 99 ? "99+" : f.total}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {p.deviceOnly ? (
        <div className="flex shrink-0 items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-900 dark:text-amber-200">
          <WifiOffIcon className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            No connection. Showing what this device holds: this branch's
            customers and recent purchases, and the pages. Everything else needs
            a connection.
          </span>
        </div>
      ) : null}

      <Command.List
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2 sm:px-2 [&_[cmdk-list-sizer]]:space-y-0"
      >
        {!p.ready ? (
          <>
            {p.recent.length > 0 ? (
              <Command.Group>
                <div className={heading} aria-hidden>
                  Recently opened
                </div>
                {p.recent.map((r) => (
                  <div key={r.key} className="group/recent relative">
                    <ResultRow
                      row={{ ...r, group: r.group }}
                      q=""
                      onOpen={() => p.onOpen(r)}
                    />
                    <button
                      type="button"
                      aria-label={`Remove ${r.title} from recent`}
                      tabIndex={-1}
                      onClick={() => p.onForget(r.key)}
                      className="absolute right-8 top-1/2 hidden size-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-background group-hover/recent:grid"
                    >
                      <XIcon className="size-3.5" />
                    </button>
                  </div>
                ))}
              </Command.Group>
            ) : null}
            {p.shortcuts.length > 0 ? (
              <Command.Group>
                <div className={heading} aria-hidden>
                  Go to
                </div>
                {p.shortcuts.map((r) => (
                  <ResultRow
                    key={r.key}
                    row={r}
                    q=""
                    onOpen={() => p.onOpen(r)}
                  />
                ))}
              </Command.Group>
            ) : null}
            <div className="px-3 pb-2 pt-4 text-xs leading-relaxed text-muted-foreground">
              <p className="font-medium text-foreground">
                Search everything you can see
              </p>
              <p className="mt-1">
                A customer's <b>name</b> or <b>phone number</b> in any format ·
                a <b>receipt number</b> or its last digits · an <b>amount</b>{" "}
                paid · a transfer, a mobile money reference, a page.
              </p>
              {p.typed.trim().length === 1 ? (
                <p className="mt-2 text-brand">Type one more letter.</p>
              ) : null}
            </div>
          </>
        ) : null}

        {p.loading ? (
          <div aria-hidden className="space-y-1 pt-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3 px-2.5 py-2">
                <div className="size-9 animate-pulse rounded-lg bg-muted" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-2/5 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-3/5 animate-pulse rounded bg-muted" />
                </div>
                <div className="h-4 w-16 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : null}

        {p.failed ? (
          <p
            role="alert"
            className="m-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300"
          >
            {p.failed}
          </p>
        ) : null}

        {!p.loading
          ? p.sections.map((s) => (
              <Command.Group key={s.key}>
                <div
                  className={`${heading} flex items-center justify-between gap-2`}
                >
                  <span>{s.label}</span>
                  {s.total > s.rows.length && !p.only ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => {
                        p.onOnly(s.key);
                        inputRef.current?.focus();
                      }}
                      className="rounded px-1 text-[11px] font-semibold normal-case tracking-normal text-brand hover:underline"
                    >
                      See all {s.total.toLocaleString("en-GH")}
                    </button>
                  ) : s.total > s.rows.length ? (
                    <span className="normal-case tracking-normal">
                      First {s.rows.length} of {s.total.toLocaleString("en-GH")}
                      . Type more to narrow.
                    </span>
                  ) : null}
                </div>
                {s.rows.map((r) => (
                  <ResultRow
                    key={r.key}
                    row={r}
                    q={p.q}
                    onOpen={() => p.onOpen(r)}
                    onAction={() => p.onAction(r)}
                  />
                ))}
              </Command.Group>
            ))
          : null}

        {nothing && !p.failed ? (
          <div className="px-4 py-10 text-center">
            <div className="mx-auto grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
              <SearchIcon className="size-5" aria-hidden />
            </div>
            <p className="mt-3 text-sm font-semibold text-foreground">
              Nothing found for “{p.q}”
            </p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
              {p.deviceOnly
                ? "This device only holds this branch's customers and recent purchases. Try again when there is a connection."
                : p.only
                  ? "Nothing in this group. Look in all groups?"
                  : "Check the spelling, try fewer letters, or try the phone number or the receipt number instead."}
            </p>
            {p.only ? (
              <button
                type="button"
                onClick={() => {
                  p.onOnly(null);
                  inputRef.current?.focus();
                }}
                className="mt-3 rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-brand"
              >
                Search all groups
              </button>
            ) : null}
          </div>
        ) : null}
      </Command.List>

      <div className="hidden shrink-0 items-center justify-between gap-3 border-t border-border bg-muted/40 px-4 py-2 text-[11px] text-muted-foreground sm:flex">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> move
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> open
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Shift</Kbd>
            <Kbd>↵</Kbd> new purchase for a customer
          </span>
        </span>
        <span className="flex items-center gap-1">
          <LockIcon className="size-3" aria-hidden /> You only see what you are
          allowed to see
        </span>
      </div>
    </Command>
  );
}

/** A few places most people go, offered before anything is typed. */
const SHORTCUTS = [
  paths.transactions.create.href,
  paths.drawer.home.href,
  paths.transactions.list.href,
  paths.people.customers.href,
  paths.calculator.href,
];

/** The search, wired to the app: opened from anywhere, asks the server, remembers what was opened. */
export function SearchPalette() {
  const open = useSearchUi((s) => s.open);
  const setOpen = useSearchUi((s) => s.setOpen);
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const userId = user?.id ?? "";
  const [typed, setTyped] = useState("");
  const [only, setOnly] = useState<RowGroup | null>(null);
  const search = useGlobalSearch(open ? typed : "", only);
  // The chips list every group that has something, also while one of them is picked.
  const [found, setFound] = useState<{ key: RowGroup; total: number }[]>([]);
  useEffect(() => {
    if (!search.ready) setFound([]);
    else if (!only && !search.loading && !search.waiting)
      setFound(search.sections.map((s) => ({ key: s.key, total: s.total })));
  }, [search.ready, search.sections, search.loading, search.waiting, only]);
  // Each time it opens it starts clean.
  useEffect(() => {
    if (open) {
      setTyped("");
      setOnly(null);
    }
  }, [open]);
  // A different question: back to all groups.
  useEffect(() => setOnly(null), [search.q]);

  const recent = useRecentSearch((s) => s.byUser[userId]) ?? [];
  const shortcuts = useMemo<Row[]>(() => {
    const pages = searchablePages(user);
    return SHORTCUTS.map((href) => pages.find((p) => p.href === href))
      .filter((p) => !!p)
      .map((p) => ({
        key: `pages:${p.href}|${p.title}`,
        group: "pages" as const,
        title: p.title,
        subtitle: p.section || "Page",
        chips: [],
        href: p.href,
      }));
  }, [user]);

  const go = (href: string, state?: unknown) => {
    setOpen(false);
    navigate(href, state ? { state } : undefined);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-navy/45 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-card outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 sm:inset-auto sm:left-1/2 sm:top-[9vh] sm:max-h-[min(78vh,720px)] sm:w-[min(720px,calc(100vw-2rem))] sm:-translate-x-1/2 sm:rounded-2xl sm:border sm:border-border sm:shadow-2xl sm:data-[state=open]:zoom-in-95"
        >
          <DialogPrimitive.Title className="sr-only">
            Search
          </DialogPrimitive.Title>
          <SearchPaletteView
            typed={typed}
            onTyped={setTyped}
            only={only}
            onOnly={setOnly}
            q={search.q}
            ready={search.ready}
            sections={search.sections}
            found={found}
            loading={search.loading}
            busy={
              search.refreshing ||
              (search.waiting && typed.trim().length >= MIN_LENGTH)
            }
            deviceOnly={search.deviceOnly}
            failed={search.failed ? errorMessage(search.failed) : null}
            recent={recent}
            shortcuts={shortcuts}
            onOpen={(row) => {
              if (userId && row.group !== "pages")
                useRecentSearch.getState().remember(userId, row as Row);
              go(row.href, row.state);
            }}
            onAction={(row) => {
              if (row.action) go(row.action.href, row.action.state);
            }}
            onForget={(key) => useRecentSearch.getState().forget(userId, key)}
            onClose={() => setOpen(false)}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
