import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DayStateLike, DrawerCommand } from "@gold/core";
import { Hub } from "./hub";
import { MemoryHubStore, SqliteHubStore, type HubStore } from "./store";

const day = (
  balance: Record<string, number>,
  appliedIds: string[] = [],
): DayStateLike => ({
  day: {
    id: "d1",
    status: "open",
    businessDate: "2026-11-05",
    opening: { lines: balance },
    closing: null,
  },
  balance,
  appliedIds,
  carryOver: null,
});
const pay = (id: string, lines: Record<string, number>): DrawerCommand => ({
  id,
  type: "transaction.create",
  payload: { branchId: "b", payout: { lines } },
});
const topup = (id: string, lines: Record<string, number>): DrawerCommand => ({
  id,
  type: "drawer.movement",
  payload: { dayId: "d1", kind: "topup", lines },
});
const from = (device: string, command: DrawerCommand, n = 1) => ({
  command,
  deviceId: device,
  userId: `user-${device}`,
  capturedAt: "2026-11-05T09:00:00.000Z",
  localSeq: n,
});

const dirs: string[] = [];
const opened: HubStore[] = [];
/** Opens a database file and remembers it, so it is closed before its folder is removed (Windows cannot delete a file that is still open). */
const openSqlite = (file: string) => {
  const s = new SqliteHubStore(file);
  opened.push(s);
  return s;
};
afterEach(() => {
  for (const s of opened.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed by the test */
    }
  }
  for (const d of dirs.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
});
const tmpFile = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hub-"));
  dirs.push(d);
  return path.join(d, "hub.db");
};

const stores: Array<[string, () => HubStore]> = [
  ["memory", () => new MemoryHubStore()],
  ["sqlite", () => openSqlite(tmpFile())],
];

describe.each(stores)("hub on %s storage", (_name, make) => {
  const newHub = (balance: Record<string, number> = { "100": 3 }) => {
    const store = make();
    const hub = new Hub(store, {
      branchId: "b",
      now: () => new Date("2026-11-05T09:00:05.000Z"),
    });
    hub.setSnapshot(day(balance), "2026-11-05T08:00:00.000Z");
    return { hub, store };
  };

  it("numbers commands 1, 2, 3 in the order the hub received them, whatever the machines think the time is", () => {
    const { hub } = newHub();
    const r = [
      hub.submit(from("pc2", topup("a", { "100": 1 }))),
      hub.submit(from("pc1", topup("b", { "100": 1 }))),
      hub.submit(from("pc3", topup("c", { "100": 1 }))),
    ];
    expect(r.map((x) => x.seq)).toEqual([1, 2, 3]);
  });

  it("two tellers race: the second is told the notes were just used, but is still recorded", () => {
    const { hub } = newHub({ "100": 3 });
    expect(hub.check(pay("t1", { "100": 2 })).ok).toBe(true);
    const first = hub.submit(from("pc1", pay("t1", { "100": 2 })));
    const second = hub.check(pay("t2", { "100": 2 }));
    expect(first.covered).toBe(true);
    expect(second).toMatchObject({ ok: false, short: { "100": 1 } });
    const late = hub.submit(from("pc2", pay("t2", { "100": 2 })));
    expect(late).toMatchObject({ covered: false, short: { "100": 1 } });
    expect(hub.view().balance).toEqual({ "100": -1 });
    expect(hub.view().negative).toBe(true);
  });

  it("strict: only records a command the drawer can cover; otherwise nothing is stored and the notes are reported", () => {
    const { hub } = newHub({ "100": 3 });
    expect(
      hub.submit({ ...from("pc1", pay("t1", { "100": 2 })), strict: true }),
    ).toMatchObject({ seq: 1, covered: true });
    const r = hub.submit({
      ...from("pc2", pay("t2", { "100": 2 })),
      strict: true,
    });
    expect(r).toMatchObject({
      taken: true,
      covered: false,
      short: { "100": 1 },
      seq: 0,
    });
    expect(hub.since(0)).toHaveLength(1);
    expect(hub.view().balance).toEqual({ "100": 1 });
    // the same teller chooses fewer notes and goes through
    expect(
      hub.submit({ ...from("pc2", pay("t3", { "100": 1 })), strict: true }),
    ).toMatchObject({ seq: 2, covered: true });
  });

  it("sending the same command again returns the original answer and adds nothing", () => {
    const { hub } = newHub();
    const a = hub.submit(from("pc1", pay("t1", { "100": 1 })));
    const b = hub.submit(from("pc1", pay("t1", { "100": 1 })));
    expect(b).toEqual({ ...a, duplicate: true });
    expect(hub.since(0)).toHaveLength(1);
  });

  it("a machine that was off catches up from the last number it saw", () => {
    const { hub } = newHub();
    hub.submit(from("pc1", topup("a", { "100": 1 })));
    hub.submit(from("pc2", topup("b", { "100": 1 })));
    hub.submit(from("pc1", topup("c", { "100": 1 })));
    expect(hub.since(1).map((e) => e.command.id)).toEqual(["b", "c"]);
    expect(hub.since(3)).toEqual([]);
  });

  it("once the server confirms commands, they stop counting against the drawer and leave the to-send list", () => {
    const { hub } = newHub({ "100": 5 });
    hub.submit(from("pc1", pay("t1", { "100": 2 })));
    hub.submit(from("pc2", pay("t2", { "100": 1 })));
    expect(hub.unconfirmed().map((e) => e.command.id)).toEqual(["t1", "t2"]);
    expect(hub.view().balance).toEqual({ "100": 2 });
    // The server now reports t1 applied: its balance already includes it.
    expect(
      hub.setSnapshot(day({ "100": 3 }, ["t1"]), "2026-11-05T09:30:00.000Z"),
    ).toBe(true);
    expect(hub.unconfirmed().map((e) => e.command.id)).toEqual(["t2"]);
    expect(hub.view().balance).toEqual({ "100": 2 });
  });

  it("an older server answer never replaces a newer one", () => {
    const { hub } = newHub({ "100": 5 });
    expect(hub.setSnapshot(day({ "100": 1 }), "2026-11-05T07:00:00.000Z")).toBe(
      false,
    );
    expect(hub.view().balance).toEqual({ "100": 5 });
  });

  it("keeps the signed envelope exactly as the machine made it, to send on to the server", () => {
    const { hub } = newHub();
    const signed = {
      deviceId: "pc1-device",
      capturedAt: "2026-11-05T09:00:00.000Z",
      payloadJson: '{"a":1}',
      signature: "c2ln",
    };
    hub.submit({ ...from("pc1", topup("a", { "100": 1 })), signed });
    expect(hub.since(0)[0]!.signed).toEqual(signed);
  });

  it("with no server answer yet, it still numbers and keeps everything and flags nothing", () => {
    const hub = new Hub(make(), { branchId: "b" });
    const r = hub.submit(from("pc1", pay("t1", { "100": 1 })));
    expect(r).toMatchObject({ seq: 1, covered: true });
    expect(hub.view().status).toBe("unknown");
  });
});

describe("sqlite storage survives a restart", () => {
  it("keeps the log, the numbers, the server answer and settings; the next number carries on", () => {
    const file = tmpFile();
    const s1 = openSqlite(file);
    const h1 = new Hub(s1, { branchId: "b" });
    h1.setSnapshot(day({ "100": 3 }), "2026-11-05T08:00:00.000Z");
    h1.submit(from("pc1", pay("t1", { "100": 1 })));
    h1.submit(from("pc2", pay("t2", { "100": 1 })));
    s1.setMeta("branch", "b");
    s1.close();

    const s2 = openSqlite(file);
    const h2 = new Hub(s2, { branchId: "b" });
    expect(s2.getMeta("branch")).toBe("b");
    expect(h2.view().balance).toEqual({ "100": 1 });
    expect(h2.submit(from("pc3", pay("t3", { "100": 1 }))).seq).toBe(3);
    expect(h2.submit(from("pc1", pay("t1", { "100": 1 }))).duplicate).toBe(
      true,
    );
    s2.close();
  });

  it("a power cut mid-run loses nothing that was acknowledged (the file is complete when another opener reads it)", () => {
    const file = tmpFile();
    const s1 = openSqlite(file);
    const h1 = new Hub(s1, { branchId: "b" });
    h1.setSnapshot(day({ "100": 9 }), "2026-11-05T08:00:00.000Z");
    for (let i = 0; i < 50; i++)
      h1.submit(from("pc1", pay(`t${i}`, { "100": 0 }), i));
    // No close(): another connection sees all acknowledged commands.
    const s2 = openSqlite(file);
    expect(s2.all()).toHaveLength(50);
    s2.close();
    s1.close();
  });
});

describe("several machines, in any interleaving, agree on the drawer", () => {
  it("replaying what the hub numbered gives every machine the same balance", () => {
    const { hub } = (() => {
      const hub = new Hub(new MemoryHubStore(), { branchId: "b" });
      hub.setSnapshot(day({ "100": 10, "50": 10 }), "2026-11-05T08:00:00.000Z");
      return { hub };
    })();
    hub.submit(from("pc1", pay("a", { "100": 3 })));
    hub.submit(from("pc2", pay("b", { "50": 4 })));
    hub.submit(from("pc3", topup("c", { "100": 2 })));
    hub.submit(from("pc2", pay("d", { "100": 5 })));
    expect(hub.view().balance).toEqual({ "100": 4, "50": 6 });
    // A machine that only has the numbered entries since 0 arrives at the same place.
    const mirror = new Hub(new MemoryHubStore(), { branchId: "b" });
    mirror.setSnapshot(
      day({ "100": 10, "50": 10 }),
      "2026-11-05T08:00:00.000Z",
    );
    for (const e of hub.since(0).reverse())
      mirror.submit({
        command: e.command,
        deviceId: e.deviceId,
        userId: e.userId,
        capturedAt: e.capturedAt,
        localSeq: e.localSeq,
      });
    expect(mirror.view().balance).toEqual(hub.view().balance);
  });
});

describe("days on the hub (B53)", () => {
  const B = "b";
  const mon = (
    balance: Record<string, number>,
    appliedIds: string[] = ["mon"],
  ): DayStateLike => ({
    day: {
      id: "mon",
      status: "open",
      businessDate: "2026-11-09",
      opening: { lines: balance },
      closing: null,
    },
    balance,
    appliedIds,
    carryOver: balance,
  });
  const open = (
    id: string,
    date: string,
    lines: Record<string, number>,
  ): DrawerCommand => ({
    id,
    type: "day.open",
    payload: { id, branchId: B, businessDate: date, lines },
  });
  const close = (
    id: string,
    dayId: string,
    cash: Record<string, number>,
  ): DrawerCommand => ({
    id,
    type: "day.close",
    payload: { dayId, branchId: B, declared: { cash } },
  });
  const strict = (device: string, command: DrawerCommand) => ({
    ...from(device, command),
    strict: true,
  });
  const hubWith = (
    state: DayStateLike,
    asOf = "2026-11-09T08:00:00.000Z",
    store: HubStore = new MemoryHubStore(),
  ) => {
    const hub = new Hub(store, { branchId: B });
    hub.setSnapshot(state, asOf);
    return hub;
  };

  it("one closing per day: the second computer is told the day is no longer open, and nothing is recorded for it", () => {
    const hub = hubWith(mon({ "100": 10 }));
    expect(
      hub.submit(strict("pc1", close("c1", "mon", { "100": 10 }))),
    ).toMatchObject({ seq: 1, covered: true });
    expect(
      hub.submit(strict("pc2", close("c2", "mon", { "100": 9 }))),
    ).toMatchObject({ taken: true, reason: "day-not-open", seq: 0 });
    expect(hub.since(0)).toHaveLength(1);
    expect(hub.view()).toMatchObject({
      status: "closed",
      carryOver: { "100": 10 },
    });
  });

  it("one opening per day: the second computer is told the day is already open", () => {
    const hub = hubWith(mon({ "100": 10 }));
    hub.submit(strict("pc1", close("c1", "mon", { "100": 10 })));
    expect(
      hub.submit(strict("pc1", open("tue", "2026-11-10", { "100": 10 }))),
    ).toMatchObject({ covered: true });
    expect(
      hub.submit(strict("pc2", open("tue2", "2026-11-10", { "100": 10 }))),
    ).toMatchObject({ taken: true, reason: "day-open" });
    expect(hub.view()).toMatchObject({
      status: "open",
      dayId: "tue",
      balance: { "100": 10 },
      local: true,
    });
  });

  it("notes are reserved against the day opened on the hub, across the rollover", () => {
    const hub = hubWith(mon({ "100": 10 }));
    hub.submit(strict("pc1", pay("t1", { "100": 4 })));
    hub.submit(strict("pc1", close("c1", "mon", { "100": 6 })));
    hub.submit(strict("pc2", open("tue", "2026-11-10", { "100": 6 })));
    expect(hub.submit(strict("pc1", pay("t2", { "100": 5 })))).toMatchObject({
      covered: true,
    });
    expect(hub.submit(strict("pc2", pay("t3", { "100": 2 })))).toMatchObject({
      taken: true,
      short: { "100": 1 },
    });
    expect(hub.view().balance).toEqual({ "100": 1 });
  });

  it("an opening copied late (made while the hub was away) is recorded even though a day is open: reality wins", () => {
    const hub = hubWith(mon({ "100": 10 }));
    const r = hub.submit(from("pc2", open("mon2", "2026-11-09", { "100": 9 })));
    expect(r).toMatchObject({ covered: false, seq: 1 });
    expect(hub.view()).toMatchObject({
      dayId: "mon",
      aliases: { mon2: "mon" },
    });
    // its closing, under the second id, closes the open day
    expect(
      hub.submit(strict("pc2", close("c1", "mon2", { "100": 10 }))),
    ).toMatchObject({ covered: true });
    expect(hub.view().status).toBe("closed");
  });

  it("yesterday's entries are not counted again today, even though the server's applied list starts over each day", () => {
    const hub = hubWith(mon({ "100": 10 }));
    hub.submit(strict("pc1", pay("t1", { "100": 4 })));
    // the server has t1 (Monday's answer lists it) ...
    hub.setSnapshot(
      mon({ "100": 6 }, ["mon", "t1"]),
      "2026-11-09T12:00:00.000Z",
    );
    // ... and on Tuesday its list no longer mentions t1
    const tue: DayStateLike = {
      day: {
        id: "tue",
        status: "open",
        businessDate: "2026-11-10",
        opening: { lines: { "100": 6 } },
        closing: null,
      },
      balance: { "100": 6 },
      appliedIds: ["tue"],
      carryOver: { "100": 6 },
    };
    hub.setSnapshot(tue, "2026-11-10T08:00:00.000Z");
    expect(hub.view()).toMatchObject({
      balance: { "100": 6 },
      pendingCount: 0,
    });
    expect(hub.state().entries).toHaveLength(0);
    expect(hub.since(0)).toHaveLength(1); // the log itself keeps everything
  });

  it("a computer can say the server has its entry, as of the answer it hands over", () => {
    const hub = hubWith(mon({ "100": 10 }));
    hub.submit(strict("pc1", pay("t1", { "100": 4 })));
    // confirmed as of an answer the hub does not have yet: still counted, or the payout would vanish from the drawer
    hub.confirm(["t1"], "2026-11-10T08:00:00.000Z");
    expect(hub.view().balance).toEqual({ "100": 6 });
    const tue: DayStateLike = {
      day: {
        id: "tue",
        status: "open",
        businessDate: "2026-11-10",
        opening: { lines: { "100": 6 } },
        closing: null,
      },
      balance: { "100": 6 },
      appliedIds: ["tue"],
      carryOver: { "100": 6 },
    };
    hub.setSnapshot(tue, "2026-11-10T08:00:00.000Z");
    expect(hub.view().balance).toEqual({ "100": 6 });
    expect(hub.state()).toMatchObject({
      entries: [],
      snapshot: { asOf: "2026-11-10T08:00:00.000Z" },
    });
  });

  it("confirmations survive a restart, and an older log file gains the column", () => {
    const file = tmpFile();
    const s1 = openSqlite(file);
    const hub = hubWith(mon({ "100": 10 }), "2026-11-09T08:00:00.000Z", s1);
    hub.submit(strict("pc1", pay("t1", { "100": 4 })));
    hub.setSnapshot(
      mon({ "100": 6 }, ["mon", "t1"]),
      "2026-11-09T12:00:00.000Z",
    );
    s1.close();
    const s2 = openSqlite(file);
    expect(new Hub(s2, { branchId: B }).state().entries).toHaveLength(0);
    expect(s2.get("t1")?.confirmedAsOf).toBe("2026-11-09T12:00:00.000Z");
  });
});
