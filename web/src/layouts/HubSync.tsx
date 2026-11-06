import { useEffect } from "react";
import { useAuth } from "@/features/auth/store";
import { useOutbox } from "@/shared/offline/OutboxProvider";
import { desktop, useHubState } from "@/shared/platform/platform";
import { usePeers } from "@/shared/offline/hubShare";
import { pullPeers } from "@/shared/offline/hubSync";

const inFlight = new Set<string>();
const SHAREABLE = new Set([
  "drawer.movement",
  "drawer.exchange",
  "transaction.create",
  "transaction.pay",
]);

/**
 * Keeps this computer in step with its branch hub (desktop app only; shows nothing):
 *  - every few seconds, pulls what the other computers saved so the drawer here counts it;
 *  - copies commands saved while the hub could not be reached, so the others hear about them once it is back.
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
          if (r.ok) void markShared(e.id, r.data.seq);
        })
        .catch(() => {})
        .finally(() => inFlight.delete(e.id));
    }
  }, [entries, authed, ready, markShared]);

  return null;
}
