import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
      menuCollapsed: false,
      drawerOpen: false,
      setCollapsed: (menuCollapsed) => set({ menuCollapsed }),
      openDrawer: () => set({ drawerOpen: true }),
      closeDrawer: () => set({ drawerOpen: false }),
    }),
    { name: 'gold.ui.v1', partialize: (s) => ({ menuCollapsed: s.menuCollapsed }) },
  ),
);
