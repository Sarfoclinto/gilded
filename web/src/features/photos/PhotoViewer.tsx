import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
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

/** Loads the full picture from the device (or shows the thumbnail while it loads, or when only the thumbnail is kept). */
function Slide({ record, queue }: { record: PhotoRecord; queue: PhotoQueue }) {
  const [full, setFull] = useState("");
  const [thumb, setThumb] = useState("");
  useEffect(() => {
    let a = "",
      b = "",
      alive = true;
    const th = queue.thumb(record.id);
    if (th) {
      b = URL.createObjectURL(th);
      setThumb(b);
    }
    void queue.file(record.id).then((f) => {
      if (alive && f) {
        a = URL.createObjectURL(f);
        setFull(a);
      }
    });
    return () => {
      alive = false;
      if (a) URL.revokeObjectURL(a);
      if (b) URL.revokeObjectURL(b);
    };
  }, [record.id, queue]);
  return <ZoomImage src={full} fallback={thumb} />;
}

/** Full-screen viewer: swipe or arrow keys between pictures, pinch or double-tap to zoom, details underneath. */
export function PhotoViewer({
  records,
  start,
  queue,
  onClose,
  onRemove,
}: {
  records: readonly PhotoRecord[];
  start: number;
  queue: PhotoQueue;
  onClose: () => void;
  onRemove?: (r: PhotoRecord) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(start);
  const go = (n: number) => {
    const el = scroller.current;
    if (!el) return;
    const k = Math.min(Math.max(n, 0), records.length - 1);
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
  }, [i, records.length]);

  const r = records[Math.min(i, records.length - 1)];
  if (!r) return null;
  const when = new Date(r.takenAt)
    .toLocaleString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(/,/g, "");
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
          {i + 1} of {records.length}
        </span>
        {onRemove ? (
          <button
            type="button"
            onClick={() => onRemove(r)}
            className="flex size-11 items-center justify-center rounded-full hover:bg-white/10"
            aria-label="Remove this photo"
          >
            <Trash2Icon className="size-5" />
          </button>
        ) : (
          <span className="size-11" />
        )}
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
          {records.map((x) => (
            <div key={x.id} className="size-full shrink-0 snap-center">
              <Slide record={x} queue={queue} />
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
        {i < records.length - 1 ? (
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
      <p className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 text-center text-xs text-white/70">
        {r.width}×{r.height} · {formatBytes(r.size)} (was{" "}
        {formatBytes(r.originalSize)}) · {r.source} · {when}
        {r.stamped ? " · stamped" : ""}
      </p>
    </div>,
    document.body,
  );
}
