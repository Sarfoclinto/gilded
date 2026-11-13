import { desktop, useHubState } from "@/shared/platform/platform";
import { hubReady, usePeers } from "./hubShare";

const usable = () => {
  const d = desktop();
  return d?.hub && useHubState.getState().hub.role !== "off" && hubReady()
    ? d.hub
    : null;
};

// ---- Telling the hub what the server has ---------------------------------------------------------------------------------------
// When this computer's entry is applied by the server it leaves this computer's queue, but the hub (and so the other computers) still
// counts it. The hub may stop counting it only together with a server answer that includes it, or the drawer would jump. So: remember
// what was just sent, and when the next fresh server answer arrives, hand the hub that answer and say "these are in it".
const KEY = "gold.hubConfirm.v1";
const load = (): Record<string, number> => {
  try {
    return (
      (JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<
        string,
        number
      >) ?? {}
    );
  } catch {
    return {};
  }
};
const save = (m: Record<string, number>) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* storage blocked: the hub still learns from the server answer itself for the current day */
  }
};

/** An entry of this computer was applied by the server just now. */
export function noteSynced(id: string, now = Date.now()) {
  if (!desktop()?.hub || useHubState.getState().hub.role === "off") return;
  save({ ...load(), [id]: now });
}

/** The ids sent to the server before this answer was fetched: the answer includes them. */
export const confirmable = (
  waiting: Record<string, number>,
  fetchedAt: number,
): string[] =>
  Object.entries(waiting)
    .filter(([, at]) => at < fetchedAt)
    .map(([id]) => id);

/**
 * Hands the hub the server's latest day state (any computer with a connection may), then tells it which of this computer's entries
 * that answer includes. Quietly does nothing without a hub.
 */
export function pushSnapshot(state: { asOf: string }, fetchedAt = Date.now()) {
  const hub = usable();
  if (!hub) return;
  void (async () => {
    const r = await hub.share.snapshot(state, state.asOf).catch(() => null);
    if (!r?.ok || !hub.share.confirm) return;
    const waiting = load();
    const ids = confirmable(waiting, fetchedAt);
    if (ids.length === 0) return;
    const c = await hub.share.confirm(ids, state.asOf).catch(() => null);
    if (!c?.ok) return;
    const left = load();
    for (const id of ids) delete left[id];
    save(left);
  })();
}

/** One round of catching up: the hub's current picture (the server answer it counts from, and what the branch has saved since). */
export async function pullPeers(): Promise<void> {
  const hub = usable();
  if (!hub) return;
  if (hub.share.state) {
    const r = await hub.share.state().catch(() => null);
    if (r?.ok)
      usePeers.getState().replace(
        r.data.entries.map((e) => ({
          seq: e.seq,
          deviceId: e.deviceId,
          command: e.command,
        })),
        r.data.snapshot,
      );
    // Reached, but the hub computer does not know this request: it still runs the earlier version. Fall back to what it does know.
    if (!r || r.ok || r.unreachable) return;
  }
  // An older desktop shell, or an older hub: only "what is new since".
  const r = await hub.share
    .since(usePeers.getState().lastSeq)
    .catch(() => null);
  if (r?.ok && r.data.length > 0)
    usePeers
      .getState()
      .add(
        r.data.map((e) => ({
          seq: e.seq,
          deviceId: e.deviceId,
          command: e.command,
        })),
      );
}
