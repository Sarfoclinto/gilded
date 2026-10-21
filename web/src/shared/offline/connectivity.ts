import { create } from 'zustand';

/**
 * What the device believes about its connection. `navigator.onLine` is only a hint (a phone on bad
 * signal reports online), so later slices also demote this to false when a request fails with a network error.
 */
interface ConnectivityState {
  online: boolean;
  setOnline: (v: boolean) => void;
}

export const useConnectivity = create<ConnectivityState>((set) => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  setOnline: (online) => set({ online }),
}));

export const isOnline = () => useConnectivity.getState().online;

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => useConnectivity.getState().setOnline(true));
  window.addEventListener('offline', () => useConnectivity.getState().setOnline(false));
}
