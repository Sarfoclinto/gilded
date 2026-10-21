import { useQueryClient } from '@tanstack/react-query';
import { useApiMutation } from '@/shared/api/hooks';
import { authApi } from './api';
import { useAuth } from './store';

export function useLogin() {
  const setSession = useAuth((s) => s.setSession);
  return useApiMutation({
    mutationFn: authApi.login,
    silent: true, // the login form shows its own inline error
    onSuccess: (data) => setSession(data),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  const clear = useAuth((s) => s.clear);
  return useApiMutation({
    // Sign-out must work offline too: clear locally even if the server cannot be told.
    mutationFn: async () => {
      try {
        await authApi.logout();
      } catch {
        /* the refresh cookie expires on its own */
      }
    },
    requiresOnline: false,
    onSuccess: () => {
      clear();
      qc.clear();
    },
  });
}
