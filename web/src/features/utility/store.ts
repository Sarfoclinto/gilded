import { create } from "zustand";

/** Whether the calculator panel is open. Per session only; it never holds or saves anything by itself. */
export const useUtilityPanel = create<{
  open: boolean;
  toggle: () => void;
  setOpen: (v: boolean) => void;
}>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
}));
