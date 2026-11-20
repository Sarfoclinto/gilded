import { useEffect, useMemo, useRef, useState } from "react";
import { CameraIcon, ClockIcon } from "lucide-react";
import { useAuth } from "@/features/auth/store";
import { fetchPicture, usePicture } from "@/features/photos/api";
import {
  usePhotoQueue,
  useQueuedPhotos,
} from "@/features/photos/PhotoProvider";
import {
  PhotoViewer,
  viewsFromRecords,
  whenText,
  type PhotoView,
} from "@/features/photos/PhotoViewer";
import { preparePhoto } from "@/features/photos/process";
import type { PhotoRecord } from "@/features/photos/model";
import type { PhotoQueue } from "@/features/photos/queue";
import { gsApi, gsPhotoUrl, useGsInvalidate, type Entry } from "./api";

function ServerThumb({ id, onOpen }: { id: string; onOpen: () => void }) {
  const url = usePicture(gsPhotoUrl(id, true));
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open the receipt photo"
      className="size-12 overflow-hidden rounded-lg border border-border bg-muted"
    >
      {url ? <img src={url} alt="" className="size-full object-cover" /> : null}
    </button>
  );
}

function LocalThumb({
  r,
  queue,
  onOpen,
}: {
  r: PhotoRecord;
  queue: PhotoQueue;
  onOpen: () => void;
}) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let made: string | undefined;
    let alive = true;
    void Promise.resolve(queue.thumb(r.id)).then((b) => {
      if (b && alive) setUrl((made = URL.createObjectURL(b)));
    });
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [queue, r.id]);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Receipt photo waiting to send"
      className="relative size-12 overflow-hidden rounded-lg border border-sky-300 bg-muted"
    >
      {url ? <img src={url} alt="" className="size-full object-cover" /> : null}
      <span className="absolute inset-0 grid place-items-center bg-black/35">
        <ClockIcon className="size-4 text-white" aria-hidden />
      </span>
    </button>
  );
}

/**
 * The receipt photos of one entry: the ones on the server (only people who can see the sheet can open them) and the ones still on this
 * device. `canAdd`: the person may add photos here (they can write on the sheet, or it is their own entry). Keepers and the person who
 * added a photo can take it off; the group's log keeps that it happened.
 */
export function EntryPhotos({
  entry,
  canAdd,
  keeper,
}: {
  entry: Entry;
  canAdd: boolean;
  keeper: boolean;
}) {
  const user = useAuth((s) => s.user);
  const queue = usePhotoQueue();
  const queued = useQueuedPhotos(queue);
  const invalidate = useGsInvalidate();
  const file = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<number | null>(null);
  const server = entry.photos ?? [];
  const serverIds = new Set(server.map((p) => p.id));
  const local = queued.filter(
    (r) =>
      r.target?.entityType === "gsentry" &&
      r.target.entityId === entry.id &&
      !serverIds.has(r.id) &&
      r.status !== "sent",
  );
  const total = server.length + local.length;

  const views: PhotoView[] = useMemo(
    () => [
      ...server.map((p) => ({
        id: p.id,
        removable: p.mine || keeper,
        noShare: true,
        caption: `Receipt · ${p.by.displayName} · ${whenText(p.at)}`,
        thumb: async () => ({
          url: await fetchPicture(gsPhotoUrl(p.id, true)),
        }),
        full: async () => ({
          url: await fetchPicture(gsPhotoUrl(p.id, false)),
        }),
      })),
      ...(queue ? viewsFromRecords(local, queue) : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      server.map((p) => p.id).join(),
      local.map((r) => r.id).join(),
      queue,
      keeper,
    ],
  );

  if (!total && !canAdd) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {server.map((p, i) => (
        <ServerThumb key={p.id} id={p.id} onOpen={() => setView(i)} />
      ))}
      {queue
        ? local.map((r, i) => (
            <LocalThumb
              key={r.id}
              r={r}
              queue={queue}
              onOpen={() => setView(server.length + i)}
            />
          ))
        : null}
      {canAdd && total < 5 ? (
        <>
          <input
            ref={file}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f || !queue || !user) return;
              const p = await preparePhoto(f, {
                source: "library",
                name: f.name,
              });
              await queue.add(
                p,
                { entityType: "gsentry", entityId: entry.id, slot: "receipt" },
                user.id,
              );
            }}
          />
          <button
            type="button"
            onClick={() => file.current?.click()}
            title="Add a receipt photo"
            className={`inline-flex items-center gap-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground print:hidden ${total ? "size-9 justify-center border border-dashed border-border" : "min-h-8 px-1"}`}
          >
            <CameraIcon className="size-3.5" aria-hidden />
            {total ? (
              <span className="sr-only">Add a receipt photo</span>
            ) : (
              "Add receipt photo"
            )}
          </button>
        </>
      ) : null}
      {view !== null && views.length ? (
        <PhotoViewer
          items={views}
          start={Math.min(view, views.length - 1)}
          onClose={() => setView(null)}
          onRemove={async (v) => {
            if (serverIds.has(v.id)) {
              await gsApi.removePhoto(v.id);
              await invalidate();
            } else await queue?.remove(v.id);
            setView(null);
          }}
        />
      ) : null}
    </div>
  );
}
