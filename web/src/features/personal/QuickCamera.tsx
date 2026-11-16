import { useCallback, useState } from "react";
import { CameraIcon } from "lucide-react";
import { useAuth } from "@/features/auth/store";
import { useSettings } from "@/features/settings/api";
import { CameraSheet } from "@/features/photos/CameraSheet";
import type { PhotoSource } from "@/features/photos/model";
import { usePhotoQueue } from "@/features/photos/PhotoProvider";
import { preparePhoto } from "@/features/photos/process";
import { toast } from "@/shared/ui/toast";

/**
 * Take pictures for yourself, from anywhere in the app. Each is saved on the device first and sent in the background to My pictures,
 * which only you can open. No stamp is burned in, the library is allowed, and nothing here is ever tied to a customer or a purchase.
 */
export function useQuickCamera() {
  const user = useAuth((s) => s.user);
  const enabled = useSettings()["personalPictures.enabled"];
  const queue = usePhotoQueue();
  const [open, setOpen] = useState(false);

  const keep = useCallback(
    async (shots: { blob: Blob; source: PhotoSource }[]) => {
      if (!queue || !user || !shots.length) return;
      let kept = 0;
      for (const s of shots) {
        try {
          const p = await preparePhoto(s.blob, { source: s.source });
          await queue.add(
            p,
            { entityType: "personal", entityId: user.id, slot: "other" },
            user.id,
          );
          kept++;
        } catch (e) {
          toast.error(
            e instanceof Error ? e.message : "That picture could not be kept.",
          );
        }
      }
      if (kept)
        toast.success(
          kept === 1
            ? "Saved to My pictures"
            : `${kept} pictures saved to My pictures`,
        );
    },
    [queue, user],
  );

  return {
    show: !!user && enabled,
    ready: !!queue,
    open,
    openCamera: () => setOpen(true),
    closeCamera: () => setOpen(false),
    keep,
  };
}

/**
 * The camera button. `header` is a round icon for the top bar; `fab` is the small floating button for phones and tablets, sitting just
 * above the Tools button. Hidden when the company has switched My pictures off.
 */
export function QuickCameraButton({ variant }: { variant: "header" | "fab" }) {
  const cam = useQuickCamera();
  if (!cam.show) return null;
  return (
    <>
      <button
        type="button"
        aria-label="Take a private picture"
        title="Take a private picture"
        disabled={!cam.ready}
        onClick={cam.openCamera}
        className={
          variant === "header"
            ? "grid size-10 shrink-0 place-items-center rounded-full border border-border bg-background text-foreground/80 transition-colors hover:bg-muted disabled:opacity-50"
            : "fixed right-4 bottom-[calc(8.25rem+env(safe-area-inset-bottom))] z-30 grid size-11 place-items-center rounded-full border border-gold/60 bg-navy text-gold shadow-lg disabled:opacity-50 print:hidden"
        }
      >
        <CameraIcon className="size-5" aria-hidden />
      </button>
      {/* The camera is opened only while in use; library pictures are fine here, they are only for the person themself. */}
      <CameraSheet
        open={cam.open}
        mode="camera"
        title="My pictures"
        allowLibrary
        onClose={cam.closeCamera}
        onDone={(shots) => void cam.keep(shots)}
      />
    </>
  );
}
