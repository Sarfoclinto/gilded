import { useEffect } from "react";
import { useAuth } from "@/features/auth/store";
import { registerThisDevice } from "@/features/sync/register";
import { useConnectivity } from "@/shared/offline/connectivity";
import { ensureDeviceKey } from "@/shared/offline/deviceKey";

/**
 * Makes sure this device has a signing key for the signed-in person (even offline, so entries made offline are signed),
 * and tells the server about it as soon as there is a connection. Shows nothing.
 */
export function DeviceRegistration() {
  const userId = useAuth((s) => s.user?.id);
  const authed = useAuth((s) => s.status === "authenticated");
  const online = useConnectivity((s) => s.online);

  useEffect(() => {
    if (!userId || !authed) return;
    void ensureDeviceKey(userId).then(() => {
      if (online) return registerThisDevice(userId);
    });
  }, [userId, authed, online]);

  return null;
}
