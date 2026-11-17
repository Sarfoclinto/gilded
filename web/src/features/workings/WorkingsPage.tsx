import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Input, Modal } from "antd";
import {
  CopyIcon,
  PencilLineIcon,
  PlusIcon,
  SearchIcon,
  SigmaIcon,
  Trash2Icon,
} from "lucide-react";
import paths from "@/config/paths";
import { useAuth } from "@/features/auth/store";
import { useSettings } from "@/features/settings/api";
import { useConnectivity } from "@/shared/offline/connectivity";
import { CoinEdge } from "@/shared/ui/BrandMark";
import {
  useDeleteSheets,
  useRenameSheet,
  useSheets,
  workingsApi,
  type SheetMeta,
} from "./api";
import { openSheetStore, type LocalSheet } from "./local";

const when = (iso: string | number) =>
  new Date(iso)
    .toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(",", "");

/** The person's sheets, newest first, with the ones not yet on the server marked. Only they can see this list. */
export default function WorkingsPage() {
  const navigate = useNavigate();
  const owner = useAuth((s) => s.user?.id ?? "");
  const online = useConnectivity((s) => s.online);
  const off = !useSettings()["workings.enabled"];
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [local, setLocal] = useState<LocalSheet[]>([]);
  const [renaming, setRenaming] = useState<SheetMeta | null>(null);
  const [name, setName] = useState("");
  const list = useSheets(term || undefined);
  const rename = useRenameSheet();
  const remove = useDeleteSheets();

  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    let alive = true;
    void openSheetStore()
      .then((s) => s.all(owner))
      .then((l) => {
        if (alive) setLocal(l);
      });
    return () => {
      alive = false;
    };
  }, [owner, list.dataUpdatedAt]);

  // the server's list plus anything only this device has (not yet sent, or made offline)
  const items = useMemo(() => {
    const server = list.data?.items ?? [];
    const ids = new Set(server.map((s) => s.id));
    const extra = local
      .filter(
        (l) =>
          !ids.has(l.id) &&
          !(l.version === 0 && !l.doc.notes.length && l.name === "Untitled") &&
          (l.dirty || !online) &&
          (!term || l.name.toLowerCase().includes(term.toLowerCase())),
      )
      .map((l) => ({
        id: l.id,
        name: l.name,
        notes: l.doc.notes.length,
        version: l.version,
        createdAt: new Date(l.updatedAt).toISOString(),
        updatedAt: new Date(l.updatedAt).toISOString(),
        device: true,
      }));
    const dirty = new Set(local.filter((l) => l.dirty).map((l) => l.id));
    return [
      ...extra,
      ...server.map((s) => ({ ...s, device: dirty.has(s.id) })),
    ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [list.data, local, online, term]);

  const usage = list.data?.usage;

  const create = () =>
    navigate(`${paths.workings.sheet.to(crypto.randomUUID())}?new=1`);
  const duplicate = async (s: SheetMeta) => {
    const store = await openSheetStore();
    const src =
      (await store.get(s.id)) ??
      (online
        ? await workingsApi
            .get(s.id)
            .then((r) => ({ name: r.name, doc: r.doc }))
        : null);
    if (!src) return;
    const id = crypto.randomUUID();
    await store.put({
      id,
      owner,
      name: `${src.name} (copy)`,
      doc: src.doc,
      version: 0,
      dirty: true,
      updatedAt: Date.now(),
    });
    navigate(paths.workings.sheet.to(id));
  };
  const del = async (s: SheetMeta & { device?: boolean }) => {
    if (!window.confirm(`Delete "${s.name}" for good?`)) return;
    const store = await openSheetStore();
    await store.remove(s.id);
    if (s.version > 0 || !s.device) await remove.mutateAsync([s.id]);
    else setLocal((l) => l.filter((x) => x.id !== s.id));
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-3 sm:p-4 lg:p-6">
      <header className="relative isolate overflow-hidden rounded-2xl bg-navy p-5 text-white sm:p-7">
        <CoinEdge className="pointer-events-none absolute -right-16 -top-20 -z-10 size-64 text-gold/35 sm:size-80" />
        <div className="flex flex-wrap items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-gold/15 text-gold">
            <SigmaIcon className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 basis-64">
            <h1 className="font-display text-2xl font-semibold sm:text-3xl">
              Workings
            </h1>
            <p className="mt-1 max-w-xl text-sm text-white/75">
              Rough calculations on a blank page. Write figures anywhere, point
              at them to work things out. Only you can see your sheets, and
              nothing here touches the books.
            </p>
            {usage ? (
              <p className="mt-3 text-xs text-white/60">
                {usage.count} of {usage.maxCount} sheets
              </p>
            ) : null}
          </div>
          {!off ? (
            <button
              type="button"
              onClick={create}
              className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-gold px-4 text-sm font-semibold text-navy sm:w-auto"
            >
              <PlusIcon className="size-4" aria-hidden />
              New sheet
            </button>
          ) : null}
        </div>
      </header>

      {off ? (
        <p
          role="status"
          className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
        >
          Your company has switched Workings off. You can still open and delete
          what you have; new sheets cannot be made.
        </p>
      ) : null}

      <Input
        allowClear
        prefix={
          <SearchIcon className="size-4 text-muted-foreground" aria-hidden />
        }
        placeholder="Search by name"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="max-w-xs"
        size="large"
      />

      {list.isLoading && !items.length ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : null}

      {items.length ? (
        <ul className="space-y-2">
          {items.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
            >
              <Link
                to={paths.workings.sheet.to(s.id)}
                className="min-w-0 flex-1"
              >
                <span className="block truncate font-semibold">{s.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {s.notes} note{s.notes === 1 ? "" : "s"} · {when(s.updatedAt)}
                  {s.device ? " · on this device" : ""}
                </span>
              </Link>
              <button
                type="button"
                aria-label={`Rename ${s.name}`}
                onClick={() => {
                  setRenaming(s);
                  setName(s.name);
                }}
                className="grid size-10 place-items-center rounded-lg hover:bg-muted"
              >
                <PencilLineIcon className="size-4" aria-hidden />
              </button>
              {!off ? (
                <button
                  type="button"
                  aria-label={`Duplicate ${s.name}`}
                  onClick={() => void duplicate(s)}
                  className="grid size-10 place-items-center rounded-lg hover:bg-muted"
                >
                  <CopyIcon className="size-4" aria-hidden />
                </button>
              ) : null}
              <button
                type="button"
                aria-label={`Delete ${s.name}`}
                onClick={() => void del(s)}
                className="grid size-10 place-items-center rounded-lg text-red-700 hover:bg-red-50"
              >
                <Trash2Icon className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {list.data && !items.length ? (
        <div className="grid place-items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-gold/15 text-brand">
            <SigmaIcon className="size-7" aria-hidden />
          </span>
          <p className="font-display text-xl font-semibold">
            {term ? "No sheet has that name" : "No sheets yet"}
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {term
              ? "Try another word."
              : 'Start one for a customer, a chain, a day. Write "Weight 12.4 g", then "= Weight × price", and the answer appears.'}
          </p>
        </div>
      ) : null}

      <Modal
        open={!!renaming}
        title="Rename"
        okText="Save"
        confirmLoading={rename.isPending}
        onCancel={() => setRenaming(null)}
        onOk={async () => {
          if (!renaming) return;
          const v = name.trim() || "Untitled";
          const store = await openSheetStore();
          const l = await store.get(renaming.id);
          if (l)
            await store.put({
              ...l,
              name: v,
              dirty: l.dirty || l.version === 0,
              updatedAt: Date.now(),
            });
          if (renaming.version > 0)
            await rename.mutateAsync({ id: renaming.id, name: v });
          else
            setLocal((ls) =>
              ls.map((x) => (x.id === renaming.id ? { ...x, name: v } : x)),
            );
          setRenaming(null);
        }}
      >
        <Input
          autoFocus
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onPressEnter={() => undefined}
        />
      </Modal>
    </div>
  );
}
