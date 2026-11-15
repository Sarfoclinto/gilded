import { describe, expect, it } from "vitest";
import {
  backoffMs,
  fitWithin,
  formatBytes,
  isPictureFile,
  MAX_ATTEMPTS,
  stampLines,
  summarize,
} from "./model";
import { createPhotoQueue, NetworkError, type Sender } from "./queue";
import { MemoryPhotoStore } from "./store";
import type { Prepared } from "./process";

const prepared = (id: string): Prepared => ({
  blob: new Blob(["x".repeat(100)]),
  thumb: new Blob(["t"]),
  record: {
    id,
    name: id + ".jpg",
    width: 10,
    height: 10,
    size: 100,
    originalSize: 900,
    sha256: id,
    source: "camera",
    takenAt: new Date(0).toISOString(),
    stamped: false,
    prepMs: 5,
  },
});
const until = async (fn: () => boolean) => {
  for (let i = 0; i < 400 && !fn(); i++)
    await new Promise((r) => setTimeout(r, 5));
};
const settle = () => new Promise((r) => setTimeout(r, 25));

describe("photo rules", () => {
  it("shrinks to fit without enlarging", () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(0, 0, 1600)).toEqual({ width: 0, height: 0 });
  });
  it("writes the stamp with the weekday", () => {
    const [a, b] = stampLines({
      branch: "Tarkwa",
      reference: "TRF-TKW-0007",
      person: "Ama",
      at: new Date(2026, 10, 14, 9, 5),
    });
    expect(a).toBe("Tarkwa · TRF-TKW-0007");
    expect(b).toBe("Sat 14 Nov 2026 09:05 · Ama");
    expect(
      stampLines({
        branch: "Tarkwa",
        person: "Ama",
        at: new Date(2026, 10, 14, 9, 5),
      })[0],
    ).toBe("Tarkwa");
  });
  it("formats sizes, waits and what counts as a picture", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(300 * 1024)).toBe("300 KB");
    expect(formatBytes(2.5 * 1024 * 1024)).toBe("2.5 MB");
    expect(backoffMs(1)).toBe(2000);
    expect(backoffMs(20)).toBe(60000);
    expect(isPictureFile({ type: "", name: "IMG_1.HEIC" })).toBe(true);
    expect(isPictureFile({ type: "application/pdf", name: "a.pdf" })).toBe(
      false,
    );
  });
  it("summarises the queue in plain words", () => {
    expect(summarize([]).text).toBe("No photos yet");
    expect(
      summarize([
        { status: "queued", progress: 0 },
        { status: "sending", progress: 0.5 },
        { status: "failed", progress: 0 },
      ]).text,
    ).toBe("1 sending · 1 waiting to send · 1 could not be sent");
    expect(summarize([{ status: "sent", progress: 1 }]).text).toBe("1 sent");
  });
});

describe("the photo upload queue", () => {
  it("saves first, then sends in the background and reports progress", async () => {
    const seen: number[] = [];
    const send: Sender = async (_p, onProgress) => {
      onProgress(0.5);
      seen.push(0.5);
      onProgress(1);
    };
    const q = createPhotoQueue({ store: new MemoryPhotoStore(), send });
    const r = await q.add(prepared("a"));
    expect(r.status).toBe("queued");
    await until(() => q.getSnapshot()[0]?.status === "sent");
    expect(q.getSnapshot()[0]).toMatchObject({
      id: "a",
      status: "sent",
      progress: 1,
    });
    expect(seen).toEqual([0.5]);
  });
  it("waits while offline and sends when the connection returns", async () => {
    let on = false,
      sent = 0;
    const q = createPhotoQueue({
      store: new MemoryPhotoStore(),
      send: async () => {
        sent++;
      },
      online: () => on,
    });
    await q.add(prepared("a"));
    await settle();
    expect(sent).toBe(0);
    expect(q.getSnapshot()[0]!.status).toBe("queued");
    on = true;
    q.wake();
    await until(() => q.getSnapshot()[0]!.status === "sent");
    expect(sent).toBe(1);
  });
  it("a lost connection is not counted as a failed try", async () => {
    let n = 0;
    const q = createPhotoQueue({
      store: new MemoryPhotoStore(),
      send: async () => {
        n++;
        throw new NetworkError();
      },
    });
    await q.add(prepared("a"));
    await until(() => n > 0);
    await settle();
    expect(q.getSnapshot()[0]).toMatchObject({ status: "queued", attempts: 0 });
  });
  it("a refusal retries with a growing wait, then parks the picture; retry brings it back", async () => {
    let clock = 0,
      calls = 0;
    const q = createPhotoQueue({
      store: new MemoryPhotoStore(),
      now: () => clock,
      send: async () => {
        calls++;
        throw new Error("Too large");
      },
    });
    await q.add(prepared("a"));
    await until(() => calls === 1);
    await settle();
    expect(q.getSnapshot()[0]).toMatchObject({
      status: "queued",
      attempts: 1,
      error: "Too large",
    });
    expect(q.getSnapshot()[0]!.nextAttemptAt).toBe(backoffMs(1));
    for (let i = 2; i <= MAX_ATTEMPTS; i++) {
      clock += 120_000;
      q.wake();
      await until(() => calls === i);
      await settle();
    }
    expect(q.getSnapshot()[0]).toMatchObject({
      status: "failed",
      attempts: MAX_ATTEMPTS,
    });
    await q.retry("a");
    expect(q.getSnapshot()[0]).toMatchObject({ attempts: 0 });
  });
  it("picks up what a closed app left behind, and sends at most two at once", async () => {
    const store = new MemoryPhotoStore();
    const seed = createPhotoQueue({
      store,
      send: async () => {
        throw new NetworkError();
      },
      online: () => false,
    });
    for (const id of ["a", "b", "c", "d"]) await seed.add(prepared(id));
    let running = 0,
      peak = 0;
    const q = createPhotoQueue({
      store,
      send: async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 15));
        running--;
      },
    });
    await q.start();
    await until(
      () =>
        q.getSnapshot().length === 4 &&
        q.getSnapshot().every((r) => r.status === "sent"),
    );
    expect(q.getSnapshot().map((r) => r.status)).toEqual([
      "sent",
      "sent",
      "sent",
      "sent",
    ]);
    expect(peak).toBe(2);
  });
  it("drops the full picture after sending unless told to keep it, and removing forgets it", async () => {
    const store = new MemoryPhotoStore();
    const q = createPhotoQueue({ store, send: async () => undefined });
    await q.add(prepared("a"));
    await until(() => q.getSnapshot()[0]?.status === "sent");
    await settle();
    expect(await store.file("a")).toBeUndefined();
    expect(q.thumb("a")).toBeDefined();
    await q.remove("a");
    expect(q.getSnapshot()).toHaveLength(0);
  });
  it("remembers where a picture belongs and who took it, and hands the sender the preview too", async () => {
    const store = new MemoryPhotoStore();
    let seen: { target?: unknown; owner?: string; thumb?: boolean } = {};
    const send: Sender = async ({ record, thumb }) => {
      seen = { target: record.target, owner: record.owner, thumb: !!thumb };
    };
    const q = createPhotoQueue({ store, send });
    const target = {
      entityType: "transfer",
      entityId: "T1",
      slot: "release",
    } as const;
    await q.add(prepared("b"), target, "u1");
    await until(() => q.getSnapshot()[0]?.status === "sent");
    expect(seen).toEqual({ target, owner: "u1", thumb: true });
    // it survives a restart of the app with its target
    const again = createPhotoQueue({ store, send });
    await again.start();
    expect(again.getSnapshot()[0]?.target).toEqual(target);
  });
  it("waits, without counting a failure, when the sender says the owner is not signed in", async () => {
    const store = new MemoryPhotoStore();
    const q = createPhotoQueue({
      store,
      send: async () => {
        throw new NetworkError();
      },
    });
    await q.add(prepared("c"), undefined, "someone-else");
    await until(
      () =>
        q.getSnapshot()[0]?.status === "queued" &&
        q.getSnapshot()[0]!.nextAttemptAt > Date.now(),
    );
    expect(q.getSnapshot()[0]!.attempts).toBe(0);
  });
});
