import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Input } from "antd";
import { LockIcon } from "lucide-react";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { useAuth } from "@/features/auth/store";
import { useHasPermission } from "@/features/auth/useHasPermission";
import { useBranchNames } from "@/features/branches/api";
import { errorMessage } from "@/shared/api/errors";
import { EmptyState, Pager } from "@/shared/ui/DataTable";
import { PageHeader } from "@/shared/ui/PageHeader";
import type { Gap } from "../api";
import {
  fetchPicture,
  pictureUrl,
  useGaps,
  useLibrary,
  useRemoveAttachment,
  type LibraryItem,
} from "../api";
import { formatBytes } from "../model";
import { PhotoViewer, whenText, type PhotoView } from "../PhotoViewer";

const KINDS: { value: string; label: string }[] = [
  { value: "", label: "Everything" },
  { value: "transfer", label: "Transfers" },
  { value: "day", label: "Closing the day" },
  { value: "transaction", label: "Purchases" },
  { value: "collateral", label: "Held gold" },
  { value: "customer", label: "Customer IDs" },
  { value: "missing", label: "Missing photos" },
];
const KIND_NAME: Record<string, string> = {
  transfer: "Transfer",
  day: "Day",
  transaction: "Purchase",
  collateral: "Held gold",
  customer: "Customer ID",
};
const SLOT_NAME: Record<string, string> = {
  release: "Hand-over",
  receive: "Receipt",
  closing: "Closing",
  opening: "Opening",
  collateral: "On the scale",
  goods: "Gold",
  id: "ID",
  other: "Other",
};

/** Where the record a picture belongs to can be opened. */
function recordLink(a: LibraryItem): string | undefined {
  switch (a.entityType) {
    case "transfer":
      return paths.transfers.detail.to(a.entityId);
    case "transaction":
      return paths.transactions.detail.to(a.entityId);
    case "customer":
      return paths.people.customer.to(a.entityId);
    case "day":
      return paths.drawer.history.href;
    case "collateral":
      return paths.collateral.href;
    default:
      return undefined;
  }
}

function gapLink(g: Gap): string {
  return g.kind === "transfer"
    ? paths.transfers.detail.to(g.id)
    : g.kind === "day"
      ? paths.drawer.history.href
      : paths.collateral.href;
}

/** Records that should have a picture and have none: what a reviewer chases instead of asking in a group. */
function Missing() {
  const gaps = useGaps(true);
  const rows = gaps.data ?? [];
  if (gaps.error)
    return <Alert type="error" showIcon title={errorMessage(gaps.error)} />;
  if (rows.length === 0 && !gaps.isLoading)
    return (
      <EmptyState
        title="Nothing is missing"
        hint="Every closed day, hand-over and held gold in your branches has a picture. Pictures are never required; this list only shows the gaps."
      />
    );
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card">
      {rows.map((g) => (
        <li
          key={`${g.kind}-${g.id}`}
          className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
        >
          <div className="min-w-0">
            <Link to={gapLink(g)} className="font-semibold underline">
              {g.label ?? KIND_NAME[g.kind]}
            </Link>
            <div className="text-xs text-muted-foreground">
              {KIND_NAME[g.kind] ?? g.kind} · {g.branchName ?? ""} ·{" "}
              {whenText(g.at)}
            </div>
          </div>
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900">
            No {g.missing}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Tile({ a, onOpen }: { a: LibraryItem; onOpen: () => void }) {
  const [url, setUrl] = useState<string>();
  // load the small preview when the tile is first drawn
  useEffect(() => {
    let alive = true;
    void fetchPicture(pictureUrl(a.id, true))
      .then((u) => {
        if (alive) setUrl(u);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [a.id]);
  const to = recordLink(a);
  return (
    <li className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={onOpen}
        className="relative block aspect-square w-full bg-muted"
        aria-label={`Open the photo of ${a.label ?? KIND_NAME[a.entityType] ?? "a record"}`}
      >
        {url ? (
          <img
            src={url}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <span className="absolute inset-0 animate-pulse bg-muted" />
        )}
        {a.reused ? (
          <span className="absolute bottom-1.5 left-1.5 rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-semibold text-black">
            Used before
          </span>
        ) : null}
        {a.entityType === "customer" ? (
          <span className="absolute left-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-black/60 text-white">
            <LockIcon className="size-3.5" aria-label="Customer ID" />
          </span>
        ) : null}
      </button>
      <div className="space-y-0.5 p-2 text-xs">
        <div className="truncate font-semibold">
          {to ? (
            <Link to={to} className="underline">
              {a.label ?? KIND_NAME[a.entityType]}
            </Link>
          ) : (
            (a.label ?? KIND_NAME[a.entityType])
          )}
        </div>
        <div className="truncate text-muted-foreground">
          {KIND_NAME[a.entityType] ?? a.entityType} ·{" "}
          {SLOT_NAME[a.slot] ?? a.slot}
        </div>
        <div className="truncate text-muted-foreground">
          {whenText(a.takenAt)}
        </div>
        <div className="truncate text-muted-foreground">
          {a.by?.displayName ?? "Someone"}
          {a.branchName ? ` · ${a.branchName}` : ""}
        </div>
      </div>
    </li>
  );
}

/** Every picture from the branches you can see, newest first: the place that replaces scrolling a WhatsApp group. */
export default function PhotosPage() {
  const user = useAuth((s) => s.user);
  const canRemoveAny = useHasPermission(PERMISSIONS.ATTACHMENTS_REMOVE);
  const canSeeIds = useHasPermission(PERMISSIONS.ATTACHMENTS_IDS);
  const branchNames = useBranchNames();
  const [type, setType] = useState("");
  const [branchId, setBranchId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<number | null>(null);
  const size = 24;
  const filters = {
    type: type || undefined,
    branchId: branchId || undefined,
    from: from || undefined,
    to: to || undefined,
    q: q.trim() || undefined,
    page,
    size,
  };
  const missing = type === "missing";
  const query = useLibrary({
    ...filters,
    type: missing ? undefined : filters.type,
  });
  const remove = useRemoveAttachment();
  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const reset =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(1);
    };

  const views: PhotoView[] = useMemo(
    () =>
      items.map((a) => ({
        id: a.id,
        removable: canRemoveAny || a.by?.id === user?.id,
        noShare: a.entityType === "customer",
        caption: `${a.label ?? KIND_NAME[a.entityType] ?? ""} · ${SLOT_NAME[a.slot] ?? a.slot} · ${a.width ?? "?"}×${a.height ?? "?"} · ${formatBytes(a.size)} · ${whenText(a.takenAt)}${a.by ? ` · ${a.by.displayName}` : ""}${a.reused ? " · used before on another record" : ""}`,
        thumb: async () => ({
          url: await fetchPicture(pictureUrl(a.id, true)),
        }),
        full: async () => ({
          url: await fetchPicture(pictureUrl(a.id, false)),
        }),
      })),
    [items, canRemoveAny, user?.id],
  );

  const field = "min-h-10 rounded-lg border border-border bg-card px-3 text-sm";
  return (
    <div className="space-y-4 p-3 sm:p-4 lg:p-6">
      <PageHeader
        title="Photos"
        subtitle="Every picture from your branches in one place. Nothing is deleted: a removed picture only leaves this page."
      />
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="What kind of picture"
      >
        {KINDS.filter((k) => k.value !== "customer" || canSeeIds).map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => reset(setType)(k.value)}
            aria-pressed={type === k.value}
            className={`min-h-9 rounded-full border px-3 text-sm font-medium ${type === k.value ? "border-brand bg-brand text-white" : "border-border bg-card hover:bg-muted"}`}
          >
            {k.label}
          </button>
        ))}
      </div>
      {missing ? <Missing /> : null}
      <div
        className={`grid gap-2 sm:grid-cols-2 lg:grid-cols-4 ${missing ? "hidden" : ""}`}
      >
        <Input
          allowClear
          placeholder="Search a name, number or reference"
          value={q}
          onChange={(e) => reset(setQ)(e.target.value)}
          className="min-h-10"
          aria-label="Search"
        />
        <select
          aria-label="Branch"
          className={field}
          value={branchId}
          onChange={(e) => reset(setBranchId)(e.target.value)}
        >
          <option value="">All my branches</option>
          {Object.entries(branchNames).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          From
          <input
            type="date"
            className={`${field} w-full`}
            value={from}
            onChange={(e) => reset(setFrom)(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          To
          <input
            type="date"
            className={`${field} w-full`}
            value={to}
            onChange={(e) => reset(setTo)(e.target.value)}
          />
        </label>
      </div>
      {query.error ? (
        <Alert type="error" showIcon title={errorMessage(query.error)} />
      ) : null}
      {missing ? null : items.length === 0 && !query.isLoading ? (
        <EmptyState
          title="No pictures here"
          hint="Try another kind, branch or date."
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {items.map((a, i) => (
            <Tile key={a.id} a={a} onOpen={() => setView(i)} />
          ))}
        </ul>
      )}
      {missing ? null : (
        <Pager
          text={`${total} picture${total === 1 ? "" : "s"}`}
          page={page}
          pages={Math.ceil(total / size)}
          onPage={setPage}
        />
      )}
      {view !== null ? (
        <PhotoViewer
          items={views}
          start={view}
          onClose={() => setView(null)}
          onRemove={async (v) => {
            await remove.mutateAsync({ id: v.id });
            setView(null);
          }}
        />
      ) : null}
    </div>
  );
}
