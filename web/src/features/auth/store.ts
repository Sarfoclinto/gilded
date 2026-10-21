import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { session } from '@/shared/api/session';
import type { SessionData, User } from './schemas';

type Status = 'booting' | 'anonymous' | 'authenticated';

interface AuthState {
  status: Status;
  user: User | null;
  activeBranchId: string | null;
  setSession: (s: SessionData) => void;
  setAnonymous: () => void;
  setActiveBranch: (id: string) => void;
  clear: () => void;
}

/**
 * What is persisted: the user profile and chosen branch, so the app can paint immediately on reload
 * and keep working from cached data when offline. The access token is NOT persisted (see shared/api/session.ts).
 */
export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      status: 'booting',
      user: null,
      activeBranchId: null,
      setSession: ({ accessToken, user }) => {
        session.setToken(accessToken);
        const keep = get().activeBranchId;
        const activeBranchId = keep && user.branchIds.includes(keep) ? keep : (user.branchIds[0] ?? null);
        set({ status: 'authenticated', user, activeBranchId });
      },
      setAnonymous: () => set({ status: 'anonymous', user: null, activeBranchId: null }),
      setActiveBranch: (id) => set({ activeBranchId: id }),
      clear: () => {
        session.setToken(null);
        set({ status: 'anonymous', user: null, activeBranchId: null });
      },
    }),
    {
      name: 'gold.auth.v1',
      partialize: (s) => ({ user: s.user, activeBranchId: s.activeBranchId }),
    },
  ),
);

export const hasPermission = (user: User | null, permission: string) => !!user && user.permissions.includes(permission);
