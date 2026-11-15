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
export function ProfilePhoto() {
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
    <div className="flex items-center gap-3">
      <Avatar
        userId={user?.id}
        name={user?.displayName}
        className="size-16 text-xl"
      />
      <div className="space-y-1">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={!queue}
            onClick={() => setSheet(true)}
          >
            <CameraIcon className="mr-1.5 size-4" aria-hidden />
            {current ? "Change photo" : "Add a photo"}
          </Button>
          {current ? (
            <Button
              variant="ghost"
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
          <p className="text-xs text-muted-foreground" role="status">
            Sending your photo…
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs text-red-700">
            {error}
          </p>
        ) : null}
      </div>
      <CameraSheet
        open={sheet}
        mode="camera"
        title="Your photo"
        onClose={() => setSheet(false)}
        onDone={(shots) => void pick(shots)}
      />
    </div>
  );
}
