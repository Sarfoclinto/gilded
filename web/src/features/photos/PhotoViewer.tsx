import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  Share2Icon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { formatBytes, type PhotoRecord } from "./model";
import type { PhotoQueue } from "./queue";

/** One picture you can pinch, double-tap and drag. At normal size, swiping moves to the next picture. */
function ZoomImage({ src, fallback }: { src: string; fallback?: string }) {
  const [t, setT] = useState({ s: 1, x: 0, y: 0 });
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; s: number } | null>(null);
  const dist = () => {
    const [a, b] = [...pts.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const clamp = (s: number) => Math.min(Math.max(s, 1), 6);

  return (
    <div
      className="relative size-full overflow-hidden"
      style={{ touchAction: t.s > 1 ? "none" : "pan-x" }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pts.current.size === 2) pinch.current = { d: dist(), s: t.s };
      }}
      onPointerMove={(e) => {
        const prev = pts.current.get(e.pointerId);
        if (!prev) return;
        pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pts.current.size === 2 && pinch.current) {
          const s = clamp((pinch.current.s * dist()) / pinch.current.d);
          setT((c) => ({ ...c, s, ...(s === 1 ? { x: 0, y: 0 } : {}) }));
        } else if (pts.current.size === 1 && t.s > 1) {
          setT((c) => ({
            ...c,
            x: c.x + e.clientX - prev.x,
            y: c.y + e.clientY - prev.y,
          }));
        }
      }}
      onPointerUp={(e) => {
        pts.current.delete(e.pointerId);
        pinch.current = null;
        if (t.s < 1.05) setT({ s: 1, x: 0, y: 0 });
      }}
      onPointerCancel={(e) => {
        pts.current.delete(e.pointerId);
        pinch.current = null;
      }}
      onDoubleClick={() =>
        setT((c) => (c.s > 1 ? { s: 1, x: 0, y: 0 } : { s: 2.5, x: 0, y: 0 }))
      }
      onWheel={(e) => {
        const s = clamp(t.s - e.deltaY * 0.002);
        setT((c) => ({ ...c, s, ...(s === 1 ? { x: 0, y: 0 } : {}) }));
      }}
    >
      <img
        src={src || fallback || undefined}
        alt="Photo"
        draggable={false}
        className="absolute inset-0 size-full select-none object-contain"
        style={{
          transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})`,
          transition: pts.current.size ? "none" : "transform 120ms ease-out",
        }}
      />
    </div>
  );
}

/** A picture's address on screen. `dispose` frees it when the viewer lets go (for pictures made from a local file). */
export interface Loaded {
  url: string;
  dispose?: () => void;
}

/** One picture in the viewer, wherever it lives: on this device waiting to be sent, or on the server. */
export interface PhotoView {
  id: string;
  caption: string;
  /** Whether the person looking may take it off the screen. */
  removable: boolean;
  /** Keep this one inside the app (customer IDs): no Share button. */
  noShare?: boolean;
  thumb?: () => Promise<Loaded | undefined>;
  full: () => Promise<Loaded | undefined>;
}

/** Shows the small version at once, then the full picture when it has loaded. */
function Slide({ item }: { item: PhotoView }) {
  const [full, setFull] = useState("");
  const [thumb, setThumb] = useState("");
  useEffect(() => {
    let alive = true;
    const held: Loaded[] = [];
    const keep = (l: Loaded | undefined, set: (u: string) => void) => {
      if (!l) return;
      if (!alive) {
        l.dispose?.();
        return;
      }
      held.push(l);
      set(l.url);
    };
    void item
      .thumb?.()
      .then((l) => keep(l, setThumb))
      .catch(() => undefined);
    void item
      .full()
      .then((l) => keep(l, setFull))
      .catch(() => undefined);
    return () => {
      alive = false;
      held.forEach((l) => l.dispose?.());
    };
    // the same picture keeps its slide; a new list of views must not reload it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);
  return <ZoomImage src={full} fallback={thumb} />;
}

/** Views of pictures that are only on this device (waiting to be sent), from the queue. */
export function viewsFromRecords(
  records: readonly PhotoRecord[],
  queue: PhotoQueue,
): PhotoView[] {
  const blobLoad =
    (get: () => Blob | undefined | Promise<Blob | undefined>) =>
    async (): Promise<Loaded | undefined> => {
      const b = await get();
      if (!b) return undefined;
      const url = URL.createObjectURL(b);
      return { url, dispose: () => URL.revokeObjectURL(url) };
    };
  return records.map((r) => ({
    id: r.id,
    removable: true,
    caption: `${r.width}×${r.height} · ${formatBytes(r.size)} (was ${formatBytes(r.originalSize)}) · ${r.source} · ${whenText(r.takenAt)}${r.stamped ? " · stamped" : ""}`,
    thumb: blobLoad(() => queue.thumb(r.id)),
    full: blobLoad(() => queue.file(r.id)),
  }));
}

export const whenText = (iso: string) =>
  new Date(iso)
    .toLocaleString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(/,/g, "");

/** Hands the picture to the phone's share sheet (WhatsApp is one of its choices). Where the browser cannot share files, the picture is saved instead. */
async function share(r: PhotoView) {
  try {
    const l = await r.full();
    if (!l) return;
    const blob = await (await fetch(l.url)).blob();
    const file = new File([blob], `gilded-${r.id.slice(0, 8)}.jpg`, {
      type: "image/jpeg",
    });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text: r.caption });
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  } catch {
    /* the person closed the share sheet */
  }
}

/** Full-screen viewer: swipe or arrow keys between pictures, pinch or double-tap to zoom, details underneath. */
export function PhotoViewer({
  items,
  start,
  onClose,
  onRemove,
  personal = false,
}: {
  items: readonly PhotoView[];
  start: number;
  onClose: () => void;
  onRemove?: (item: PhotoView) => void | Promise<void>;
  /** A picture of the person's own (My pictures): removing it deletes it for good, so the words say so. */ personal?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(start);
  const go = (n: number) => {
    const el = scroller.current;
    if (!el) return;
    const k = Math.min(Math.max(n, 0), items.length - 1);
    el.scrollTo({ left: k * el.clientWidth, behavior: "smooth" });
  };
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = start * el.clientWidth;
  }, [start]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(i + 1);
      else if (e.key === "ArrowLeft") go(i - 1);
    };
    window.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, items.length]);

  const r = items[Math.min(i, items.length - 1)];
  if (!r) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[1100] flex flex-col bg-black text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Photo"
    >
      <div className="flex items-center justify-between px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onClose}
          className="flex size-11 items-center justify-center rounded-full hover:bg-white/10"
          aria-label="Close"
        >
          <XIcon className="size-5" />
        </button>
        <span className="text-sm font-semibold">
          {i + 1} of {items.length}
        </span>
        <div className="flex items-center">
          {r.noShare ? null : (
            <button
              type="button"
              onClick={() => void share(r)}
              className="flex size-11 items-center justify-center rounded-full hover:bg-white/10"
              aria-label="Share this photo"
            >
              <Share2Icon className="size-5" />
            </button>
          )}
          {onRemove && r.removable ? (
            <button
              type="button"
              onClick={() => setAsking(true)}
              className="flex size-11 items-center justify-center rounded-full hover:bg-white/10"
              aria-label={
                personal ? "Delete this picture" : "Remove this photo"
              }
            >
              <Trash2Icon className="size-5" />
            </button>
          ) : (
            <span className="size-11" />
          )}
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          className="flex size-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]"
          onScroll={(e) =>
            setI(
              Math.round(
                e.currentTarget.scrollLeft /
                  Math.max(e.currentTarget.clientWidth, 1),
              ),
            )
          }
        >
          {items.map((x) => (
            <div key={x.id} className="size-full shrink-0 snap-center">
              <Slide item={x} />
            </div>
          ))}
        </div>
        {i > 0 ? (
          <button
            type="button"
            onClick={() => go(i - 1)}
            className="absolute left-2 top-1/2 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 hover:bg-black/70 sm:flex"
            aria-label="Previous"
          >
            <ChevronLeftIcon className="size-6" />
          </button>
        ) : null}
        {i < items.length - 1 ? (
          <button
            type="button"
            onClick={() => go(i + 1)}
            className="absolute right-2 top-1/2 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 hover:bg-black/70 sm:flex"
            aria-label="Next"
          >
            <ChevronRightIcon className="size-6" />
          </button>
        ) : null}
      </div>
      {asking && onRemove ? (
        <div
          className="absolute inset-x-0 bottom-0 z-10 space-y-3 rounded-t-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-black shadow-2xl"
          role="alertdialog"
          aria-label={personal ? "Delete this picture?" : "Remove this photo?"}
        >
          <p className="font-semibold">
            {personal ? "Delete this picture?" : "Remove this photo?"}
          </p>
          <p className="text-sm text-black/70">
            {personal
              ? "It is deleted for good and cannot be brought back."
              : "It will no longer show. A record that it was taken, and who removed it, is kept."}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setAsking(false)}
              className="min-h-11 rounded-lg border border-black/20 font-medium"
            >
              Keep it
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void Promise.resolve(onRemove(r)).finally(() => {
                  setBusy(false);
                  setAsking(false);
                });
              }}
              className="min-h-11 rounded-lg bg-red-600 font-semibold text-white disabled:opacity-60"
            >
              {busy
                ? personal
                  ? "Deleting…"
                  : "Removing…"
                : personal
                  ? "Delete"
                  : "Remove"}
            </button>
          </div>
        </div>
      ) : null}
      <p className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 text-center text-xs text-white/70">
        {r.caption}
      </p>
    </div>,
    document.body,
  );
}
