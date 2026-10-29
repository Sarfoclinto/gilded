import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UIState {
  /** Desktop sidebar collapsed to icons. */
  menuCollapsed: boolean;
  /** Phone/tablet drawer open. */
  drawerOpen: boolean;
  setCollapsed: (v: boolean) => void;
  openDrawer: () => void;
  closeDrawer: () => void;
}

export const useUI = create<UIState>()(
  persist(
    (set) => ({
      // Until the person chooses, small laptop screens start with the slim icon menu so the page gets the room.
      menuCollapsed: typeof window !== "undefined" && window.innerWidth < 1280,
      drawerOpen: false,
      setCollapsed: (menuCollapsed) => set({ menuCollapsed }),
      openDrawer: () => set({ drawerOpen: true }),
      closeDrawer: () => set({ drawerOpen: false }),
    }),
    {
      name: "gold.ui.v1",
      partialize: (s) => ({ menuCollapsed: s.menuCollapsed }),
    },
  ),
);
