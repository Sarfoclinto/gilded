import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { request } from "@/shared/api/client";

/**
 * The towns gold is brought from. The company's list is small, so the device keeps all of it and the picker works offline.
 * A town typed at the counter is remembered here at once (with an id made on the device) and reaches the server together with
 * the purchase, so adding a town never waits for a connection. Wiped on sign-out like the other cached lists.
 */
const KEY = "gold.towns.v1";

export const townSchema = z.object({
  id: z.string(),
  name: z.string(),
  uses: z.number().optional(),
});
export type Town = z.infer<typeof townSchema>;

/** Case, spaces and punctuation do not matter: "obuasi " is "Obuasi". Mirrors gold.town_key on the server. */
export const townKey = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

/** Collapse runs of spaces and trim, the way the server tidies a name. */
export const tidyTown = (s: string) => s.replace(/\s+/g, " ").trim();

interface TownState {
  fetchedAt: number;
  towns: Town[];
  /** Added on this device and not yet confirmed by the server. */
  pending: Town[];
  replace: (towns: Town[]) => void;
  remember: (t: Town) => void;
  clear: () => void;
}

export const useTowns = create<TownState>()(
  persist(
    (set) => ({
      fetchedAt: 0,
      towns: [],
      pending: [],
      replace: (towns) =>
        set((s) => ({
          fetchedAt: Date.now(),
          towns,
          pending: s.pending.filter(
            (p) => !towns.some((t) => townKey(t.name) === townKey(p.name)),
          ),
        })),
      remember: (t) =>
        set((s) => ({
          pending: [
            t,
            ...s.pending.filter((p) => townKey(p.name) !== townKey(t.name)),
          ].slice(0, 200),
        })),
      clear: () => set({ fetchedAt: 0, towns: [], pending: [] }),
    }),
    { name: KEY, version: 1 },
  ),
);

export const clearTowns = () => {
  useTowns.getState().clear();
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
};

/** Every town the device knows, most used first, then the ones just added here. */
export function allTowns(towns: Town[], pending: Town[]): Town[] {
  const have = new Set(towns.map((t) => townKey(t.name)));
  return [...towns, ...pending.filter((p) => !have.has(townKey(p.name)))];
}

/** Towns matching what was typed (a word of the name may start with it, or the letters may appear anywhere). */
export function searchTowns(list: Town[], q: string, limit = 50): Town[] {
  const k = townKey(q);
  if (!k) return list.slice(0, limit);
  const rank = (t: Town) => {
    const n = townKey(t.name);
    return n.startsWith(k) ? 0 : n.includes(k) ? 1 : -1;
  };
  return list
    .map((t) => ({ t, r: rank(t) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r)
    .slice(0, limit)
    .map((x) => x.t);
}

/** Refresh the list; failures are silent (the copy on the device keeps working). */
export async function refreshTowns(): Promise<void> {
  if (Date.now() - useTowns.getState().fetchedAt < 5 * 60 * 1000) return;
  try {
    useTowns
      .getState()
      .replace(
        await request({ method: "get", url: "/towns" }, z.array(townSchema)),
      );
  } catch {
    /* offline */
  }
}
