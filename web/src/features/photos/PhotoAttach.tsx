import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CameraIcon,
  ClockIcon,
  ImageOffIcon,
  RotateCcwIcon,
  SmartphoneIcon,
} from "lucide-react";
import { useAuth } from "@/features/auth/store";
import { useHasPermission } from "@/features/auth/useHasPermission";
import { PERMISSIONS } from "@/config/permissions";
import { CameraSheet } from "./CameraSheet";
import {
  fetchPicture,
  pictureUrl,
  useAttachments,
  useRemoveAttachment,
  usePicture,
  type Attachment,
} from "./api";
import {
  formatBytes,
  type PhotoRecord,
  type PhotoSource,
  type PhotoTarget,
} from "./model";
import {
  PhotoViewer,
  viewsFromRecords,
  whenText,
  type PhotoView,
} from "./PhotoViewer";
import { usePhotoQueue, useQueuedPhotos } from "./PhotoProvider";
import { preparePhoto } from "./process";
import type { PhotoQueue } from "./queue";

function Ring({ r }: { r: PhotoRecord }) {
  if (r.status === "failed" || r.status === "sent") return null;
  return (
    <span
      className="pointer-events-none absolute inset-0 grid place-items-center bg-black/35"
      role="status"
      aria-label={
        r.status === "sending"
          ? `Sending ${Math.round(r.progress * 100)}%`
          : "Waiting to send"
      }
    >
      {r.status === "sending" ? (
        <span
          className="grid size-9 place-items-center rounded-full"
          style={{
            background: `conic-gradient(#fff ${r.progress * 360}deg, rgba(255,255,255,.3) 0)`,
          }}
        >
          <span className="size-6 rounded-full bg-black/70" />
        </span>
      ) : (
        <ClockIcon className="size-6 text-white/90" />
      )}
    </span>
  );
}

function ServerThumb({ a, onOpen }: { a: Attachment; onOpen: () => void }) {
  const url = usePicture(pictureUrl(a.id, true));
  return (
    <li className="relative aspect-square overflow-hidden rounded-xl bg-muted">
      <button
        type="button"
        onClick={onOpen}
        className="block size-full"
        aria-label={`Open the photo from ${whenText(a.takenAt)}`}
      >
        {url ? (
          <img src={url} alt="" className="size-full object-cover" />
        ) : (
          <span className="block size-full animate-pulse bg-muted" />
        )}
      </button>
    </li>
  );
}

function LocalThumb({
  queue,
  r,
  onOpen,
}: {
  queue: PhotoQueue;
  r: PhotoRecord;
  onOpen: () => void;
}) {
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
      <button
        type="button"
        onClick={onOpen}
        className="block size-full"
        aria-label="Open this photo"
      >
        {url ? (
          <img src={url} alt="" className="size-full object-cover" />
        ) : null}
      </button>
      <Ring r={r} />
      {r.status === "failed" ? (
        <button
          type="button"
          onClick={() => void queue.retry(r.id)}
          className="absolute inset-x-1 bottom-1 flex items-center justify-center gap-1 rounded-lg bg-white/90 py-1 text-xs font-semibold text-black"
        >
          <RotateCcwIcon className="size-3.5" />
          Try again
        </button>
      ) : null}
    </li>
  );
}

/**
 * Photos of one thing, in one place of it (B60): what is already stored, what is still on its way from this phone, and the button to add more.
 * Taking a picture never waits for the network and never blocks what the person is doing; with no picture the screen only says so,
 * so a reviewer can see the person did not attach one. `readOnly` shows the pictures without the add button (a branch that is not at that end).
 */
export function PhotoAttach({
  target,
  title,
  hint,
  branchName,
  reference,
  readOnly,
  emptyText,
  max = 12,
}: {
  target: PhotoTarget;
  title?: string;
  hint?: string;
  branchName: string;
  reference?: string;
  readOnly?: boolean;
  /** Said when there is no picture at all. Not an error: pictures are never required. */
  emptyText?: string;
  max?: number;
}) {
  const user = useAuth((s) => s.user);
  const canRemoveAny = useHasPermission(PERMISSIONS.ATTACHMENTS_REMOVE);
  const queue = usePhotoQueue();
  const queued = useQueuedPhotos(queue);
  const stored = useAttachments(target.entityType, target.entityId);
  const remove = useRemoveAttachment();
  const [sheet, setSheet] = useState<null | "camera" | "native">(null);
  const [view, setView] = useState<number | null>(null);
  const [preparing, setPreparing] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const serverItems = useMemo(
    () => (stored.data ?? []).filter((a) => a.slot === target.slot),
    [stored.data, target.slot],
  );
  const serverIds = useMemo(
    () => new Set(serverItems.map((a) => a.id)),
    [serverItems],
  );
  const local = useMemo(
    () =>
      queued.filter(
        (r) =>
          r.target?.entityId === target.entityId &&
          r.target.slot === target.slot &&
          r.target.entityType === target.entityType &&
          !serverIds.has(r.id),
      ),
    [queued, target.entityId, target.slot, target.entityType, serverIds],
  );

  const views: PhotoView[] = useMemo(() => {
    const mine = (a: Attachment) => a.by?.id === user?.id;
    const fromServer: PhotoView[] = serverItems.map((a) => ({
      id: a.id,
      removable: canRemoveAny || mine(a),
      caption: `${a.width ?? "?"}×${a.height ?? "?"} · ${formatBytes(a.size)} · ${a.source ?? "photo"} · ${whenText(a.takenAt)}${a.by ? ` · ${a.by.displayName}` : ""}${a.stamped ? " · stamped" : ""}`,
      thumb: async () => ({ url: await fetchPicture(pictureUrl(a.id, true)) }),
      full: async () => ({ url: await fetchPicture(pictureUrl(a.id, false)) }),
    }));
    return [...fromServer, ...(queue ? viewsFromRecords(local, queue) : [])];
  }, [serverItems, local, queue, canRemoveAny, user?.id]);

  const addAll = useCallback(
    async (shots: { blob: Blob; source: PhotoSource }[]) => {
      if (!queue || !user) return;
      setError(null);
      setPreparing((n) => n + shots.length);
      for (const s of shots) {
        try {
          const p = await preparePhoto(s.blob, {
            source: s.source,
            stamp: {
              branch: branchName,
              reference,
              person: user.displayName,
              at: new Date(),
            },
          });
          await queue.add(p, target, user.id);
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "That picture could not be added.",
          );
        } finally {
          setPreparing((n) => n - 1);
        }
      }
    },
    [queue, user, branchName, reference, target],
  );

  const total = views.length;
  const full = total + preparing >= max;
  const doRemove = async (v: PhotoView) => {
    if (serverIds.has(v.id)) await remove.mutateAsync({ id: v.id });
    else await queue?.remove(v.id);
    if (total <= 1) setView(null);
  };

  return (
    <section
      className="rounded-xl border border-border bg-card p-3"
      aria-label={title ?? "Photos"}
    >
      {title ? <h3 className="text-sm font-semibold">{title}</h3> : null}
      {hint ? (
        <p className="mb-2 text-xs text-muted-foreground">{hint}</p>
      ) : null}
      <ul className="grid grid-cols-4 gap-2 sm:grid-cols-5">
        {serverItems.map((a, i) => (
          <ServerThumb key={a.id} a={a} onOpen={() => setView(i)} />
        ))}
        {queue
          ? local.map((r, i) => (
              <LocalThumb
                key={r.id}
                queue={queue}
                r={r}
                onOpen={() => setView(serverItems.length + i)}
              />
            ))
          : null}
        {Array.from({ length: preparing }).map((_, i) => (
          <li
            key={`p${i}`}
            className="aspect-square animate-pulse rounded-xl bg-muted"
            aria-label="Getting the picture ready"
          />
        ))}
        {!readOnly && !full ? (
          <li>
            <button
              type="button"
              disabled={!queue}
              onClick={() => setSheet("camera")}
              className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              <CameraIcon className="size-6" aria-hidden />
              {total + preparing === 0 ? "Add photo" : "Add"}
            </button>
          </li>
        ) : null}
      </ul>
      {total + preparing === 0 && emptyText ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
          <ImageOffIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {emptyText}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-800"
        >
          {error}
        </p>
      ) : null}
      {!readOnly ? (
        <button
          type="button"
          disabled={!queue}
          onClick={() => setSheet("native")}
          className="mt-2 inline-flex min-h-9 items-center gap-1.5 text-xs font-medium text-brand disabled:opacity-50"
        >
          <SmartphoneIcon className="size-3.5" aria-hidden />
          Use the phone’s own camera app or choose from the library
        </button>
      ) : null}
      <CameraSheet
        open={sheet !== null}
        mode={sheet ?? "camera"}
        title={title ?? "Photos"}
        onClose={() => setSheet(null)}
        onDone={(shots) => void addAll(shots)}
      />
      {view !== null ? (
        <PhotoViewer
          items={views}
          start={view}
          onClose={() => setView(null)}
          onRemove={readOnly ? undefined : doRemove}
        />
      ) : null}
    </section>
  );
}
