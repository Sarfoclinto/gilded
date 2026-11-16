import { useEffect, useMemo, useState } from "react";
import { Input, Modal } from "antd";
import {
  CameraIcon,
  CheckIcon,
  ClockIcon,
  ImagesIcon,
  LockKeyholeIcon,
  RotateCcwIcon,
  SearchIcon,
  Trash2Icon,
  TypeIcon,
} from "lucide-react";
import { useSettings } from "@/features/settings/api";
import { fetchPicture, usePicture } from "@/features/photos/api";
import { formatBytes, type PhotoRecord } from "@/features/photos/model";
import {
  PhotoViewer,
  whenText,
  type PhotoView,
} from "@/features/photos/PhotoViewer";
import {
  usePhotoQueue,
  useQueuedPhotos,
} from "@/features/photos/PhotoProvider";
import type { PhotoQueue } from "@/features/photos/queue";
import { CoinEdge } from "@/shared/ui/BrandMark";
import {
  personalPictureUrl,
  nearlyFull,
  usageText,
  useDeleteMyPictures,
  useMyPictures,
  useSetCaption,
  type PersonalPicture,
} from "./api";
import { QuickCameraButton } from "./QuickCamera";

const STEP = 60;

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const start = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

function Thumb({
  p,
  selecting,
  selected,
  onTap,
}: {
  p: PersonalPicture;
  selecting: boolean;
  selected: boolean;
  onTap: () => void;
}) {
  const url = usePicture(personalPictureUrl(p.id, true));
  return (
    <li className="relative">
      <button
        type="button"
        onClick={onTap}
        aria-pressed={selecting ? selected : undefined}
        aria-label={`${p.caption ?? "Picture"} from ${whenText(p.takenAt)}`}
        className={`relative block aspect-square w-full overflow-hidden rounded-xl bg-muted ring-offset-2 transition ${selected ? "ring-2 ring-gold" : ""}`}
      >
        {url ? (
          <img
            src={url}
            alt=""
            className={`size-full object-cover transition ${selected ? "scale-95" : ""}`}
          />
        ) : (
          <span className="block size-full animate-pulse bg-muted" />
        )}
        {selecting ? (
          <span
            className={`absolute left-1.5 top-1.5 grid size-6 place-items-center rounded-full border-2 ${selected ? "border-gold bg-gold text-navy" : "border-white/90 bg-black/25 text-transparent"}`}
          >
            <CheckIcon className="size-3.5" aria-hidden />
          </span>
        ) : null}
      </button>
      {p.caption ? (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
          {p.caption}
        </p>
      ) : null}
    </li>
  );
}

function Waiting({ queue, r }: { queue: PhotoQueue; r: PhotoRecord }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const t = queue.thumb(r.id);
    if (!t) return;
    const u = URL.createObjectURL(t);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [queue, r.id]);
  return (
    <li className="relative aspect-square overflow-hidden rounded-xl bg-muted">
      {url ? <img src={url} alt="" className="size-full object-cover" /> : null}
      <span
        className="absolute inset-0 grid place-items-center bg-black/35 text-white"
        role="status"
        aria-label={
          r.status === "failed" ? "Could not be sent" : "Waiting to send"
        }
      >
        {r.status === "failed" ? null : (
          <ClockIcon className="size-6" aria-hidden />
        )}
      </span>
      {r.status === "failed" ? (
        <button
          type="button"
          onClick={() => void queue.retry(r.id)}
          className="absolute inset-x-1 bottom-1 flex items-center justify-center gap-1 rounded-lg bg-white/90 py-1 text-xs font-semibold text-black"
        >
          <RotateCcwIcon className="size-3.5" aria-hidden />
          Try again
        </button>
      ) : null}
    </li>
  );
}

/** My pictures: the person's own private camera roll. Only they can ever see it. */
export default function MyPicturesPage() {
  const switchedOff = !useSettings()["personalPictures.enabled"];
  const queue = usePhotoQueue();
  const queued = useQueuedPhotos(queue);
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [size, setSize] = useState(STEP);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [view, setView] = useState<number | null>(null);
  const [asking, setAsking] = useState(false);
  const [captioning, setCaptioning] = useState<PersonalPicture | null>(null);
  const [caption, setCaption] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(q.trim());
      setSize(STEP);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const list = useMyPictures({ q: term || undefined, size });
  const remove = useDeleteMyPictures();
  const setCap = useSetCaption();

  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const ids = useMemo(() => new Set(items.map((p) => p.id)), [items]);
  const waiting = useMemo(
    () =>
      queued.filter(
        (r) =>
          r.target?.entityType === "personal" &&
          r.status !== "sent" &&
          !ids.has(r.id),
      ),
    [queued, ids],
  );
  const usage = list.data?.usage;

  const groups = useMemo(() => {
    const out: { label: string; items: PersonalPicture[] }[] = [];
    for (const p of items) {
      const label = dayLabel(p.takenAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(p);
      else out.push({ label, items: [p] });
    }
    return out;
  }, [items]);

  const views: PhotoView[] = useMemo(
    () =>
      items.map((p) => ({
        id: p.id,
        removable: true,
        caption: `${p.caption ? `${p.caption} · ` : ""}${whenText(p.takenAt)} · ${formatBytes(p.size)}`,
        thumb: async () => ({
          url: await fetchPicture(personalPictureUrl(p.id, true)),
        }),
        full: async () => ({
          url: await fetchPicture(personalPictureUrl(p.id, false)),
        }),
      })),
    [items],
  );

  const stop = () => {
    setSelecting(false);
    setPicked(new Set());
    setAsking(false);
  };
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const doDelete = async () => {
    await remove.mutateAsync([...picked]);
    stop();
  };
  const only =
    picked.size === 1 ? items.find((p) => p.id === [...picked][0]) : undefined;

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-28">
      <header className="relative isolate overflow-hidden rounded-2xl bg-navy p-5 text-white sm:p-7">
        <CoinEdge className="pointer-events-none absolute -right-16 -top-20 -z-10 size-64 text-gold/35 sm:size-80" />
        <div className="flex items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-gold/15 text-gold">
            <LockKeyholeIcon className="size-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-semibold sm:text-3xl">
              My pictures
            </h1>
            <p className="mt-1 max-w-xl text-sm text-white/75">
              Only you can see these. Not managers, not directors, not the
              company, unless you choose to share a picture.
            </p>
            {usage ? (
              <p className="mt-3 text-xs text-white/60">{usageText(usage)}</p>
            ) : null}
          </div>
        </div>
      </header>

      {switchedOff ? (
        <p
          role="status"
          className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
        >
          Your company has switched My pictures off. You can still look at and
          delete what you have kept, but new pictures cannot be saved.
        </p>
      ) : null}
      {usage && !switchedOff && nearlyFull(usage) ? (
        <p
          role="status"
          className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
        >
          You are close to your limit. Delete pictures you no longer need to
          keep taking new ones.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          allowClear
          prefix={
            <SearchIcon className="size-4 text-muted-foreground" aria-hidden />
          }
          placeholder="Search captions"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
          size="large"
        />
        <div className="ml-auto flex items-center gap-2">
          {!switchedOff ? (
            <span className="hidden lg:block">
              <QuickCameraButton variant="header" />
            </span>
          ) : null}
          {items.length ? (
            <button
              type="button"
              onClick={() => (selecting ? stop() : setSelecting(true))}
              className="min-h-10 rounded-full border border-border bg-card px-4 text-sm font-medium hover:bg-muted"
            >
              {selecting ? "Done" : "Select"}
            </button>
          ) : null}
        </div>
      </div>

      {list.isLoading ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square animate-pulse rounded-xl bg-muted"
            />
          ))}
        </div>
      ) : null}
      {list.isError ? (
        <p
          role="alert"
          className="rounded-xl bg-red-50 p-3 text-sm text-red-800"
        >
          Your pictures could not be loaded. Check the connection and try again.
        </p>
      ) : null}

      {waiting.length && queue ? (
        <section aria-label="On their way" className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">
            On their way
          </h2>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {waiting.map((r) => (
              <Waiting key={r.id} queue={queue} r={r} />
            ))}
          </ul>
        </section>
      ) : null}

      {groups.map((g) => (
        <section key={g.label} aria-label={g.label} className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">
            {g.label}
          </h2>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {g.items.map((p) => (
              <Thumb
                key={p.id}
                p={p}
                selecting={selecting}
                selected={picked.has(p.id)}
                onTap={() =>
                  selecting
                    ? toggle(p.id)
                    : setView(items.findIndex((x) => x.id === p.id))
                }
              />
            ))}
          </ul>
        </section>
      ))}

      {list.data && list.data.total > items.length ? (
        <div className="text-center">
          <button
            type="button"
            onClick={() => setSize((n) => n + STEP)}
            className="min-h-10 rounded-full border border-border bg-card px-5 text-sm font-medium hover:bg-muted"
          >
            Show more ({list.data.total - items.length} left)
          </button>
        </div>
      ) : null}

      {list.data && !items.length && !waiting.length ? (
        <div className="grid place-items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-gold/15 text-brand">
            {term ? (
              <SearchIcon className="size-7" aria-hidden />
            ) : (
              <ImagesIcon className="size-7" aria-hidden />
            )}
          </span>
          <p className="font-display text-xl font-semibold">
            {term ? "No caption matches that" : "Nothing here yet"}
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {term
              ? "Try a different word."
              : "Tap the camera button to take your first picture. Notes, a price board, anything you want to keep for yourself."}
          </p>
          {!term && !switchedOff ? (
            <span className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <CameraIcon className="size-4" aria-hidden />
              The round camera button is always on screen.
            </span>
          ) : null}
        </div>
      ) : null}

      {selecting ? (
        <div
          className="fixed inset-x-3 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-xl rounded-2xl border border-border bg-card p-3 shadow-2xl lg:bottom-6"
          role="toolbar"
          aria-label="Selected pictures"
        >
          {asking ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold">
                Delete{" "}
                {picked.size === 1
                  ? "this picture"
                  : `these ${picked.size} pictures`}{" "}
                for good?
              </p>
              <p className="text-xs text-muted-foreground">
                This cannot be undone.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAsking(false)}
                  className="min-h-11 rounded-lg border border-border font-medium"
                >
                  Keep
                </button>
                <button
                  type="button"
                  disabled={remove.isPending}
                  onClick={() => void doDelete()}
                  className="min-h-11 rounded-lg bg-red-600 font-semibold text-white disabled:opacity-60"
                >
                  {remove.isPending ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="px-1 text-sm font-medium">
                {picked.size
                  ? `${picked.size} selected`
                  : "Tap pictures to select"}
              </span>
              <span className="ml-auto flex gap-2">
                {only ? (
                  <button
                    type="button"
                    onClick={() => {
                      setCaptioning(only);
                      setCaption(only.caption ?? "");
                    }}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium"
                  >
                    <TypeIcon className="size-4" aria-hidden />
                    Caption
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={!picked.size}
                  onClick={() => setAsking(true)}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-sm font-semibold text-white disabled:opacity-40"
                >
                  <Trash2Icon className="size-4" aria-hidden />
                  Delete
                </button>
              </span>
            </div>
          )}
        </div>
      ) : null}

      <Modal
        open={!!captioning}
        title="Caption"
        okText="Save caption"
        onCancel={() => setCaptioning(null)}
        confirmLoading={setCap.isPending}
        onOk={async () => {
          if (captioning) {
            await setCap.mutateAsync({ id: captioning.id, caption });
            setCaptioning(null);
            stop();
          }
        }}
      >
        <Input
          autoFocus
          maxLength={200}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="What is this a picture of?"
          onPressEnter={() => undefined}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Captions are for you. You can search by them.
        </p>
      </Modal>

      {view !== null ? (
        <PhotoViewer
          personal
          items={views}
          start={view}
          onClose={() => setView(null)}
          onRemove={async (v) => {
            await remove.mutateAsync([v.id]);
            if (views.length <= 1) setView(null);
          }}
        />
      ) : null}
    </div>
  );
}
