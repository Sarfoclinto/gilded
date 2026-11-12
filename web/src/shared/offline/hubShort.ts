import { create } from "zustand";
import { persist } from "zustand/middleware";
import { requestVoid } from "@/shared/api/client";
import { ApiError } from "@/shared/api/errors";

/**
 * "The drawer ran short at the hub" notices for managers.
 *
 * The branch hub records every entry it is given, even when the drawer cannot cover it (reality wins). When it says so, the computer that
 * sent the entry tells the server, which notifies the branch's managers once per entry. The notice is kept on this computer until the server
 * has it, so a branch with no internet still tells its managers as soon as it is back. Repeats are harmless (the server keeps one per entry).
 */
export interface ShortNotice {
  /** The entry's command id: one notice per entry. */
  commandId: string;
  branchId: string;
  short: Record<string, number>;
  capturedAt: string;
}

interface State {
  pending: ShortNotice[];
  add: (n: ShortNotice) => void;
  remove: (commandId: string) => void;
}

export const useShortNotices = create<State>()(
  persist(
    (set) => ({
      pending: [],
      add: (n) =>
        set((s) =>
          s.pending.some((p) => p.commandId === n.commandId)
            ? s
            : { pending: [...s.pending, n] },
        ),
      remove: (commandId) =>
        set((s) => ({
          pending: s.pending.filter((p) => p.commandId !== commandId),
        })),
    }),
    { name: "gold.hubShort.v1", partialize: (s) => ({ pending: s.pending }) },
  ),
);

/** Whether a hub answer means "recorded, but the drawer was short", and if so the notice to send. Anything else (covered, refused, no branch) gives null. */
export function noticeFrom(
  entry: { id: string; payload: unknown; createdAt: number },
  answer: { covered: boolean; taken?: boolean; short: Record<string, number> },
): ShortNotice | null {
  if (answer.covered || answer.taken) return null;
  const short = Object.fromEntries(
    Object.entries(answer.short ?? {}).filter(
      ([, n]) => Number.isInteger(n) && n > 0,
    ),
  );
  if (Object.keys(short).length === 0) return null;
  const branchId = (entry.payload as { branchId?: unknown } | null)?.branchId;
  if (typeof branchId !== "string" || !branchId) return null;
  return {
    commandId: entry.id,
    branchId,
    short,
    capturedAt: new Date(entry.createdAt).toISOString(),
  };
}

type Send = (n: ShortNotice) => Promise<void>;
const post: Send = (n) =>
  requestVoid({ method: "post", url: "/notifications/hub-short", data: n });

let flushing = false;

/**
 * Sends the waiting notices. A notice leaves the list once the server has it, or once the server has said it will never take it
 * (the person may no longer work in that branch, say), so one bad notice cannot block the rest. A network problem keeps everything for later.
 */
export async function flushShortNotices(send: Send = post): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    for (const n of [...useShortNotices.getState().pending]) {
      try {
        await send(n);
        useShortNotices.getState().remove(n.commandId);
      } catch (e) {
        const refused =
          e instanceof ApiError &&
          e.kind === "http" &&
          e.status !== undefined &&
          e.status >= 400 &&
          e.status < 500 &&
          e.status !== 401 &&
          e.status !== 408 &&
          e.status !== 429;
        if (refused) useShortNotices.getState().remove(n.commandId);
        else return; // offline, signed out, busy: try again later
      }
    }
  } finally {
    flushing = false;
  }
}
