import { useEffect } from "react";
import { useAuth } from "@/features/auth/store";
import { useOutbox } from "@/shared/offline/OutboxProvider";
import { desktop, useHubState } from "@/shared/platform/platform";
import { SHAREABLE, usePeers } from "@/shared/offline/hubShare";
import { pullPeers } from "@/shared/offline/hubSync";
import {
  flushShortNotices,
  noticeFrom,
  useShortNotices,
} from "@/shared/offline/hubShort";

const inFlight = new Set<string>();

/**
 * Keeps this computer in step with its branch hub (desktop app only; shows nothing):
 *  - every few seconds, pulls what the other computers saved so the drawer here counts it;
 *  - copies commands saved while the hub could not be reached, so the others hear about them once it is back;
 *  - when the hub says such a command was short on notes, tells the server so the branch's managers get a notice (kept until it is sent).
 * With no hub, or one that is away, it does nothing and the computer works alone.
 */
export function HubSync() {
  const role = useHubState((s) => s.hub.role);
  const ready = useHubState((s) =>
    s.hub.role === "hub"
      ? !!s.hub.hub?.running
      : s.hub.role === "member" && s.hub.member?.state === "connected",
  );
  const authed = useAuth((s) => s.status === "authenticated");
  const { entries, markShared } = useOutbox();

  useEffect(() => {
    if (role === "off") usePeers.getState().reset();
  }, [role]);

  useEffect(() => {
    if (!authed || role === "off" || !ready) return;
    void pullPeers();
    const t = setInterval(() => void pullPeers(), 4000);
    return () => clearInterval(t);
  }, [authed, role, ready]);

  useEffect(() => {
    const d = desktop();
    if (!d?.hub || !authed || !ready) return;
    const unshared = entries.filter(
      (e) =>
        !e.shared &&
        e.status !== "failed" &&
        SHAREABLE.has(e.type) &&
        !!e.userId,
    );
    for (const e of unshared) {
      if (inFlight.has(e.id)) continue;
      inFlight.add(e.id);
      void d.hub.share
        .submit({
          command: { id: e.id, type: e.type, payload: e.payload },
          userId: e.userId!,
          capturedAt: new Date(e.createdAt).toISOString(),
        })
        .then((r) => {
          if (!r.ok) return;
          void markShared(e.id, r.data.seq);
          // The hub kept the entry but the drawer could not cover it: tell the branch's managers (kept until the server has it).
          const notice = noticeFrom(e, r.data);
          if (notice) {
            useShortNotices.getState().add(notice);
            void flushShortNotices();
          }
        })
        .catch(() => {})
        .finally(() => inFlight.delete(e.id));
    }
  }, [entries, authed, ready, markShared]);

  // Notices that could not be sent yet (no internet) go out as soon as there is a connection and a signed-in person.
  useEffect(() => {
    if (!authed) return;
    void flushShortNotices();
    const t = setInterval(() => void flushShortNotices(), 20000);
    return () => clearInterval(t);
  }, [authed]);

  return null;
}
