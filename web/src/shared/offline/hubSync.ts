import { desktop, useHubState } from "@/shared/platform/platform";
import { hubReady, usePeers } from "./hubShare";

/** Hands the hub the server's latest day state (any computer with a connection may). Quietly does nothing without a hub. */
export function pushSnapshot(state: { asOf: string }) {
  const d = desktop();
  if (!d?.hub || useHubState.getState().hub.role === "off" || !hubReady())
    return;
  void d.hub.share.snapshot(state, state.asOf).catch(() => {});
}

/** One round of catching up: pull what the other computers did since the last number seen. */
export async function pullPeers(): Promise<void> {
  const d = desktop();
  if (!d?.hub || !hubReady()) return;
  const r = await d.hub.share
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
