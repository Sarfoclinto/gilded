import { useState } from "react";
import { CameraIcon, Trash2Icon } from "lucide-react";
import { useAuth } from "@/features/auth/store";
import { Button } from "@/shared/ui/Button";
import { Avatar } from "./Avatar";
import { useRemoveAttachment, useAttachments } from "./api";
import { CameraSheet } from "./CameraSheet";
import { useProfileVersion } from "./profileVersion";
import { usePhotoQueue, useQueuedPhotos } from "./PhotoProvider";
import { preparePhoto } from "./process";

/** Your own profile picture: take one or choose one. It shows beside your name everywhere once it has been sent. */
export function ProfilePhoto({
  onDark = false,
}: {
  /** Drawn on the navy banner: a bigger picture and light buttons. */ onDark?: boolean;
}) {
  const user = useAuth((s) => s.user);
  const queue = usePhotoQueue();
  const queued = useQueuedPhotos(queue);
  const mine = useAttachments("user", user?.id);
  const remove = useRemoveAttachment();
  const bump = useProfileVersion((s) => s.bump);
  const [sheet, setSheet] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = queued.some(
    (r) => r.target?.entityType === "user" && r.status !== "failed",
  );
  const current = [...(mine.data ?? [])]
    .filter((a) => a.slot === "profile")
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];

  const pick = async (
    shots: { blob: Blob; source: "camera" | "native" | "library" | "paste" }[],
  ) => {
    const last = shots[shots.length - 1];
    if (!last || !queue || !user) return;
    setError(null);
    try {
      const p = await preparePhoto(last.blob, { source: last.source });
      await queue.add(
        p,
        { entityType: "user", entityId: user.id, slot: "profile" },
        user.id,
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "That picture could not be used.",
      );
    }
  };

  return (
    <div
      className={`flex items-center gap-3 ${onDark ? "flex-col sm:flex-row sm:gap-5" : ""}`}
    >
      <Avatar
        userId={user?.id}
        name={user?.displayName}
        className={
          onDark
            ? "size-24 text-3xl ring-4 ring-gold/70 ring-offset-2 ring-offset-navy"
            : "size-16 text-xl"
        }
      />
      <div className={`space-y-1 ${onDark ? "text-center sm:text-left" : ""}`}>
        <div
          className={`flex flex-wrap gap-2 ${onDark ? "justify-center sm:justify-start" : ""}`}
        >
          <Button
            variant="secondary"
            className={
              onDark
                ? "!border-white/20 !bg-white/10 !text-white hover:!bg-white/20"
                : ""
            }
            disabled={!queue}
            onClick={() => setSheet(true)}
          >
            <CameraIcon className="mr-1.5 size-4" aria-hidden />
            {current ? "Change photo" : "Add a photo"}
          </Button>
          {current ? (
            <Button
              variant="ghost"
              className={onDark ? "!text-white/80 hover:!bg-white/10" : ""}
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate({ id: current.id }, { onSuccess: bump })
              }
            >
              <Trash2Icon className="mr-1.5 size-4" aria-hidden />
              Remove
            </Button>
          ) : null}
        </div>
        {sending ? (
          <p
            className={`text-xs ${onDark ? "text-white/70" : "text-muted-foreground"}`}
            role="status"
          >
            Sending your photo…
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className={`text-xs ${onDark ? "text-red-300" : "text-red-700"}`}
          >
            {error}
          </p>
        ) : null}
      </div>
      <CameraSheet
        open={sheet}
        mode="camera"
        allowLibrary
        title="Your photo"
        onClose={() => setSheet(false)}
        onDone={(shots) => void pick(shots)}
      />
    </div>
  );
}
