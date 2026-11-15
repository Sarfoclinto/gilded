import {
  backoffMs,
  MAX_ATTEMPTS,
  type PhotoRecord,
  type PhotoTarget,
} from "./model";
import type { PhotoStore } from "./store";
import type { Prepared } from "./process";

/** Sends one picture. Reports progress from 0 to 1. Throws `NetworkError` when the server cannot be reached (try again later, not a failure). */
export type Sender = (
  p: { record: PhotoRecord; file: Blob; thumb?: Blob },
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
) => Promise<void>;
export class NetworkError extends Error {
  constructor(m = "No connection") {
    super(m);
    this.name = "NetworkError";
  }
}

export interface PhotoQueueOptions {
  store: PhotoStore;
  send: Sender;
  /** False pauses sending (no connection). Asked before every picture. */
  online?: () => boolean;
  now?: () => number;
  /** How many go at once. A phone on a weak connection does better with two than with ten. */
  concurrency?: number;
  /** Keep the full picture after it is sent (the lab does; the real app keeps only the thumbnail and loads the rest from the server). */
  keepSent?: boolean;
}

/**
 * The picture upload queue (B60). Separate from the command queue on purpose: a purchase or a day close must never wait for a photo.
 * - A picture is saved on the device first, then sent in the background; the person never waits.
 * - Sending can be repeated safely: the picture id is the idempotency key, so a lost reply cannot create two.
 * - No connection: everything stays and goes when the connection returns. A server refusal retries with growing waits, then parks the picture as failed.
 */
export function createPhotoQueue(opts: PhotoQueueOptions) {
  const now = opts.now ?? Date.now;
  const online = opts.online ?? (() => true);
  const concurrency = opts.concurrency ?? 2;
  const records = new Map<string, PhotoRecord>();
  const thumbs = new Map<string, Blob>();
  const aborters = new Map<string, AbortController>();
  const listeners = new Set<() => void>();
  let snapshot: readonly PhotoRecord[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active = 0;
  /** Pictures being sent or about to be: claimed before any waiting, so two runs of the loop can never take the same one. */
  const inflight = new Set<string>();
  let loaded = false;

  const emit = () => {
    snapshot = [...records.values()].sort((a, b) => a.createdAt - b.createdAt);
    listeners.forEach((l) => l());
  };
  const persist = (r: PhotoRecord) =>
    opts.store
      .put({ record: r, thumb: thumbs.get(r.id)! })
      .catch(() => undefined);

  async function load() {
    if (loaded) return;
    loaded = true;
    for (const p of await opts.store.all()) {
      // anything that was mid-send when the app closed goes again
      const r = {
        ...p.record,
        status:
          p.record.status === "sending" ? ("queued" as const) : p.record.status,
      };
      records.set(r.id, r);
      thumbs.set(r.id, p.thumb);
    }
    emit();
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    const due = [...records.values()]
      .filter((r) => r.status === "queued")
      .map((r) => r.nextAttemptAt);
    if (!due.length) return;
    timer = setTimeout(
      () => void pump(),
      Math.max(0, Math.min(...due) - now()) + 5,
    );
  }

  async function sendOne(r: PhotoRecord) {
    const file = await opts.store.file(r.id);
    if (!file) {
      records.set(r.id, {
        ...r,
        status: "failed",
        error: "The picture is no longer on this device.",
      });
      emit();
      return;
    }
    const ctl = new AbortController();
    aborters.set(r.id, ctl);
    records.set(r.id, {
      ...r,
      status: "sending",
      progress: 0,
      error: undefined,
    });
    emit();
    try {
      await opts.send(
        { record: r, file, thumb: thumbs.get(r.id) },
        (f) => {
          const cur = records.get(r.id);
          if (cur && cur.status === "sending") {
            records.set(r.id, {
              ...cur,
              progress: Math.min(Math.max(f, 0), 1),
            });
            emit();
          }
        },
        ctl.signal,
      );
      const done = {
        ...records.get(r.id)!,
        status: "sent" as const,
        progress: 1,
        error: undefined,
      };
      records.set(r.id, done);
      await persist(done);
      if (!opts.keepSent)
        await opts.store.dropFile(r.id).catch(() => undefined);
    } catch (e) {
      if (ctl.signal.aborted && !records.has(r.id)) return;
      const cur = records.get(r.id) ?? r;
      if (e instanceof NetworkError) {
        // not the picture's fault: back to waiting without counting a failed try
        records.set(r.id, {
          ...cur,
          status: "queued",
          progress: 0,
          nextAttemptAt: now() + 5000,
          error: undefined,
        });
      } else {
        const attempts = cur.attempts + 1;
        records.set(
          r.id,
          attempts >= MAX_ATTEMPTS
            ? {
                ...cur,
                status: "failed",
                attempts,
                progress: 0,
                error: e instanceof Error ? e.message : "Could not be sent",
              }
            : {
                ...cur,
                status: "queued",
                attempts,
                progress: 0,
                nextAttemptAt: now() + backoffMs(attempts),
                error: e instanceof Error ? e.message : "Could not be sent",
              },
        );
      }
      await persist(records.get(r.id)!);
    } finally {
      aborters.delete(r.id);
      emit();
    }
  }

  async function pump(): Promise<void> {
    await load();
    if (!online()) {
      schedule();
      return;
    }
    while (active < concurrency) {
      const next = [...records.values()]
        .filter(
          (r) =>
            r.status === "queued" &&
            r.nextAttemptAt <= now() &&
            !inflight.has(r.id),
        )
        .sort((a, b) => a.createdAt - b.createdAt)[0];
      if (!next) break;
      active++;
      inflight.add(next.id);
      void sendOne(next).finally(() => {
        active--;
        inflight.delete(next.id);
        void pump();
      });
    }
    schedule();
  }

  return {
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    getSnapshot: () => snapshot,
    thumb: (id: string) => thumbs.get(id),
    file: (id: string) => opts.store.file(id),
    durable: opts.store.durable,
    /** Start: read what the last session left, then send what is waiting. */
    start: pump,
    /** Save a prepared picture and send it in the background. Returns as soon as it is safe on the device. */
    async add(
      p: Prepared,
      target?: PhotoTarget,
      owner?: string,
    ): Promise<PhotoRecord> {
      await load();
      const r: PhotoRecord = {
        ...p.record,
        ...(target ? { target } : {}),
        ...(owner ? { owner } : {}),
        status: "queued",
        progress: 0,
        attempts: 0,
        nextAttemptAt: now(),
        createdAt: now(),
      };
      records.set(r.id, r);
      thumbs.set(r.id, p.thumb);
      await opts.store.put({ record: r, thumb: p.thumb }, p.blob);
      emit();
      void pump();
      return r;
    },
    /** Try a parked picture again now. */
    async retry(id: string) {
      const r = records.get(id);
      if (!r) return;
      records.set(id, {
        ...r,
        status: "queued",
        attempts: 0,
        nextAttemptAt: now(),
        error: undefined,
      });
      emit();
      void pump();
    },
    async remove(id: string) {
      aborters.get(id)?.abort();
      records.delete(id);
      thumbs.delete(id);
      await opts.store.remove(id).catch(() => undefined);
      emit();
    },
    /** Call when the connection comes back. */
    wake() {
      void pump();
    },
  };
}
export type PhotoQueue = ReturnType<typeof createPhotoQueue>;
