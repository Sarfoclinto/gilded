import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { clearCustomerDirectory } from "@/features/customers/directory";
import { clearTowns } from "@/features/towns/towns";
import { ApiError, isApiError } from "@/shared/api/errors";
import { useApiMutation } from "@/shared/api/hooks";
import { isOnline } from "@/shared/offline/connectivity";
import { PERSISTED_ROOTS } from "@/shared/offline/policy";
import { authApi } from "./api";
import {
  forgetOfflineLogins,
  offlineSignIn,
  rememberLogin,
} from "./offlineLogin";
import { useAuth } from "./store";
import type { LoginInput, SessionData, User } from "./schemas";

const OWNER_KEY = "gold.cacheOwner.v1";

/** The stored copy (price, customers, towns) belongs to one company. A different company signing in starts clean. */
function claimDevice(qc: QueryClient, company: string | undefined) {
  const owner = (company ?? "").trim().toLowerCase();
  try {
    const had = localStorage.getItem(OWNER_KEY);
    if (had !== null && had !== owner) wipeStoredData(qc);
    localStorage.setItem(OWNER_KEY, owner);
  } catch {
    /* storage blocked: nothing is kept anyway */
  }
}

function wipeStoredData(qc: QueryClient) {
  qc.clear();
  clearCustomerDirectory();
  clearTowns();
}

type LoginResult =
  | { kind: "online"; session: SessionData }
  | { kind: "offline"; user: User };

const offlineFailure = (reason: "unknown" | "wrong-password" | "expired") =>
  new ApiError({
    kind: "http",
    status: 401,
    code: "OFFLINE_SIGNIN",
    message:
      reason === "wrong-password"
        ? "That password does not match. Check it and try again."
        : reason === "expired"
          ? "This device has been offline too long for offline sign-in. Connect to the internet and sign in once."
          : "You cannot sign in offline yet. Sign in once with a connection on this device first.",
  });

export function useLogin() {
  const qc = useQueryClient();
  const { setSession, setOfflineSession } = useAuth.getState();
  return useApiMutation<LoginResult, LoginInput>({
    requiresOnline: false, // offline sign-in is handled below
    silent: true, // the login form shows its own inline error
    mutationFn: async (input) => {
      const offline = async (): Promise<LoginResult> => {
        const r = await offlineSignIn(
          input.company,
          input.username,
          input.password,
        );
        if (!r.ok) throw offlineFailure(r.reason);
        return { kind: "offline", user: r.user };
      };
      if (!isOnline()) return offline();
      try {
        const session = await authApi.login(input);
        await rememberLogin(
          input.company,
          input.username,
          input.password,
          session.user,
        );
        return { kind: "online", session };
      } catch (e) {
        if (isApiError(e) && (e.kind === "network" || e.kind === "timeout"))
          return offline();
        throw e;
      }
    },
    onSuccess: (r, vars) => {
      claimDevice(qc, vars.company);
      if (r.kind === "online") setSession(r.session);
      else setOfflineSession(r.user);
    },
  });
}

/** Sign out keeps what this device needs to sign back in and work offline; only the other people's screens are dropped. */
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
      qc.removeQueries({
        predicate: (q) => !PERSISTED_ROOTS.has(String(q.queryKey[0])),
      });
    },
  });
}

/** For a shared or handed-over computer: removes the stored copy, the offline sign-ins and the sign-in itself. Unsent entries stay. */
export function useForgetDevice() {
  const qc = useQueryClient();
  const clear = useAuth((s) => s.clear);
  return () => {
    forgetOfflineLogins();
    wipeStoredData(qc);
    try {
      localStorage.removeItem(OWNER_KEY);
    } catch {
      /* nothing to remove */
    }
    clear();
  };
}
