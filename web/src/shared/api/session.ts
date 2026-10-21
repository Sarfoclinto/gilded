/**
 * The access token lives in memory only. It is never written to localStorage, so a script injected into
 * the page cannot read a long-lived credential. A page reload gets a new one from the refresh cookie.
 *
 * This module is deliberately framework-free so the axios client can use it without importing the auth feature.
 */
let accessToken: string | null = null;
let onSessionLost: (() => void) | null = null;

export const session = {
  getToken: () => accessToken,
  setToken: (token: string | null) => {
    accessToken = token;
  },
  /** The auth feature registers what should happen when the refresh token no longer works. */
  setOnSessionLost: (fn: (() => void) | null) => {
    onSessionLost = fn;
  },
  notifyLost: () => {
    accessToken = null;
    onSessionLost?.();
  },
};
