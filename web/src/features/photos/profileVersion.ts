import { create } from "zustand";

/** Goes up whenever a new profile picture finishes sending, so avatars on screen ask for the new one. */
export const useProfileVersion = create<{ version: number; bump: () => void }>(
  (set) => ({
    version: 0,
    bump: () => set((s) => ({ version: s.version + 1 })),
  }),
);
