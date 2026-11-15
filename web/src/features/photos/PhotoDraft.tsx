import { useEffect, useMemo, useState } from "react";
import { CameraIcon, SmartphoneIcon, XIcon } from "lucide-react";
import { useAuth } from "@/features/auth/store";
import { CameraSheet } from "./CameraSheet";
import { formatBytes, type PhotoSource } from "./model";
import { PhotoViewer, whenText, type PhotoView } from "./PhotoViewer";
import { preparePhoto, type Prepared } from "./process";

/**
 * Photos taken before the thing they belong to exists (a loan that is not saved yet). They are shrunk and kept in memory on this screen;
 * when the thing is saved, the screen hands them to the photo queue with its new id. Nothing is sent before that, and nothing is required.
 */
export function PhotoDraft({
  value,
  onChange,
  title,
  hint,
  branchName,
  reference,
  max = 8,
}: {
  value: Prepared[];
  onChange: (next: Prepared[]) => void;
  title: string;
  hint?: string;
  branchName: string;
  reference?: string;
  max?: number;
}) {
  const user = useAuth((s) => s.user);
  const [sheet, setSheet] = useState<null | "camera" | "native">(null);
  const [view, setView] = useState<number | null>(null);
  const [preparing, setPreparing] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const urls = useMemo(
    () => value.map((p) => URL.createObjectURL(p.thumb)),
    [value],
  );
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  const add = async (shots: { blob: Blob; source: PhotoSource }[]) => {
    setError(null);
    setPreparing((n) => n + shots.length);
    const made: Prepared[] = [];
    for (const s of shots) {
      try {
        made.push(
          await preparePhoto(s.blob, {
            source: s.source,
            stamp: {
              branch: branchName,
              reference,
              person: user?.displayName ?? "Someone",
              at: new Date(),
            },
          }),
        );
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "That picture could not be added.",
        );
      } finally {
        setPreparing((n) => n - 1);
      }
    }
    if (made.length) onChange([...value, ...made].slice(0, max));
  };

  const views: PhotoView[] = value.map((p) => ({
    id: p.record.id,
    removable: true,
    caption: `${p.record.width}×${p.record.height} · ${formatBytes(p.record.size)} · ${p.record.source} · ${whenText(p.record.takenAt)}${p.record.stamped ? " · stamped" : ""}`,
    full: async () => {
      const u = URL.createObjectURL(p.blob);
      return { url: u, dispose: () => URL.revokeObjectURL(u) };
    },
  }));

  return (
    <section
      className="rounded-xl border border-border bg-card p-3"
      aria-label={title}
    >
      <h3 className="text-sm font-semibold">{title}</h3>
      {hint ? (
        <p className="mb-2 text-xs text-muted-foreground">{hint}</p>
      ) : null}
      <ul className="grid grid-cols-4 gap-2 sm:grid-cols-5">
        {value.map((p, i) => (
          <li
            key={p.record.id}
            className="relative aspect-square overflow-hidden rounded-xl bg-muted"
          >
            <button
              type="button"
              onClick={() => setView(i)}
              className="block size-full"
              aria-label="Open this photo"
            >
              <img src={urls[i]} alt="" className="size-full object-cover" />
            </button>
            <button
              type="button"
              onClick={() => onChange(value.filter((x) => x !== p))}
              className="absolute right-1 top-1 grid size-7 place-items-center rounded-full bg-black/60 text-white"
              aria-label="Remove this photo"
            >
              <XIcon className="size-4" />
            </button>
          </li>
        ))}
        {Array.from({ length: preparing }).map((_, i) => (
          <li
            key={`p${i}`}
            className="aspect-square animate-pulse rounded-xl bg-muted"
            aria-label="Getting the picture ready"
          />
        ))}
        {value.length + preparing < max ? (
          <li>
            <button
              type="button"
              onClick={() => setSheet("camera")}
              className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted"
            >
              <CameraIcon className="size-6" aria-hidden />
              {value.length + preparing === 0 ? "Add photo" : "Add"}
            </button>
          </li>
        ) : null}
      </ul>
      {error ? (
        <p
          role="alert"
          className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-800"
        >
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => setSheet("native")}
        className="mt-2 inline-flex min-h-9 items-center gap-1.5 text-xs font-medium text-brand"
      >
        <SmartphoneIcon className="size-3.5" aria-hidden />
        Use the phone’s own camera app or choose from the library
      </button>
      <CameraSheet
        open={sheet !== null}
        mode={sheet ?? "camera"}
        title={title}
        onClose={() => setSheet(null)}
        onDone={(shots) => void add(shots)}
      />
      {view !== null ? (
        <PhotoViewer
          items={views}
          start={view}
          onClose={() => setView(null)}
          onRemove={(v) => {
            onChange(value.filter((x) => x.record.id !== v.id));
            if (value.length <= 1) setView(null);
          }}
        />
      ) : null}
    </section>
  );
}
