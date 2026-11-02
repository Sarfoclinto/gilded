import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { request } from "@/shared/api/client";
import { OFFLINE_MAX_AGE_MS } from "@/shared/offline/policy";
import { customerSchema, type Customer } from "./api";

/**
 * The customers this device knows, so the picker works without a connection.
 *
 * Privacy: names and phones are kept only for the branch the user works in, for at most the offline allowance (7 days) since the last refresh,
 * and wiped when a different company signs in or by "Forget this device". It lives under its own storage key,
 * separate from the query cache, which deliberately never holds customer data.
 */
const KEY = "gold.customers.v1";
const MAX_AGE_MS = OFFLINE_MAX_AGE_MS;

interface DirectoryState {
  branchId: string | null;
  fetchedAt: number;
  people: Customer[];
  /** Customers created on this device that the server may not have yet. */
  pending: Customer[];
  replace: (branchId: string, people: Customer[]) => void;
  remember: (c: Customer) => void;
  clear: () => void;
}

export const useCustomerDirectory = create<DirectoryState>()(
  persist(
    (set) => ({
      branchId: null,
      fetchedAt: 0,
      people: [],
      pending: [],
      replace: (branchId, people) =>
        set((s) => ({
          branchId,
          fetchedAt: Date.now(),
          people,
          pending: s.pending.filter((p) => !people.some((x) => x.id === p.id)),
        })),
      remember: (c) =>
        set((s) => ({
          pending: [c, ...s.pending.filter((p) => p.id !== c.id)].slice(0, 500),
        })),
      clear: () =>
        set({ branchId: null, fetchedAt: 0, people: [], pending: [] }),
    }),
    { name: KEY, version: 1 },
  ),
);

export const clearCustomerDirectory = () => {
  useCustomerDirectory.getState().clear();
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
};

const digits = (s: string) => s.replace(/\D/g, "");
const fold = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Pure local search: every typed word must start a word in the name, digits must appear in the phone. */
export function searchLocal(
  people: Customer[],
  q: string,
  limit = 8,
): Customer[] {
  const text = fold(q.trim());
  if (!text) return [];
  const words = text.split(/\s+/).filter(Boolean);
  const d = digits(text);
  const score = (c: Customer) => {
    const name = fold(c.name);
    const phone = digits(c.phone ?? "");
    if (d.length >= 3 && phone.includes(d))
      return phone === d ? 0 : phone.endsWith(d) ? 1 : 2;
    if (words.every((w) => name.split(/\s+/).some((n) => n.startsWith(w))))
      return name.startsWith(text) ? 3 : 4;
    return -1;
  };
  return people
    .map((c) => ({ c, s: score(c) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s)
    .slice(0, limit)
    .map((x) => x.c);
}

/** Refresh the directory for a branch. Failures are silent: the old copy keeps working. */
export async function refreshDirectory(branchId: string): Promise<void> {
  const { branchId: have, fetchedAt } = useCustomerDirectory.getState();
  if (have === branchId && Date.now() - fetchedAt < 10 * 60 * 1000) return;
  try {
    const people = await request(
      { method: "get", url: "/customers", params: { branchId, limit: 1000 } },
      z.array(customerSchema),
    );
    useCustomerDirectory.getState().replace(branchId, people);
  } catch {
    /* offline: keep what we have */
  }
}

/** What the device can offer right now (empty once the copy is too old or belongs to another branch). */
export function localPeople(branchId: string | null): Customer[] {
  const s = useCustomerDirectory.getState();
  const fresh =
    s.branchId === branchId && Date.now() - s.fetchedAt < MAX_AGE_MS;
  return [...s.pending, ...(fresh ? s.people : [])];
}
