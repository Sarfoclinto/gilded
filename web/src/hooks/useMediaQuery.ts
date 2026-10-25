import { useSyncExternalStore } from 'react';

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Desktop layout (sidebar) from 1024px; below that it is the phone/tablet layout (bottom tabs + drawer). */
export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');

/** Mobile layout */
export const useIsMobile = () => useMediaQuery('(max-width: 1023px)');
