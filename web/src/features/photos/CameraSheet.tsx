import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CameraIcon,
  CheckIcon,
  ImageIcon,
  RefreshCwIcon,
  XIcon,
  ZapIcon,
  ZapOffIcon,
} from "lucide-react";
import { useSettings } from "@/features/settings/api";
import { isPictureFile, type PhotoSource } from "./model";

export interface Shot {
  id: string;
  blob: Blob;
  url: string;
  source: PhotoSource;
}

const DEVICE_KEY = "gold.camera.device.v1";
const rememberedDevice = () => {
  try {
    return localStorage.getItem(DEVICE_KEY) || undefined;
  } catch {
    return undefined;
  }
};
const remember = (id: string) => {
  try {
    localStorage.setItem(DEVICE_KEY, id);
  } catch {
    /* private window */
  }
};

function friendly(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "The camera is blocked for this app. Allow it in the browser or phone settings, or use the buttons below to take the picture with the phone’s own camera.";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "No camera was found on this device.";
  if (name === "NotReadableError" || name === "AbortError")
    return "The camera is being used by another app. Close it and try again.";
  return "The camera could not be opened. You can still use the buttons below.";
}

/**
 * Take or choose pictures, WhatsApp style: the camera stays open for as many shots as needed, each lands in a strip you can look at or remove,
 * and "Done" hands them all back at once. `mode="native"` skips the in-app camera and uses the phone's own camera app instead (one shot at a time),
 * which is the most dependable choice on some phones. The library picker takes several pictures at once; on a computer you can also drop or paste.
 */
export function CameraSheet({
  open,
  mode,
  title = "Photos",
  allowLibrary = false,
  onClose,
  onDone,
}: {
  /** Profile pictures may come from the library even when the company keeps evidence pictures to the camera. */
  allowLibrary?: boolean;
  open: boolean;
  mode: "camera" | "native";
  title?: string;
  onClose: () => void;
  onDone: (shots: { blob: Blob; source: PhotoSource }[]) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nativeRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(
    rememberedDevice,
  );
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [torchOk, setTorchOk] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [mirror, setMirror] = useState(false);
  const [flash, setFlash] = useState(false);
  const [look, setLook] = useState<string | null>(null);

  const add = useCallback((blob: Blob, source: PhotoSource) => {
    setShots((s) => [
      ...s,
      { id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob), source },
    ]);
  }, []);

  // open and close the camera with the sheet
  useEffect(() => {
    if (!open || mode !== "camera") return;
    let cancelled = false;
    let stream: MediaStream | undefined;
    setError(null);
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          "This browser cannot open the camera inside the app. Use the buttons below.",
        );
        return;
      }
      try {
        const base: MediaTrackConstraints = deviceId
          ? { deviceId: { exact: deviceId } }
          : { facingMode: { ideal: "environment" } };
        stream = await navigator.mediaDevices.getUserMedia({
          video: { ...base, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play().catch(() => undefined);
        }
        const track = stream.getVideoTracks()[0];
        const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
        setTorchOk(!!caps.torch);
        setMirror(track?.getSettings().facingMode === "user");
        setDevices(
          (await navigator.mediaDevices.enumerateDevices()).filter(
            (d) => d.kind === "videoinput",
          ),
        );
        setReady(true);
      } catch (e) {
        if (!cancelled) setError(friendly(e));
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setReady(false);
      setTorchOn(false);
      setTorchOk(false);
    };
  }, [open, mode, deviceId]);

  // nothing left over when closed; no page scrolling behind the sheet
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
      else if (e.key === " " && ready && !look) {
        e.preventDefault();
        shoot();
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ready, look]);
  useEffect(() => {
    if (!open) clear();
  }, [open]);

  function clear() {
    setShots((s) => {
      s.forEach((x) => URL.revokeObjectURL(x.url));
      return [];
    });
    setLook(null);
  }
  function cancel() {
    clear();
    onClose();
  }
  function done() {
    const out = shots.map((s) => ({ blob: s.blob, source: s.source }));
    if (out.length) onDone(out);
    clear();
    onClose();
  }

  function shoot() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    setFlash(true);
    setTimeout(() => setFlash(false), 110);
    try {
      navigator.vibrate?.(8);
    } catch {
      /* not supported */
    }
    c.toBlob(
      (b) => {
        if (b) add(b, "camera");
      },
      "image/jpeg",
      0.92,
    );
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      setTorchOk(false);
    }
  }

  function flip() {
    if (devices.length < 2) return;
    const cur = streamRef.current?.getVideoTracks()[0]?.getSettings().deviceId;
    const i = devices.findIndex((d) => d.deviceId === cur);
    const next = devices[(i + 1) % devices.length]!.deviceId;
    remember(next);
    setDeviceId(next);
  }

  const cameraOnly = useSettings()["photos.cameraOnly"] && !allowLibrary;
  const take = (files: FileList | null, source: PhotoSource) => {
    if (cameraOnly && (source === "library" || source === "paste")) return;
    for (const f of Array.from(files ?? []))
      if (isPictureFile(f)) add(f, source);
  };

  if (!open) return null;
  const showCamera = mode === "camera" && !error;
  const preview = look ? shots.find((s) => s.id === look) : null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex flex-col bg-black text-white"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={cancel}
          className="flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-medium hover:bg-white/10"
        >
          <XIcon className="size-5" aria-hidden />
          Cancel
        </button>
        <span className="truncate text-sm font-semibold">{title}</span>
        <div className="flex min-w-24 items-center justify-end gap-1">
          {showCamera && devices.length > 2 ? (
            <select
              aria-label="Camera"
              value={
                streamRef.current?.getVideoTracks()[0]?.getSettings()
                  .deviceId ?? ""
              }
              onChange={(e) => {
                remember(e.target.value);
                setDeviceId(e.target.value);
              }}
              className="max-w-40 rounded-md bg-white/10 px-2 py-2 text-xs"
            >
              {devices.map((d, i) => (
                <option
                  key={d.deviceId}
                  value={d.deviceId}
                  className="text-black"
                >
                  {d.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>
          ) : null}
          {showCamera && torchOk ? (
            <button
              type="button"
              onClick={toggleTorch}
              aria-pressed={torchOn}
              aria-label="Torch"
              className={`flex size-11 items-center justify-center rounded-full ${torchOn ? "bg-amber-400 text-black" : "hover:bg-white/10"}`}
            >
              {torchOn ? (
                <ZapIcon className="size-5" aria-hidden />
              ) : (
                <ZapOffIcon className="size-5" aria-hidden />
              )}
            </button>
          ) : null}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {showCamera ? (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="absolute inset-0 size-full bg-black object-contain"
              style={mirror ? { transform: "scaleX(-1)" } : undefined}
            />
            {!ready ? (
              <div
                className="absolute inset-0 grid place-items-center text-sm text-white/70"
                aria-live="polite"
              >
                Opening the camera…
              </div>
            ) : null}
            <div
              className={`pointer-events-none absolute inset-0 bg-white transition-opacity duration-100 ${flash ? "opacity-70" : "opacity-0"}`}
            />
          </>
        ) : (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <div className="max-w-sm space-y-4">
              {error ? (
                <p className="text-sm text-white/80">{error}</p>
              ) : (
                <p className="text-sm text-white/80">
                  {cameraOnly
                    ? "Take the picture with the phone’s own camera."
                    : "Take the picture with the phone’s own camera, or choose from your library."}
                </p>
              )}
              <button
                type="button"
                onClick={() => nativeRef.current?.click()}
                className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 font-semibold text-black"
              >
                <CameraIcon className="size-5" aria-hidden />
                Open the camera
              </button>
            </div>
          </div>
        )}
        {preview ? (
          <div className="absolute inset-0 z-10 flex flex-col bg-black">
            <img
              src={preview.url}
              alt="Preview"
              className="min-h-0 flex-1 object-contain"
            />
            <div className="flex justify-center gap-3 p-4">
              <button
                type="button"
                onClick={() => setLook(null)}
                className="min-h-11 rounded-full bg-white/15 px-5 text-sm font-medium"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(preview.url);
                  setShots((s) => s.filter((x) => x.id !== preview.id));
                  setLook(null);
                }}
                className="min-h-11 rounded-full bg-red-600 px-5 text-sm font-medium"
              >
                Remove
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {shots.length > 0 ? (
        <ul
          className="flex gap-2 overflow-x-auto px-3 py-2"
          aria-label="Pictures taken"
        >
          {shots.map((s, i) => (
            <li key={s.id} className="shrink-0">
              <button
                type="button"
                onClick={() => setLook(s.id)}
                className="relative block size-16 overflow-hidden rounded-lg ring-2 ring-white/40"
                aria-label={`Look at picture ${i + 1}`}
              >
                <img src={s.url} alt="" className="size-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-center justify-between gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
        <div className="flex w-24 items-center gap-1">
          {cameraOnly ? null : (
            <button
              type="button"
              onClick={() => libraryRef.current?.click()}
              className="flex size-12 items-center justify-center rounded-full bg-white/15 hover:bg-white/25"
              aria-label="Choose from the library"
            >
              <ImageIcon className="size-5" aria-hidden />
            </button>
          )}
          {mode === "camera" ? (
            <button
              type="button"
              onClick={() => nativeRef.current?.click()}
              className="flex size-12 items-center justify-center rounded-full bg-white/15 hover:bg-white/25"
              aria-label="Use the phone’s camera app"
            >
              <CameraIcon className="size-5" aria-hidden />
            </button>
          ) : null}
        </div>
        {showCamera ? (
          <button
            type="button"
            onClick={shoot}
            disabled={!ready}
            aria-label="Take the picture"
            className="grid size-[4.5rem] place-items-center rounded-full border-4 border-white disabled:opacity-40"
          >
            <span className="size-14 rounded-full bg-white active:scale-90 transition-transform" />
          </button>
        ) : (
          <span className="w-[4.5rem]" />
        )}
        <div className="flex w-24 items-center justify-end gap-1">
          {showCamera && devices.length === 2 ? (
            <button
              type="button"
              onClick={flip}
              className="flex size-12 items-center justify-center rounded-full bg-white/15 hover:bg-white/25"
              aria-label="Switch camera"
            >
              <RefreshCwIcon className="size-5" aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            onClick={done}
            disabled={shots.length === 0}
            className="flex min-h-12 items-center gap-1 whitespace-nowrap rounded-full bg-emerald-500 px-4 text-sm font-semibold text-black disabled:bg-white/15 disabled:text-white/40"
          >
            <CheckIcon className="size-4" aria-hidden />
            {shots.length > 0 ? `Done (${shots.length})` : "Done"}
          </button>
        </div>
      </div>

      <input
        ref={nativeRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          take(e.target.files, "native");
          e.target.value = "";
        }}
      />
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          take(e.target.files, "library");
          e.target.value = "";
        }}
      />
    </div>,
    document.body,
  );
}
