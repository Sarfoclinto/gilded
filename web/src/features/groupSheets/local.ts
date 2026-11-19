import { create } from "zustand";
import type { NewEntry } from "./api";

/**
 * What Group Sheets keeps on this device, for the signed-in person only (keys carry their id):
 *   - the entries written but not yet received by the server (the outbox), so nothing typed is lost without a connection;
 *   - the last copy of each page they opened, so it still shows offline (marked as such).
 * localStorage, wrapped: when it is unavailable the outbox lives in memory for the session and nothing breaks.
 */
const OUTBOX = (user: string) => `gold.gs.outbox.${user}`;
const SNAP = (user: string, name: string) => `gold.gs.snap.${user}.${name}`;

export interface Pending extends NewEntry {
  /** Why the last try failed and will not be retried (refused by the server); null while it is simply waiting. */
  problem: string | null;
}

const read = <T>(key: string): T | null => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
};
const write = (key: string, value: unknown) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* full or blocked: the in-memory copy still works */
  }
};

export const readSnapshot = <T>(user: string, name: string): T | null =>
  user ? (read<{ v: T }>(SNAP(user, name))?.v ?? null) : null;
export const writeSnapshot = (user: string, name: string, value: unknown) => {
  if (user)
    write(
      SNAP(user, name),
      value === null ? null : { v: value, at: Date.now() },
    );
};

interface OutboxState {
  user: string;
  items: Pending[];
  load: (user: string) => void;
  add: (e: NewEntry) => void;
  done: (id: string) => void;
  fail: (id: string, problem: string) => void;
  discard: (id: string) => void;
}

export const useGsOutbox = create<OutboxState>((set, get) => {
  const save = (items: Pending[]) => {
    const u = get().user;
    if (u) write(OUTBOX(u), items);
    set({ items });
  };
  return {
    user: "",
    items: [],
    load: (user) =>
      set({ user, items: user ? (read<Pending[]>(OUTBOX(user)) ?? []) : [] }),
    add: (e) =>
      save([
        ...get().items.filter((x) => x.id !== e.id),
        { ...e, problem: null },
      ]),
    done: (id) => save(get().items.filter((x) => x.id !== id)),
    fail: (id, problem) =>
      save(get().items.map((x) => (x.id === id ? { ...x, problem } : x))),
    discard: (id) => save(get().items.filter((x) => x.id !== id)),
  };
});
