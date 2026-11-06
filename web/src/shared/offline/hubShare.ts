import { create } from "zustand";
import type { Lines } from "@gold/core";
import { desktop, useHubState } from "@/shared/platform/platform";

/**
 * The screens' side of the branch hub (desktop app, computers that joined a hub or are the hub).
 *
 * - Before a command that moves notes is saved, the hub is asked to reserve them (`gate`). If another computer just used them, the save is
 *   refused with a message and the teller chooses again. If the hub cannot be reached, nothing blocks: the computer works alone as before.
 * - The commands the other computers saved are pulled in (`usePeers`), so this computer's drawer shows them.
 * - Commands saved while the hub was unreachable are copied to it later (see HubSync).
 * Every computer still sends its own commands to the server itself; the hub only keeps the branch's order and watches the notes.
 */
export interface PeerCommand {
  seq: number;
  deviceId: string;
  command: { id: string; type: string; payload: unknown };
}

interface PeerState {
  entries: PeerCommand[];
  lastSeq: number;
  add: (e: PeerCommand[]) => void;
  reset: () => void;
}

export const usePeers = create<PeerState>((set) => ({
  entries: [],
  lastSeq: 0,
  add: (incoming) =>
    set((s) => {
      const known = new Set(s.entries.map((e) => e.command.id));
      const fresh = incoming.filter((e) => !known.has(e.command.id));
      return {
        entries: [...s.entries, ...fresh],
        lastSeq: Math.max(s.lastSeq, ...incoming.map((e) => e.seq)),
      };
    }),
  reset: () => set({ entries: [], lastSeq: 0 }),
}));

export type Gate =
  | { status: "solo" }
  | { status: "shared"; seq: number }
  | { status: "taken"; short: Lines };

const shareable = (type: string) =>
  type === "drawer.movement" ||
  type === "drawer.exchange" ||
  type === "transaction.create" ||
  type === "transaction.pay";

/** Can this computer talk to a hub right now, as far as it knows? (A member that already knows its hub is away does not wait for it.) */
export function hubReady(): boolean {
  const h = useHubState.getState().hub;
  if (h.role === "hub") return !!h.hub?.running;
  return h.role === "member" && h.member?.state === "connected";
}

export async function gate(
  cmd: { id: string; type: string; payload: unknown },
  userId: string,
  capturedAt: string,
): Promise<Gate> {
  const d = desktop();
  if (!d?.hub || !shareable(cmd.type) || !hubReady()) return { status: "solo" };
  const r = await d.hub.share
    .submit({ command: cmd, userId, capturedAt, strict: true })
    .catch(() => null);
  if (!r || !r.ok) return { status: "solo" };
  if (r.data.taken) return { status: "taken", short: r.data.short };
  return { status: "shared", seq: r.data.seq };
}

const word = (short: Lines) =>
  Object.entries(short)
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([d, n]) => `${n} × GHS ${d}`)
    .join(", ");

export const takenMessage = (short: Lines) =>
  `Another computer just used some of those notes (short by ${word(short)}). Choose the notes again.`;
