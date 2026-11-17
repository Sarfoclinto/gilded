import { authApi } from "@/features/auth/api";
import { offlineSignIn, rememberLogin } from "@/features/auth/offlineLogin";
import { useAuth } from "@/features/auth/store";
import { isApiError } from "@/shared/api/errors";
import { isOnline } from "@/shared/offline/connectivity";

/**
 * Checks the signed-in person's password to unlock. First against this device's stored check (so it works with no connection), then,
 * if this device has none or it has run out, against the server. Never signs anyone else in.
 */
export async function verifyPassword(
  password: string,
): Promise<"ok" | "wrong" | "cannot-check"> {
  const user = useAuth.getState().user;
  if (!user || !password) return "wrong";
  const local = await offlineSignIn(user.username, password);
  if (local.ok) return local.user.id === user.id ? "ok" : "wrong";
  if (local.reason === "wrong-password") return "wrong";
  if (!isOnline()) return "cannot-check";
  try {
    const session = await authApi.login({ username: user.username, password });
    if (session.user.id !== user.id) return "wrong";
    await rememberLogin(user.username, password, session.user);
    useAuth.getState().setSession(session);
    return "ok";
  } catch (e) {
    if (isApiError(e) && (e.kind === "network" || e.kind === "timeout"))
      return "cannot-check";
    return "wrong";
  }
}
