import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/errors";
import { createOutbox } from "./outbox";
import { MemoryOutboxStore } from "./outboxStore";

const networkDown = () => new ApiError({ kind: "network", message: "down" });
const refused = (code = "VALIDATION_FAILED") =>
  new ApiError({ kind: "http", status: 422, code, message: "no" });

function setup(
  handler: (p: { n: number }) => Promise<unknown>,
  store = new MemoryOutboxStore(),
) {
  let t = 1_000;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const onSynced = vi.fn();
  const box = createOutbox({
    store,
    handlers: { tx: handler as never },
    onSynced,
    now: clock.now,
  });
  return { box, store, clock, onSynced };
}

describe("outbox", () => {
  it("sends an entry and removes it only after success", async () => {
    const seen: number[] = [];
    const { box, store, onSynced } = setup(async (p) => void seen.push(p.n));
    await box.init();
    await box.enqueue("a", "tx", { n: 1 });
    expect(box.getSnapshot()).toHaveLength(1);
    const r = await box.flush();
    expect(r).toMatchObject({
      sent: 1,
      failed: 0,
      remaining: 0,
      offline: false,
    });
    expect(seen).toEqual([1]);
    expect(await store.getAll()).toHaveLength(0);
    expect(onSynced).toHaveBeenCalledTimes(1);
  });

  it("keeps everything and stops on a connection failure, then resumes in order", async () => {
    const seen: number[] = [];
    let down = true;
    const { box, clock } = setup(async (p) => {
      if (down) throw networkDown();
      seen.push(p.n);
    });
    await box.init();
    await box.enqueue("a", "tx", { n: 1 });
    clock.advance(1);
    await box.enqueue("b", "tx", { n: 2 });

    const r1 = await box.flush();
    expect(r1.offline).toBe(true);
    expect(box.getSnapshot().map((e) => [e.id, e.status, e.attempts])).toEqual([
      ["a", "pending", 1],
      ["b", "pending", 0],
    ]);

    down = false;
    // still inside the delay: a normal run waits, a forced run (Sync now) goes
    expect((await box.flush()).sent).toBe(0);
    const r2 = await box.flush({ force: true });
    expect(r2.sent).toBe(2);
    expect(seen).toEqual([1, 2]);
  });

  it("parks a refused entry as failed and carries on with the rest", async () => {
    const seen: number[] = [];
    const { box, clock } = setup(async (p) => {
      if (p.n === 1) throw refused("PAYOUT_MISMATCH");
      seen.push(p.n);
    });
    await box.init();
    await box.enqueue("a", "tx", { n: 1 });
    clock.advance(1);
    await box.enqueue("b", "tx", { n: 2 });
    const r = await box.flush();
    expect(r).toMatchObject({ sent: 1, failed: 1, remaining: 0 });
    const a = box.getSnapshot().find((e) => e.id === "a")!;
    expect(a.status).toBe("failed");
    expect(a.lastError?.code).toBe("PAYOUT_MISMATCH");
    expect(seen).toEqual([2]);
  });

  it("after a restart, an entry stuck in syncing is sent again with the same id", async () => {
    const store = new MemoryOutboxStore();
    await store.put({
      id: "a",
      type: "tx",
      payload: { n: 1 },
      status: "syncing",
      attempts: 0,
      createdAt: 1,
      nextAttemptAt: 1,
    });
    const keys: string[] = [];
    const box2 = createOutbox({
      store,
      handlers: { tx: (async () => void keys.push("sent")) as never },
      now: () => 5_000,
    });
    await box2.init();
    expect(box2.getSnapshot()[0]!.status).toBe("pending");
    await box2.flush();
    expect(keys).toEqual(["sent"]);
  });

  it("runs one flush at a time", async () => {
    const handler = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const { box } = setup(handler);
    await box.init();
    await box.enqueue("a", "tx", { n: 1 });
    const [r1, r2] = await Promise.all([box.flush(), box.flush()]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(r1).toBe(r2);
  });

  it("ignores the same command id enqueued twice (double tap)", async () => {
    const { box } = setup(async () => {});
    await box.init();
    await box.enqueue("a", "tx", { n: 1 });
    await box.enqueue("a", "tx", { n: 1 });
    expect(box.getSnapshot()).toHaveLength(1);
  });

  it("retry puts a failed entry back, discard removes it", async () => {
    let refuse = true;
    const { box } = setup(async () => {
      if (refuse) throw refused();
    });
    await box.init();
    await box.enqueue("a", "tx", { n: 1 });
    await box.flush();
    expect(box.getSnapshot()[0]!.status).toBe("failed");
    refuse = false;
    await box.retry("a");
    expect((await box.flush()).sent).toBe(1);

    await box.enqueue("b", "tx", { n: 2 });
    refuse = true;
    await box.flush();
    await box.discard("b");
    expect(box.getSnapshot()).toHaveLength(0);
  });

  it("treats an expired session (401) like a connection problem: keep and retry later", async () => {
    const { box } = setup(async () => {
      throw new ApiError({
        kind: "http",
        status: 401,
        code: "AUTH_TOKEN_EXPIRED",
        message: "expired",
      });
    });
    await box.init();
    await box.enqueue("a", "tx", { n: 1 });
    const r = await box.flush();
    expect(r.offline).toBe(true);
    expect(box.getSnapshot()[0]!.status).toBe("pending");
  });

  it("only sends entries saved by the person now signed in", async () => {
    let who: string | null = "ama";
    const seen: number[] = [];
    const box = createOutbox({
      store: new MemoryOutboxStore(),
      handlers: {
        tx: (async (p: { n: number }) => void seen.push(p.n)) as never,
      },
      now: () => 1_000,
      currentUser: () => who,
    });
    await box.init();
    await box.enqueue("a", "tx", { n: 1 });
    who = "kofi";
    await box.enqueue("b", "tx", { n: 2 });
    const r = await box.flush({ force: true });
    expect(seen).toEqual([2]);
    expect(r.remaining).toBe(0);
    expect(box.getSnapshot().map((e) => e.id)).toEqual(["a"]);
    who = "ama";
    await box.flush({ force: true });
    expect(seen).toEqual([2, 1]);
  });
});
