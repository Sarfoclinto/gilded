import { create } from "zustand";

/**
 * Is this device's clock right? Every answer from the server carries its time. A purchase is stamped with the device clock, so a clock that is
 * hours or days out (it happens when a computer has been off or its battery died) would put wrong times in the books, most of all after days offline.
 */
export const CLOCK_WARN_MS = 5 * 60 * 1000;

export const skewOf = (
  serverHeader: string | undefined,
  now = Date.now(),
): number | null => {
  if (!serverHeader) return null;
  const server = Date.parse(serverHeader);
  return Number.isFinite(server) ? server - now : null;
};

export const clockIsOff = (skewMs: number | null) =>
  skewMs !== null && Math.abs(skewMs) > CLOCK_WARN_MS;

/** "about 3 hours behind", "about 2 days ahead" */
export function describeSkew(skewMs: number): string {
  const abs = Math.abs(skewMs);
  const min = Math.round(abs / 60_000);
  const span =
    min < 90
      ? `${min} minutes`
      : min < 48 * 60
        ? `${Math.round(min / 60)} hours`
        : `${Math.round(min / 1440)} days`;
  return `about ${span} ${skewMs < 0 ? "ahead of" : "behind"} the server`;
}

interface ClockState {
  skewMs: number | null;
  set: (v: number) => void;
}
export const useClock = create<ClockState>((set) => ({
  skewMs: null,
  set: (skewMs) => set({ skewMs }),
}));

/** HTTP dates have one-second resolution, so ignore anything smaller than that. */
export function noteServerDate(header: string | undefined) {
  const s = skewOf(header);
  if (s !== null) useClock.getState().set(Math.abs(s) < 2000 ? 0 : s);
}
