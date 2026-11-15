import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/store";
import { isOnline, useConnectivity } from "@/shared/offline/connectivity";
import { sendPhoto, photoKeys } from "./api";
import type { PhotoRecord } from "./model";
import { useProfileVersion } from "./profileVersion";
import { createPhotoQueue, type PhotoQueue } from "./queue";
import { openPhotoStore } from "./store";

const Ctx = createContext<PhotoQueue | null>(null);
const NONE: readonly PhotoRecord[] = [];

/**
 * The one picture queue of the app (B60). It lives above every screen, so a picture keeps sending when the person moves on, and a picture
 * left over from an earlier session (the phone closed, no signal) goes as soon as it can. Sending never holds up anything else.
 */
export function PhotoProvider({ children }: PropsWithChildren) {
  const qc = useQueryClient();
  const status = useAuth((s) => s.status);
  const online = useConnectivity((s) => s.online);
  const [queue, setQueue] = useState<PhotoQueue | null>(null);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    let alive = true;
    void openPhotoStore().then((store) => {
      if (alive)
        setQueue(
          createPhotoQueue({
            store,
            send: sendPhoto,
            online: () =>
              isOnline() && useAuth.getState().status === "authenticated",
          }),
        );
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (queue && status === "authenticated") void queue.start();
  }, [queue, status]);
  useEffect(() => {
    if (queue && online && status === "authenticated") queue.wake();
  }, [queue, online, status]);
  useEffect(() => {
    if (!queue) return;
    const wake = () => {
      if (document.visibilityState === "visible") queue.wake();
    };
    document.addEventListener("visibilitychange", wake);
    return () => document.removeEventListener("visibilitychange", wake);
  }, [queue]);

  // when a picture has arrived on the server: refresh what shows it, then let go of the local copy (the server's copy takes over)
  useEffect(() => {
    if (!queue) return;
    return queue.subscribe(() => {
      for (const r of queue.getSnapshot()) {
        if (r.status !== "sent" || seen.current.has(r.id)) continue;
        seen.current.add(r.id);
        if (r.target?.entityType === "user")
          useProfileVersion.getState().bump();
        void Promise.allSettled([
          qc.invalidateQueries({ queryKey: photoKeys.all }),
          qc.invalidateQueries({ queryKey: ["transfers"] }),
        ]).then(() => queue.remove(r.id));
      }
    });
  }, [queue, qc]);

  return <Ctx.Provider value={queue}>{children}</Ctx.Provider>;
}

/** The app's picture queue; null for a moment while the device storage opens. */
export const usePhotoQueue = () => useContext(Ctx);

/** The pictures on this device that are waiting, sending or parked, and re-render when that changes. */
export function useQueuedPhotos(
  queue: PhotoQueue | null,
): readonly PhotoRecord[] {
  return useSyncExternalStore(
    useCallback(
      (fn: () => void) => (queue ? queue.subscribe(fn) : () => undefined),
      [queue],
    ),
    () => (queue ? queue.getSnapshot() : NONE),
  );
}
