import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Row } from "./rows";

/**
 * The last few things each person opened from the search, offered again when the search is opened empty.
 * Kept on the device per person; wiped with "Forget this device" and when a different company signs in, like the customer copy.
 */
const KEY = "gold.search.recent.v1";
const MAX = 6;

export type RecentRow = Pick<
  Row,
  "key" | "group" | "title" | "subtitle" | "href" | "state"
>;

interface State {
  byUser: Record<string, RecentRow[]>;
  remember: (userId: string, row: Row) => void;
  forget: (userId: string, key: string) => void;
  clear: () => void;
}

export const useRecentSearch = create<State>()(
  persist(
    (set) => ({
      byUser: {},
      remember: (userId, row) =>
        set((s) => {
          const mine = s.byUser[userId] ?? [];
          const item: RecentRow = {
            key: row.key,
            group: row.group,
            title: row.title,
            subtitle: row.subtitle,
            href: row.href,
            state: row.state,
          };
          return {
            byUser: {
              ...s.byUser,
              [userId]: [item, ...mine.filter((r) => r.key !== row.key)].slice(
                0,
                MAX,
              ),
            },
          };
        }),
      forget: (userId, key) =>
        set((s) => ({
          byUser: {
            ...s.byUser,
            [userId]: (s.byUser[userId] ?? []).filter((r) => r.key !== key),
          },
        })),
      clear: () => set({ byUser: {} }),
    }),
    { name: KEY, version: 1 },
  ),
);

export const clearRecentSearches = () => {
  useRecentSearch.getState().clear();
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
};
