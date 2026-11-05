import { isApiError } from "@/shared/api/errors";
import type { OutboxEntry, OutboxStore } from "./outboxStore";

/**
 * The offline command queue. A saved transaction becomes an entry here first, then is sent when possible.
 *
 * Rules (each one protects cash):
 * - First in, first out, so payouts reach the server in the order they happened.
 * - Never lose an entry: it is removed only after the server confirmed it.
 * - Safe to resend: the entry id is the Idempotency-Key, so a lost response can never double-save.
 * - A connection problem stops the run and keeps everything for later (with growing delay).
 * - A server refusal (4xx) parks that one entry as `failed` for a person to look at, and the rest go on.
 */
export type Handler = (payload: never, entry: OutboxEntry) => Promise<unknown>;

export interface OutboxOptions {
  store: OutboxStore;
  handlers: Record<string, Handler>;
  /** Signs a command when it is saved. Returning nothing is fine: the command then goes the normal way. */
  sign?: (c: {
    id: string;
    type: string;
    userId: string;
    capturedAt: string;
    payload: unknown;
  }) => Promise<OutboxEntry["signed"] | undefined>;
  onSynced?: (entry: OutboxEntry, result: unknown) => void;
  now?: () => number;
  /** Who is signed in right now. Entries saved by someone else wait until that person signs in. */
  currentUser?: () => string | null;
}

export interface FlushResult {
  sent: number;
  failed: number;
  remaining: number;
  /** True when the run stopped because the server could not be reached. */
  offline: boolean;
}

const backoffMs = (attempts: number) =>
  Math.min(30_000, 1000 * 2 ** Math.min(attempts, 5));

export function createOutbox(opts: OutboxOptions) {
  const now = opts.now ?? Date.now;
  let entries: OutboxEntry[] = [];
  let snapshot: readonly OutboxEntry[] = [];
  let running: Promise<FlushResult> | null = null;
  const listeners = new Set<() => void>();

  const isOthers = (e: OutboxEntry) =>
    !!e.userId && !!opts.currentUser && e.userId !== opts.currentUser();
  const publish = () => {
    entries.sort(
      (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
    );
    snapshot = [...entries];
    listeners.forEach((l) => l());
  };
  const save = async (e: OutboxEntry) => {
    const i = entries.findIndex((x) => x.id === e.id);
    if (i >= 0) entries[i] = e;
    else entries.push(e);
    await opts.store.put(e);
    publish();
  };
  const drop = async (id: string) => {
    entries = entries.filter((e) => e.id !== id);
    await opts.store.remove(id);
    publish();
  };

  async function init() {
    const stored = await opts.store.getAll();
    // An entry stuck in `syncing` means the app closed mid-send. Sending again is safe (idempotent).
    entries = stored.map((e) =>
      e.status === "syncing" ? { ...e, status: "pending" as const } : e,
    );
    await Promise.all(
      entries.filter((e, i) => e !== stored[i]).map((e) => opts.store.put(e)),
    );
    publish();
  }

  async function enqueue<P>(id: string, type: string, payload: P) {
    if (entries.some((e) => e.id === id)) return; // same command twice (double tap) is one command
    const t = now();
    const userId = opts.currentUser?.() ?? undefined;
    let signed: OutboxEntry["signed"];
    if (opts.sign && userId) {
      try {
        signed = await opts.sign({
          id,
          type,
          userId,
          capturedAt: new Date(t).toISOString(),
          payload,
        });
      } catch {
        signed = undefined;
      }
    }
    await save({
      id,
      type,
      payload,
      userId,
      signed,
      status: "pending",
      attempts: 0,
      createdAt: t,
      nextAttemptAt: t,
    });
  }

  function flush(opt: { force?: boolean } = {}): Promise<FlushResult> {
    if (running) return running;
    running = (async () => {
      const result: FlushResult = {
        sent: 0,
        failed: 0,
        remaining: 0,
        offline: false,
      };
      for (const entry of [...entries]) {
        if (entry.status === "failed") continue;
        if (
          entry.userId &&
          opts.currentUser &&
          entry.userId !== opts.currentUser()
        )
          continue; // someone else's: keep it, do not send it as this person
        if (!opt.force && entry.nextAttemptAt > now()) {
          result.offline = true; // waiting out a delay after a connection failure
          break;
        }
        const handler = opts.handlers[entry.type];
        if (!handler) continue;
        await save({ ...entry, status: "syncing" });
        try {
          const out = await handler(entry.payload as never, entry);
          await drop(entry.id);
          result.sent++;
          opts.onSynced?.(entry, out);
        } catch (e) {
          const attempts = entry.attempts + 1;
          if (isApiError(e) && (e.retryable || e.isUnauthorized)) {
            await save({
              ...entry,
              status: "pending",
              attempts,
              nextAttemptAt: now() + backoffMs(attempts),
              lastError: { code: e.code, message: e.message },
            });
            result.offline = true;
            break;
          }
          await save({
            ...entry,
            status: "failed",
            attempts,
            lastError: isApiError(e)
              ? { code: e.code, message: e.message }
              : { message: String(e) },
          });
          result.failed++;
        }
      }
      result.remaining = entries.filter(
        (e) => e.status !== "failed" && !isOthers(e),
      ).length;
      return result;
    })().finally(() => {
      running = null;
    });
    return running;
  }

  return {
    init,
    enqueue,
    flush,
    /** Put a failed entry back in the queue. */
    async retry(id: string) {
      const e = entries.find((x) => x.id === id);
      if (e)
        await save({
          ...e,
          status: "pending",
          nextAttemptAt: now(),
          lastError: undefined,
        });
    },
    /** Remove an entry for good. Only for entries the server refused; the caller must confirm with the person. */
    discard: drop,
    getSnapshot: () => snapshot,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    get durable() {
      return opts.store.durable;
    },
  };
}

export type Outbox = ReturnType<typeof createOutbox>;
