import { ApiError } from "@/shared/api/errors";
import type { Handler } from "@/shared/offline/outbox";
import type { OutboxEntry } from "@/shared/offline/outboxStore";
import { syncApi, type CommandResult } from "./api";
import { forgetRegistration, registerThisDevice } from "./register";

export interface SyncOutcome {
  via: "sync" | "direct";
  result?: CommandResult;
  data?: unknown;
}

const envelope = (e: OutboxEntry) => ({
  id: e.id,
  type: e.type,
  userId: e.userId!,
  deviceId: e.signed!.deviceId,
  capturedAt: e.signed!.capturedAt,
  payloadJson: e.signed!.payloadJson,
  signature: e.signed!.signature,
});

/**
 * Sends a queued command. Signed entries go through the sync endpoint, which applies them as the person who made them and never loses one:
 *  - applied: done.
 *  - held / rejected: the server keeps it for a manager to review; it leaves the queue (the person is told).
 *  - refused (signature / key / permission problem): nothing was recorded, so it goes the normal way instead, where the server
 *    gives the authoritative answer. If the key was the problem we register again first for next time.
 * Unsigned entries (no key yet) go the normal way, exactly as before.
 */
export function viaSync(direct: Handler): Handler {
  return (async (payload: never, entry: OutboxEntry) => {
    if (!entry.signed || !entry.userId)
      return {
        via: "direct",
        data: await direct(payload, entry),
      } satisfies SyncOutcome;
    const { results } = await syncApi.submit([envelope(entry)]);
    const r = results[0];
    if (!r)
      throw new ApiError({
        kind: "bad-response",
        message: "The server did not answer for this entry.",
      });
    if (r.status === "refused") {
      if (r.code === "UNKNOWN_DEVICE" || r.code === "BAD_SIGNATURE") {
        forgetRegistration(entry.userId);
        void registerThisDevice(entry.userId);
      }
      return {
        via: "direct",
        data: await direct(payload, entry),
      } satisfies SyncOutcome;
    }
    return { via: "sync", result: r } satisfies SyncOutcome;
  }) as Handler;
}

/**
 * For openings and closings made with no connection. They must go through the sync endpoint, because only there does the server
 * treat them as counts made without seeing its books (it records them and never refuses them for a missing reason). So unlike
 * `viaSync` there is no "send it the normal way instead" when the device's key is the problem: the key is registered again and
 * the entry waits for the next round (a few times, then it goes the normal way so it cannot hold up the queue for ever).
 * An entry that was never signed (a device that cannot make keys) goes the normal way too.
 */
export function viaSyncOnly(direct: Handler): Handler {
  return (async (payload: never, entry: OutboxEntry) => {
    if (!entry.signed || !entry.userId)
      return {
        via: "direct",
        data: await direct(payload, entry),
      } satisfies SyncOutcome;
    const { results } = await syncApi.submit([envelope(entry)]);
    const r = results[0];
    if (!r)
      throw new ApiError({
        kind: "bad-response",
        message: "The server did not answer for this entry.",
      });
    if (r.status === "refused") {
      if (r.code === "UNKNOWN_DEVICE" || r.code === "BAD_SIGNATURE") {
        forgetRegistration(entry.userId);
        try {
          await registerThisDevice(entry.userId);
        } catch {
          /* tried again on the next round */
        }
        // After a few rounds the key is not the kind of problem that fixes itself (the entry was signed with a key that has since been
        // replaced). Rather than hold up everything behind it, send it the normal way and let the server give its ordinary answer.
        if (entry.attempts >= 4)
          return {
            via: "direct",
            data: await direct(payload, entry),
          } satisfies SyncOutcome;
        throw new ApiError({
          kind: "network",
          message:
            "This computer was registered with the server again. The entry will be sent in a moment.",
        });
      }
      throw new ApiError({
        kind: "http",
        status: 403,
        code: r.code ?? undefined,
        message: r.message ?? "The server did not accept this entry.",
      });
    }
    return { via: "sync", result: r } satisfies SyncOutcome;
  }) as Handler;
}

/** What to tell the person when the server kept an entry for review instead of applying it. */
export function reviewNotice(o: unknown): string | null {
  const r = (o as SyncOutcome | undefined)?.result;
  if (!r || (r.status !== "held" && r.status !== "rejected")) return null;
  return `Saved, but it could not be applied yet${r.message ? ` (${r.message})` : ""}. A manager will review it.`;
}
