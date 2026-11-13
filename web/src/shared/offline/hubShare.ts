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

/** The server answer the hub counts from. Any computer with a connection hands it over; the others can then count from it too. */
export interface HubBase {
  state: unknown;
  asOf: string;
}

interface PeerState {
  /** What the branch has saved that the hub's server answer does not include yet (every computer's, this one's too). */
  entries: PeerCommand[];
  lastSeq: number;
  snapshot: HubBase | null;
  add: (e: PeerCommand[]) => void;
  /** Take the hub's current picture as it is: entries the server has since confirmed drop out. */
  replace: (entries: PeerCommand[], snapshot: HubBase | null) => void;
  reset: () => void;
}

export const usePeers = create<PeerState>((set) => ({
  entries: [],
  lastSeq: 0,
  snapshot: null,
  replace: (entries, snapshot) =>
    set({
      entries,
      snapshot,
      lastSeq: entries.reduce((m, e) => Math.max(m, e.seq), 0),
    }),
  add: (incoming) =>
    set((s) => {
      const known = new Set(s.entries.map((e) => e.command.id));
      const fresh = incoming.filter((e) => !known.has(e.command.id));
      return {
        entries: [...s.entries, ...fresh],
        lastSeq: Math.max(s.lastSeq, ...incoming.map((e) => e.seq)),
      };
    }),
  reset: () => set({ entries: [], lastSeq: 0, snapshot: null }),
}));

export type Gate =
  | { status: "solo" }
  | { status: "shared"; seq: number }
  | { status: "taken"; short: Lines; reason?: "day-open" | "day-not-open" };

/** What the branch shares through its hub: everything that moves notes, and opening and closing the day (one open day per branch). */
export const SHAREABLE: ReadonlySet<string> = new Set([
  "drawer.movement",
  "drawer.exchange",
  "transaction.create",
  "transaction.pay",
  "day.open",
  "day.close",
]);
const shareable = (type: string) => SHAREABLE.has(type);

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
  if (r.data.taken)
    return r.data.reason
      ? { status: "taken", short: r.data.short, reason: r.data.reason }
      : { status: "taken", short: r.data.short };
  return { status: "shared", seq: r.data.seq };
}

const word = (short: Lines) =>
  Object.entries(short)
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([d, n]) => `${n} × GHS ${d}`)
    .join(", ");

export const takenMessage = (
  short: Lines,
  reason?: "day-open" | "day-not-open",
) =>
  reason === "day-open"
    ? "The day was just opened on another computer. Nothing was saved here. Go back to the drawer: it is already open."
    : reason === "day-not-open"
      ? "This day was just closed on another computer. Nothing was saved here. Go back to the drawer to see it."
      : `Another computer just used some of those notes (short by ${word(short)}). Choose the notes again.`;

/**
 * Everything not yet at the server, in one order, for working out the drawer: what the hub has numbered first (in its order, whoever made it),
 * then what this computer made that the hub has not seen yet (in the order it was made). The order matters now that openings and closings
 * are among them: a purchase belongs to the day that was open when it was made.
 */
export function orderWaiting<T extends { id: string }>(
  own: (T & { createdAt: number; shared?: { seq: number } })[],
  others: { seq: number; command: T }[],
): T[] {
  const numbered: { seq: number; c: T }[] = [];
  const mine = new Set(own.map((e) => e.id));
  for (const e of own) if (e.shared) numbered.push({ seq: e.shared.seq, c: e });
  for (const o of others)
    if (!mine.has(o.command.id)) numbered.push({ seq: o.seq, c: o.command });
  numbered.sort((a, b) => a.seq - b.seq);
  const late = own
    .filter((e) => !e.shared)
    .sort((a, b) => a.createdAt - b.createdAt);
  return [...numbered.map((n) => n.c), ...late];
}
