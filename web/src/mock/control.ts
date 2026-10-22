import { useConnectivity } from '@/shared/offline/connectivity';

/**
 * Dev only: pretend the server is unreachable, to try the offline behaviour without a backend.
 * The header badge toggles this when the mock API is on.
 */
const KEY = 'mock.down';
export const isMockDown = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};
export function setMockDown(down: boolean) {
  try {
    if (down) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  useConnectivity.getState().setOnline(!down);
}
