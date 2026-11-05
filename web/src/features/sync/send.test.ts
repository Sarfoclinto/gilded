import { describe, expect, it, vi } from "vitest";
import type { OutboxEntry } from "@/shared/offline/outboxStore";

const submit = vi.fn();
vi.mock("./api", () => ({
  syncApi: {
    submit: (...a: unknown[]) => submit(...a),
    registerDevice: vi.fn(),
  },
}));
vi.mock("./register", () => ({
  forgetRegistration: vi.fn(),
  registerThisDevice: vi.fn(),
}));

import { reviewNotice, viaSync } from "./send";
import { createOutbox } from "@/shared/offline/outbox";
import { MemoryOutboxStore } from "@/shared/offline/outboxStore";

const signed = {
  deviceId: "dev-12345678",
  capturedAt: "2026-01-01T00:00:00.000Z",
  payloadJson: '{"a":1}',
  signature: "c2ln",
};
const entry = (over: Partial<OutboxEntry> = {}): OutboxEntry => ({
  id: "e1",
  type: "drawer.movement",
  userId: "u1",
  payload: { a: 1 },
  signed,
  status: "pending",
  attempts: 0,
  createdAt: 1,
  nextAttemptAt: 1,
  ...over,
});

describe("viaSync", () => {
  it("sends a signed entry through the sync endpoint and not directly", async () => {
    submit.mockResolvedValueOnce({
      results: [{ id: "e1", status: "applied" }],
    });
    const direct = vi.fn();
    const out = await viaSync(direct)({ a: 1 } as never, entry());
    expect(direct).not.toHaveBeenCalled();
    expect(submit.mock.calls[0]![0]).toEqual([
      { id: "e1", type: "drawer.movement", userId: "u1", ...signed },
    ]);
    expect(out).toMatchObject({ via: "sync" });
  });

  it("goes the normal way when the entry has no signature", async () => {
    const direct = vi.fn().mockResolvedValue("ok");
    const out = await viaSync(direct)(
      { a: 1 } as never,
      entry({ signed: undefined }),
    );
    expect(direct).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ via: "direct", data: "ok" });
  });

  it("falls back to the normal way when the server refuses the signature", async () => {
    submit.mockResolvedValueOnce({
      results: [{ id: "e1", status: "refused", code: "BAD_SIGNATURE" }],
    });
    const direct = vi.fn().mockResolvedValue("ok");
    const out = await viaSync(direct)({ a: 1 } as never, entry());
    expect(direct).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ via: "direct" });
  });

  it("a held entry leaves the queue and the person is told", async () => {
    submit.mockResolvedValueOnce({
      results: [
        {
          id: "e1",
          status: "held",
          code: "DAY_CLOSED",
          message: "The day is closed.",
        },
      ],
    });
    const out = await viaSync(vi.fn())({ a: 1 } as never, entry());
    expect(reviewNotice(out)).toContain("The day is closed.");
  });

  it("an applied entry gives no notice", async () => {
    submit.mockResolvedValueOnce({
      results: [{ id: "e1", status: "applied", flags: ["offline"] }],
    });
    expect(
      reviewNotice(await viaSync(vi.fn())({ a: 1 } as never, entry())),
    ).toBeNull();
  });
});

describe("outbox signing", () => {
  it("signs at save time and keeps the signature with the entry", async () => {
    const sign = vi.fn().mockResolvedValue(signed);
    const box = createOutbox({
      store: new MemoryOutboxStore(),
      handlers: {},
      sign,
      currentUser: () => "u1",
      now: () => 5,
    });
    await box.init();
    await box.enqueue("x", "t", { n: 1 });
    expect(box.getSnapshot()[0]!.signed).toEqual(signed);
    expect(sign.mock.calls[0]![0]).toMatchObject({
      id: "x",
      type: "t",
      userId: "u1",
      capturedAt: new Date(5).toISOString(),
    });
  });

  it("a signing failure does not stop the entry being saved", async () => {
    const box = createOutbox({
      store: new MemoryOutboxStore(),
      handlers: {},
      sign: async () => {
        throw new Error("no key");
      },
      currentUser: () => "u1",
    });
    await box.init();
    await box.enqueue("x", "t", { n: 1 });
    expect(box.getSnapshot()).toHaveLength(1);
    expect(box.getSnapshot()[0]!.signed).toBeUndefined();
  });
});
