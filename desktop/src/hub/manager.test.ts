import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HubManager } from "./manager";
import { MemoryHubStore } from "./store";

const dirs: string[] = [];
const managers: HubManager[] = [];
afterEach(async () => {
  for (const m of managers.splice(0)) await m.stop();
  for (const d of dirs.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mgr-"));
  dirs.push(d);
  return d;
};
const make = (dir = tmp(), shared?: MemoryHubStore) => {
  const m = new HubManager({
    dir,
    address: () => "127.0.0.1",
    openStore: shared ? () => shared : () => new MemoryHubStore(),
  });
  managers.push(m);
  return m;
};

describe("HubManager", () => {
  it("starts as an ordinary computer", async () => {
    const m = make();
    await m.start();
    expect(m.state()).toEqual({ role: "off" });
  });

  it("becomes a hub, shows a code and the one line to type, and a second computer joins with it", async () => {
    const hub = make();
    await hub.start();
    // use a free port for the test
    (hub as unknown as { port: number }).port = 0;
    const s = await hub.becomeHub("branch-1", "Front desk");
    expect(s.hub).toMatchObject({
      running: true,
      name: "Front desk",
      devices: [],
    });
    const withCode = hub.newCode();
    expect(withCode.hub!.code!.text).toMatch(
      /^127\.0\.0\.1:\d+#\d{6}#[0-9A-F]{16}$/,
    );

    const member = make();
    await member.start();
    const joined = await member.join(withCode.hub!.code!.text, "PC-2");
    expect(joined.role).toBe("member");
    expect(joined.member!.hubName).toBe("Front desk");
    await new Promise((r) => setTimeout(r, 200));
    expect(member.state().member!.state).toBe("connected");
    expect(hub.state().hub!.devices.map((d) => d.name)).toEqual(["PC-2"]);
    expect(hub.state().hub!.code).toBeNull(); // the code was used
  });

  it("a member that loses the hub says unreachable and does not break", async () => {
    const hub = make();
    await hub.start();
    (hub as unknown as { port: number }).port = 0;
    await hub.becomeHub("b", "Hub");
    const text = hub.newCode().hub!.code!.text;
    const member = make();
    await member.start();
    await member.join(text, "PC-2");
    await new Promise((r) => setTimeout(r, 200));
    await hub.turnOff();
    // wait for the next poll by asking the client directly
    await expect(member.memberClient()!.status()).rejects.toMatchObject({
      code: "UNREACHABLE",
    });
  });

  it("a revoked computer is turned away", async () => {
    const hub = make();
    await hub.start();
    (hub as unknown as { port: number }).port = 0;
    await hub.becomeHub("b", "Hub");
    const member = make();
    await member.start();
    await member.join(hub.newCode().hub!.code!.text, "PC-2");
    hub.revoke(hub.state().hub!.devices[0]!.id);
    await expect(member.memberClient()!.status()).rejects.toMatchObject({
      code: "NOT_PAIRED",
    });
  });

  it("remembers the choice after a restart (hub and member)", async () => {
    const dir = tmp();
    const store = new MemoryHubStore();
    const h1 = make(dir, store);
    await h1.start();
    (h1 as unknown as { port: number }).port = 0;
    await h1.becomeHub("b", "Hub");
    await h1.stop();
    const h2 = make(dir, store);
    (h2 as unknown as { port: number }).port = 0;
    await h2.start();
    expect(h2.state()).toMatchObject({
      role: "hub",
      hub: { running: true, name: "Hub" },
    });
  });

  it("refuses text that is not what the hub shows", async () => {
    const m = make();
    await m.start();
    await expect(m.join("hello", "PC")).rejects.toMatchObject({
      code: "BAD_PAIRING_TEXT",
    });
  });

  it("turning the hub off goes back to an ordinary computer", async () => {
    const hub = make();
    await hub.start();
    (hub as unknown as { port: number }).port = 0;
    await hub.becomeHub("b", "Hub");
    expect((await hub.turnOff()).role).toBe("off");
  });

  it("the screens reach the hub the same way from the hub computer and from a member, and the notes are reserved once", async () => {
    const hub = make();
    await hub.start();
    (hub as unknown as { port: number }).port = 0;
    await hub.becomeHub("b", "Hub");
    const member = make();
    await member.start();
    await member.join(hub.newCode().hub!.code!.text, "PC-2");
    expect(hub.state().selfId).toBe("hub-local");
    expect(member.state().selfId).toMatch(/^[0-9a-f]{16}$/);

    const day = {
      day: {
        id: "d1",
        status: "open",
        businessDate: "2026-11-05",
        opening: { lines: { "100": 3 } },
        closing: null,
      },
      balance: { "100": 3 },
      appliedIds: [],
      carryOver: null,
    };
    await hub.share((a) => a.snapshot(day, "2026-11-05T08:00:00.000Z"));
    const cmd = (id: string, n: number) => ({
      id,
      type: "transaction.create" as const,
      payload: { branchId: "b", payout: { lines: { "100": n } } },
    });
    const r1 = await hub.share((a) =>
      a.submit({
        command: cmd("t1", 2),
        userId: "u1",
        capturedAt: "2026-11-05T09:00:00.000Z",
        strict: true,
      }),
    );
    const r2 = await member.share((a) =>
      a.submit({
        command: cmd("t2", 2),
        userId: "u2",
        capturedAt: "2026-11-05T09:00:01.000Z",
        strict: true,
      }),
    );
    expect(r1).toMatchObject({ ok: true, data: { seq: 1, covered: true } });
    expect(r2).toMatchObject({
      ok: true,
      data: { taken: true, short: { "100": 1 } },
    });
    const seen = await member.share((a) => a.since(0));
    expect(seen.ok && seen.data.map((e) => [e.command.id, e.deviceId])).toEqual(
      [["t1", "hub-local"]],
    );
  });

  it("a member closes the day through the hub, the hub computer is told it is closed, and both see the same picture (B53)", async () => {
    const hub = make();
    await hub.start();
    (hub as unknown as { port: number }).port = 0;
    await hub.becomeHub("b", "Hub");
    const member = make();
    await member.start();
    await member.join(hub.newCode().hub!.code!.text, "PC-2");
    const day = {
      day: {
        id: "d1",
        status: "open",
        businessDate: "2026-11-05",
        opening: { lines: { "100": 3 } },
        closing: null,
      },
      balance: { "100": 3 },
      appliedIds: ["d1"],
      carryOver: { "100": 3 },
    };
    await hub.share((a) => a.snapshot(day, "2026-11-05T08:00:00.000Z"));
    const close = (id: string) => ({
      id,
      type: "day.close" as const,
      payload: { dayId: "d1", branchId: "b", declared: { cash: { "100": 3 } } },
    });
    const r1 = await member.share((a) =>
      a.submit({
        command: close("c1"),
        userId: "u2",
        capturedAt: "2026-11-05T18:00:00.000Z",
        strict: true,
      }),
    );
    const r2 = await hub.share((a) =>
      a.submit({
        command: close("c2"),
        userId: "u1",
        capturedAt: "2026-11-05T18:00:01.000Z",
        strict: true,
      }),
    );
    expect(r1).toMatchObject({ ok: true, data: { seq: 1, covered: true } });
    expect(r2).toMatchObject({
      ok: true,
      data: { taken: true, reason: "day-not-open" },
    });
    const open = {
      id: "d2",
      type: "day.open" as const,
      payload: {
        id: "d2",
        branchId: "b",
        businessDate: "2026-11-06",
        lines: { "100": 3 },
      },
    };
    expect(
      await hub.share((a) =>
        a.submit({
          command: open,
          userId: "u1",
          capturedAt: "2026-11-06T08:00:00.000Z",
          strict: true,
        }),
      ),
    ).toMatchObject({ ok: true, data: { seq: 2, covered: true } });

    // both computers get the same picture: the server answer the hub counts from, and what was saved since
    const fromMember = await member.share((a) => a.state());
    const fromHub = await hub.share((a) => a.state());
    expect(
      fromMember.ok && fromMember.data.entries.map((e) => e.command.id),
    ).toEqual(["c1", "d2"]);
    expect(fromMember.ok && fromMember.data.snapshot?.asOf).toBe(
      "2026-11-05T08:00:00.000Z",
    );
    expect(fromHub).toEqual(fromMember);

    // the member's computer reaches the server: it hands over the answer and says its closing is in it
    const closed = {
      day: {
        id: "d1",
        status: "closed",
        businessDate: "2026-11-05",
        opening: { lines: { "100": 3 } },
        closing: { cash: { counted: { "100": 3 } } },
      },
      balance: null,
      appliedIds: ["d1"],
      carryOver: { "100": 3 },
    };
    await member.share((a) => a.snapshot(closed, "2026-11-06T09:00:00.000Z"));
    expect(
      await member.share((a) => a.confirm(["c1"], "2026-11-06T09:00:00.000Z")),
    ).toMatchObject({ ok: true, data: { confirmed: 1 } });
    const after = await hub.share((a) => a.state());
    expect(after.ok && after.data.entries.map((e) => e.command.id)).toEqual([
      "d2",
    ]);
  });

  it("a badly formed opening or closing is not let into the shared log", async () => {
    const hub = make();
    await hub.start();
    (hub as unknown as { port: number }).port = 0;
    await hub.becomeHub("b", "Hub");
    const member = make();
    await member.start();
    await member.join(hub.newCode().hub!.code!.text, "PC-2");
    const bad = {
      id: "x",
      type: "day.close",
      payload: { dayId: "d1", branchId: "b" },
    } as never;
    expect(
      await member.share((a) =>
        a.submit({
          command: bad,
          userId: "u",
          capturedAt: "2026-11-05T18:00:00.000Z",
        }),
      ),
    ).toMatchObject({ ok: false });
    const seen = await hub.share((a) => a.since(0));
    expect(seen.ok && seen.data).toEqual([]);
  });

  it("an ordinary computer, or a member whose hub is gone, reports unreachable instead of failing", async () => {
    const alone = make();
    await alone.start();
    expect(await alone.share((a) => a.since(0))).toMatchObject({
      ok: false,
      unreachable: true,
    });
    const hub = make();
    await hub.start();
    (hub as unknown as { port: number }).port = 0;
    await hub.becomeHub("b", "Hub");
    const member = make();
    await member.start();
    await member.join(hub.newCode().hub!.code!.text, "PC-2");
    await hub.turnOff();
    expect(await member.share((a) => a.since(0))).toMatchObject({
      ok: false,
      unreachable: true,
    });
  });
});
