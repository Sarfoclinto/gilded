import {
  ensureDeviceKey,
  isRegistered,
  markRegistered,
} from "@/shared/offline/deviceKey";
import { syncApi } from "./api";

/**
 * Tells the server which key this device signs this person's offline entries with. Needs a connection and a signed-in person;
 * done once per key. If it cannot be done now it is simply tried again later, and entries made meanwhile go the normal way.
 */
export async function registerThisDevice(userId: string): Promise<boolean> {
  try {
    const { deviceId, publicKey } = await ensureDeviceKey(userId);
    if (isRegistered(userId, publicKey)) return true;
    await syncApi.registerDevice(deviceId, publicKey);
    markRegistered(userId, publicKey);
    return true;
  } catch {
    return false;
  }
}

/** The server no longer accepts our key (it was replaced from another browser profile, say): register again next time. */
export const forgetRegistration = (userId: string) =>
  markRegistered(userId, null);
