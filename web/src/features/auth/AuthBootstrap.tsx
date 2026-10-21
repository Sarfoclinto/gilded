import { useEffect, useRef, type PropsWithChildren } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { session } from '@/shared/api/session';
import { isApiError } from '@/shared/api/errors';
import { authApi } from './api';
import { useAuth } from './store';

/**
 * Runs once at start. If a profile was remembered, trade the refresh cookie for a fresh access token.
 * - refresh works      -> signed in
 * - refresh refused    -> signed out (cookie expired or revoked)
 * - no connection      -> keep the remembered profile; the app opens read-only from cache and
 *                         the first request after reconnecting refreshes the token on its own
 */
export function AuthBootstrap({ children }: PropsWithChildren) {
  const qc = useQueryClient();
  const status = useAuth((s) => s.status);
  const started = useRef(false);

  useEffect(() => {
    session.setOnSessionLost(() => {
      useAuth.getState().clear();
      qc.clear();
    });
    return () => session.setOnSessionLost(null);
  }, [qc]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const { user, setSession, setAnonymous } = useAuth.getState();
    if (!user) {
      setAnonymous();
      return;
    }
    authApi
      .refresh()
      .then(setSession)
      .catch((e: unknown) => {
        if (isApiError(e) && (e.kind === 'network' || e.kind === 'timeout')) {
          useAuth.setState({ status: 'authenticated' });
        } else {
          setAnonymous();
        }
      });
  }, []);

  if (status === 'booting') {
    return (
      <div className="grid h-full place-items-center text-sm text-muted" role="status">
        Starting…
      </div>
    );
  }
  return children;
}
