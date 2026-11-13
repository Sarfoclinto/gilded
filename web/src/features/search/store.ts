import { create } from "zustand";

/** Whether the search is open. Anything may open it (the header box, Ctrl+K, a button on a page). */
export const useSearchUi = create<{
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
