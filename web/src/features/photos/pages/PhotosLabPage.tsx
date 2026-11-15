import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AlertTriangleIcon,
  CameraIcon,
  CheckIcon,
  ClockIcon,
  ImageIcon,
  RotateCcwIcon,
  SmartphoneIcon,
  WifiOffIcon,
} from "lucide-react";
import { useAuth } from "@/features/auth/store";
import { useBranchNames } from "@/features/branches/api";
import { CameraSheet } from "../CameraSheet";
import { PhotoViewer, viewsFromRecords } from "../PhotoViewer";
import {
  formatBytes,
  isPictureFile,
  summarize,
  type PhotoRecord,
  type PhotoSource,
} from "../model";
import { preparePhoto } from "../process";
import {
  createPhotoQueue,
  NetworkError,
  type PhotoQueue,
  type Sender,
} from "../queue";
import { openPhotoStore } from "../store";

const SPEEDS = [
  { key: "wifi", label: "Good Wi-Fi (2 MB/s)", bytesPerSec: 2_000_000 },
  { key: "4g", label: "Mobile data (400 KB/s)", bytesPerSec: 400_000 },
  { key: "weak", label: "Weak signal (40 KB/s)", bytesPerSec: 40_000 },
] as const;

const NONE: readonly PhotoRecord[] = [];
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      rej(new DOMException("Aborted", "AbortError"));
    });
  });

function Ring({ r }: { r: PhotoRecord }) {
  if (r.status === "sent")
    return (
      <span className="absolute bottom-1 right-1 grid size-6 place-items-center rounded-full bg-emerald-500 text-white shadow">
        <CheckIcon className="size-4" aria-label="Sent" />
      </span>
    );
  if (r.status === "failed")
    return (
      <span className="absolute inset-0 grid place-items-center bg-black/55">
        <AlertTriangleIcon
          className="size-6 text-red-300"
          aria-label="Could not be sent"
        />
      </span>
    );
  return (
    <span
      className="absolute inset-0 grid place-items-center bg-black/35"
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

function Thumb({
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
        aria-label={`Open ${r.name}`}
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
 * Photos lab (B60 spike). Not a final screen: a place to try the camera, the shrinking and the background sending on the phones and computers
 * that will really be used, and compare with WhatsApp. Nothing here is saved on the server; the "server" is a stand-in with a speed you choose.
 */
export default function PhotosLabPage() {
  const user = useAuth((s) => s.user);
  const branchId = useAuth((s) => s.activeBranchId);
  const names = useBranchNames();
  const [queue, setQueue] = useState<PhotoQueue | null>(null);
  const [sheet, setSheet] = useState<null | "camera" | "native">(null);
  const [view, setView] = useState<number | null>(null);
  const [preparing, setPreparing] = useState(0);
  const [last, setLast] = useState<{
    ms: number;
    from: number;
    to: number;
  } | null>(null);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]["key"]>("4g");
  const [failEvery, setFailEvery] = useState(false);
  const [offline, setOffline] = useState(false);
  const [stamp, setStamp] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const sim = useRef({ speed, failEvery, offline });
  sim.current = { speed, failEvery, offline };
  const count = useRef(0);

  useEffect(() => {
    let alive = true;
    const send: Sender = async ({ file }, onProgress, signal) => {
      const s = sim.current;
      if (s.offline || !navigator.onLine) throw new NetworkError();
      count.current++;
      if (s.failEvery && count.current % 3 === 0) {
        await sleep(500, signal);
        throw new Error("Simulated server error");
      }
      const bps = SPEEDS.find((x) => x.key === s.speed)!.bytesPerSec;
      const total = (file.size / bps) * 1000;
      for (let t = 0; t < total; t += 100) {
        await sleep(100, signal);
        if (sim.current.offline) throw new NetworkError();
        onProgress(Math.min(t / total, 0.99));
      }
    };
    void openPhotoStore().then(async (store) => {
      if (!alive) return;
      const q = createPhotoQueue({
        store,
        send,
        online: () => !sim.current.offline && navigator.onLine,
        keepSent: true,
      });
      setQueue(q);
      await q.start();
    });
    const wake = () =>
      setQueue((q) => {
        q?.wake();
        return q;
      });
    window.addEventListener("online", wake);
    return () => {
      alive = false;
      window.removeEventListener("online", wake);
    };
  }, []);
  useEffect(() => {
    if (!offline) queue?.wake();
  }, [offline, queue]);

  const records = useSyncExternalStore(
    useCallback(
      (fn: () => void) => (queue ? queue.subscribe(fn) : () => undefined),
      [queue],
    ),
    () => (queue ? queue.getSnapshot() : NONE),
  );
  const sum = summarize(records);

  const addAll = useCallback(
    async (items: { blob: Blob; source: PhotoSource }[]) => {
      if (!queue) return;
      setError(null);
      setPreparing((n) => n + items.length);
      for (const it of items) {
        try {
          const p = await preparePhoto(it.blob, {
            source: it.source,
            stamp: stamp
              ? {
                  branch: names[branchId ?? ""] ?? "Branch",
                  reference: "TRF-LAB-0001",
                  person: user?.displayName ?? "Someone",
                  at: new Date(),
                }
              : undefined,
          });
          await queue.add(p);
          setLast({
            ms: p.record.prepMs,
            from: p.record.originalSize,
            to: p.record.size,
          });
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "That picture could not be added.",
          );
        } finally {
          setPreparing((n) => n - 1);
        }
      }
    },
    [queue, stamp, names, branchId, user?.displayName],
  );

  // desktop: paste a picture, or drop files on the page
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter(
        isPictureFile,
      );
      if (files.length) {
        e.preventDefault();
        void addAll(files.map((f) => ({ blob: f, source: "paste" as const })));
      }
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, [addAll]);

  const facts = useMemo(
    () =>
      [
        [
          "Secure page (needed for the camera)",
          window.isSecureContext ? "yes" : "NO",
        ],
        [
          "Camera inside the app",
          typeof navigator.mediaDevices?.getUserMedia === "function"
            ? "available"
            : "not available",
        ],
        [
          "Installed as an app",
          window.matchMedia?.("(display-mode: standalone)").matches
            ? "yes"
            : "no (browser tab)",
        ],
        [
          "Pictures kept on this device",
          queue
            ? queue.durable
              ? "yes, they survive a restart"
              : "NO, memory only"
            : "…",
        ],
      ] as const,
    [queue],
  );

  return (
    <div
      className="mx-auto max-w-3xl space-y-4 p-3 sm:p-4"
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const files = Array.from(e.dataTransfer.files).filter(isPictureFile);
        if (files.length)
          void addAll(
            files.map((f) => ({ blob: f, source: "library" as const })),
          );
      }}
    >
      <div>
        <h1 className="text-xl font-bold">Photos lab</h1>
        <p className="text-sm text-muted-foreground">
          Try taking and choosing pictures on the phones and computers that will
          really be used. Nothing here reaches the server; the sending is
          simulated at the speed you choose.
        </p>
      </div>

      <section
        className={`rounded-xl border bg-card p-3 sm:p-4 ${drag ? "border-brand ring-2 ring-brand/30" : "border-border"}`}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">
              Transfer TRF-LAB-0001 · photos of the scale
            </h2>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {sum.text}
            </p>
          </div>
          {offline ? (
            <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">
              <WifiOffIcon className="size-3.5" />
              Pretending offline
            </span>
          ) : null}
        </div>

        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            disabled={!queue}
            onClick={() => setSheet("camera")}
            className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-50"
          >
            <CameraIcon className="size-5" />
            Add photos (app camera)
          </button>
          <button
            type="button"
            disabled={!queue}
            onClick={() => setSheet("native")}
            className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 font-semibold disabled:opacity-50"
          >
            <SmartphoneIcon className="size-5" />
            Add photos (phone camera app)
          </button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          On a computer you can also paste a picture (Ctrl+V) or drop files on
          this page.{" "}
          <ImageIcon className="mb-0.5 inline size-3.5" aria-hidden /> Both
          buttons also let you choose from the library, several at once.
        </p>

        {error ? (
          <p
            role="alert"
            className="mb-3 rounded-lg bg-red-50 p-2 text-sm text-red-800"
          >
            {error}
          </p>
        ) : null}

        {records.length === 0 && preparing === 0 ? (
          <p className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            No photos yet.
          </p>
        ) : (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {records.map((r, i) =>
              queue ? (
                <Thumb
                  key={r.id}
                  queue={queue}
                  r={r}
                  onOpen={() => setView(i)}
                />
              ) : null,
            )}
            {Array.from({ length: preparing }).map((_, i) => (
              <li
                key={`p${i}`}
                className="aspect-square animate-pulse rounded-xl bg-muted"
                aria-label="Getting the picture ready"
              />
            ))}
          </ul>
        )}
        {last ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Last picture: ready in{" "}
            <strong className="text-foreground">{last.ms} ms</strong>,{" "}
            {formatBytes(last.from)} →{" "}
            <strong className="text-foreground">{formatBytes(last.to)}</strong>.
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border border-border bg-card p-3 sm:p-4">
        <h2 className="mb-2 text-sm font-semibold">Try the hard cases</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">
              Connection speed (pretend)
            </span>
            <select
              value={speed}
              onChange={(e) => setSpeed(e.target.value as typeof speed)}
              className="min-h-11 w-full rounded-lg border border-border bg-background px-2"
            >
              {SPEEDS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <div className="space-y-2 text-sm">
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                className="size-4"
                checked={offline}
                onChange={(e) => setOffline(e.target.checked)}
              />
              Pretend there is no connection
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                className="size-4"
                checked={failEvery}
                onChange={(e) => setFailEvery(e.target.checked)}
              />
              Make every third send fail
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                className="size-4"
                checked={stamp}
                onChange={(e) => setStamp(e.target.checked)}
              />
              Burn in the stamp (branch, reference, date, person)
            </label>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-3 sm:p-4">
        <h2 className="mb-2 text-sm font-semibold">This device</h2>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {facts.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{k}</dt>
              <dd
                className={`font-medium ${v === "NO" || v === "not available" ? "text-red-700" : ""}`}
              >
                {v}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 break-words text-[11px] text-muted-foreground">
          {navigator.userAgent}
        </p>
      </section>

      <CameraSheet
        open={sheet !== null}
        mode={sheet ?? "camera"}
        title="Scale photos"
        onClose={() => setSheet(null)}
        onDone={(shots) => void addAll(shots)}
      />
      {queue && view !== null ? (
        <PhotoViewer
          items={viewsFromRecords(records, queue)}
          start={view}
          onClose={() => setView(null)}
          onRemove={(r) => {
            void queue.remove(r.id);
            if (records.length <= 1) setView(null);
          }}
        />
      ) : null}
    </div>
  );
}
