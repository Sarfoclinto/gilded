import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DayStateLike, DrawerCommand } from "@gold/core";
import { Hub } from "./hub";
import { MemoryHubStore, SqliteHubStore } from "./store";

/** Small seeded random generator, so a failing run can be repeated exactly. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DENOMS = ["200", "100", "50"];
const day = (balance: Record<string, number>): DayStateLike => ({
  day: {
    id: "d1",
    status: "open",
    businessDate: "2026-11-05",
    opening: { lines: balance },
    closing: null,
  },
  balance,
  appliedIds: [],
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

/**
 * Several computers hammer one hub at random: payouts reserved the careful way, payouts made while the hub was away and copied late,
 * top-ups, double sends, hub restarts, and computers whose clocks are hours wrong. Whatever the order, the rules below must hold.
 */
describe("hub under random branch life", () => {
  for (const seed of [1, 2, 3, 7, 11, 42, 99, 2026]) {
    it(`seed ${seed}`, () => {
      const rand = rng(seed);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hubsim-"));
      const file = path.join(dir, "hub.db");
      let store!: SqliteHubStore;
      try {
        store = new SqliteHubStore(file);
        const make = () =>
          new Hub(store, {
            branchId: "b",
            now: () => new Date("2026-11-05T09:00:00.000Z"),
          });
        let hub = make();
        const start = { "200": 2, "100": 4, "50": 6 };
        hub.setSnapshot(day(start), "2026-11-05T08:00:00.000Z");

        const skew = [0, 3_600_000, -7_200_000, 86_400_000];
        const seen = new Map<string, number>(); // command id -> seq the hub first gave it
        let lateSolo = 0;
        const sent: DrawerCommand[] = [];
        const lines = () => {
          const l: Record<string, number> = {};
          const d = DENOMS[Math.floor(rand() * 3)]!;
          l[d] = 1 + Math.floor(rand() * 3);
          return l;
        };

        for (let i = 0; i < 300; i++) {
          const device = `pc${1 + Math.floor(rand() * 3)}`;
          const when = new Date(
            Date.parse("2026-11-05T09:00:00.000Z") +
              skew[Math.floor(rand() * skew.length)]! +
              i * 1000,
          ).toISOString();
          const kind = rand();
          const base = {
            deviceId: device,
            userId: `u-${device}`,
            capturedAt: when,
            localSeq: i,
          };

          if (kind < 0.5) {
            // a careful payout: reserve, and only the winner is recorded
            const c = pay(`p${i}`, lines());
            const before = hub.view().balance;
            const r = hub.submit({ ...base, command: c, strict: true });
            if (r.taken) {
              expect(r.seq).toBe(0);
              expect(hub.view().balance).toEqual(before); // nothing recorded, nothing moved
            } else {
              expect(r.covered).toBe(true);
              seen.set(c.id, r.seq);
              sent.push(c);
            }
          } else if (kind < 0.7) {
            // made while the hub was away, copied afterwards: always recorded, flagged if the drawer could not have covered it
            const c = pay(`s${i}`, lines());
            const r = hub.submit({ ...base, command: c });
            seen.set(c.id, r.seq);
            sent.push(c);
            if (!r.covered) {
              lateSolo++;
              expect(Object.keys(r.short).length).toBeGreaterThan(0);
            }
          } else if (kind < 0.85) {
            const c = topup(`t${i}`, lines());
            const r = hub.submit({ ...base, command: c });
            expect(r.covered).toBe(true); // putting cash in is never short
            seen.set(c.id, r.seq);
            sent.push(c);
          } else if (kind < 0.95 && sent.length) {
            // the same command sent again (lost reply): same answer, nothing new
            const c = sent[Math.floor(rand() * sent.length)]!;
            const n = store.all().length;
            const r = hub.submit({ ...base, command: c });
            expect(r.duplicate).toBe(true);
            expect(r.seq).toBe(seen.get(c.id));
            expect(store.all().length).toBe(n);
          } else {
            // the hub computer restarts: everything must come back exactly
            const before = hub.view();
            store.close();
            store = new SqliteHubStore(file);
            hub = make();
            expect(hub.view()).toEqual(before);
          }

          // the order is always 1, 2, 3 with no gap and no repeat
          const all = store.all();
          expect(all.map((e) => e.seq)).toEqual(all.map((_, k) => k + 1));
        }

        if (process.env.SIM_LOG)
          console.log(seed, store.all().length, lateSolo);
        // if every payout was reserved the careful way, the drawer never went below zero
        const view = hub.view();
        if (lateSolo === 0)
          for (const d of DENOMS)
            expect(view.balance[d] ?? 0).toBeGreaterThanOrEqual(0);
        // every short entry is still in the log, in its place (reality wins)
        expect(store.all().filter((e) => !e.covered).length).toBe(lateSolo);
      } finally {
        try {
          store.close(); // Windows cannot delete a file that is still open
        } catch {
          /* never opened, or already closed */
        }
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

/**
 * B53: several days of branch life with the connection coming and going. The hub must always show the drawer that is really there:
 * days opened and closed on the hub, the server catching up at random moments, its applied list starting over each day.
 */
describe("hub across days, server catching up at random", () => {
  const B = "b";
  for (const seed of [3, 17, 99, 2026, 77777]) {
    it(`seed ${seed}`, () => {
      let s = seed;
      const rnd = (n: number) => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s % n;
      };
      const hub = new Hub(new MemoryHubStore(), { branchId: B });
      // the truth, kept separately
      let open = true;
      let dayNo = 1;
      let dayId = "day-1";
      let cash = 50;
      let clock = 0;
      const stamp = () =>
        `2026-11-${String(10 + Math.floor(clock / 1000)).padStart(2, "0")}T${String(clock % 1000).padStart(6, "0")}Z`;
      // what the server would have if it applied everything sent so far
      const unsent: {
        id: string;
        day: string;
        kind: "note" | "open" | "close";
      }[] = [];
      let serverDay = {
        id: dayId,
        status: "open",
        date: "2026-11-10",
        opening: 50,
        appliedToday: [dayId] as string[],
      };
      let serverCash = 50;
      const snapshot = () => {
        clock++;
        hub.setSnapshot(
          {
            day: {
              id: serverDay.id,
              status: serverDay.status,
              businessDate: serverDay.date,
              opening: { lines: { "100": serverDay.opening } },
              closing:
                serverDay.status === "closed"
                  ? { cash: { counted: { "100": serverCash } } }
                  : null,
            },
            balance: serverDay.status === "open" ? { "100": serverCash } : null,
            appliedIds: [...serverDay.appliedToday],
            carryOver: { "100": serverCash },
          },
          stamp(),
        );
      };
      snapshot();
      const notes: Record<string, number> = {};
      let n = 0;
      const base = (device: string) => ({
        deviceId: device,
        userId: "u",
        capturedAt: "2026-11-10T09:00:00.000Z",
        strict: true,
      });

      for (let step = 0; step < 250; step++) {
        const device = `pc${rnd(3)}`;
        const what = rnd(10);
        if (what < 5 && open) {
          const want = 1 + rnd(8);
          const id = `t${++n}`;
          const r = hub.submit({
            ...base(device),
            command: {
              id,
              type: "transaction.create",
              payload: { branchId: B, payout: { lines: { "100": want } } },
            },
          });
          if (want <= cash) {
            expect(r.taken).toBeFalsy();
            cash -= want;
            notes[id] = -want;
            unsent.push({ id, day: dayId, kind: "note" });
          } else expect(r).toMatchObject({ taken: true });
        } else if (what < 6 && open) {
          const add = 1 + rnd(20);
          const id = `m${++n}`;
          hub.submit({
            ...base(device),
            command: {
              id,
              type: "drawer.movement",
              payload: { dayId, kind: "topup", lines: { "100": add } },
            },
          });
          cash += add;
          notes[id] = add;
          unsent.push({ id, day: dayId, kind: "note" });
        } else if (what < 7) {
          if (open) {
            const id = `c${++n}`;
            expect(
              hub.submit({
                ...base(device),
                command: {
                  id,
                  type: "day.close",
                  payload: {
                    dayId,
                    branchId: B,
                    declared: { cash: { "100": cash } },
                  },
                },
              }).taken,
            ).toBeFalsy();
            // a second computer closing the same day is told it is no longer open
            expect(
              hub.submit({
                ...base("pcX"),
                command: {
                  id: `c${++n}`,
                  type: "day.close",
                  payload: {
                    dayId,
                    branchId: B,
                    declared: { cash: { "100": cash } },
                  },
                },
              }),
            ).toMatchObject({ taken: true, reason: "day-not-open" });
            open = false;
            unsent.push({ id, day: dayId, kind: "close" });
          } else {
            dayNo++;
            const id = `day-${dayNo}`;
            expect(
              hub.submit({
                ...base(device),
                command: {
                  id,
                  type: "day.open",
                  payload: {
                    id,
                    branchId: B,
                    businessDate: `2026-11-${9 + dayNo}`,
                    lines: { "100": cash },
                  },
                },
              }).taken,
            ).toBeFalsy();
            expect(
              hub.submit({
                ...base("pcX"),
                command: {
                  id: `dup-${dayNo}`,
                  type: "day.open",
                  payload: {
                    id: `dup-${dayNo}`,
                    branchId: B,
                    businessDate: `2026-11-${9 + dayNo}`,
                    lines: { "100": cash },
                  },
                },
              }),
            ).toMatchObject({ taken: true, reason: "day-open" });
            dayId = id;
            open = true;
            unsent.push({ id, day: id, kind: "open" });
          }
        } else if (what < 9 && unsent.length) {
          // the connection is back for a moment: the server takes some of what is waiting, in order, and a computer tells the hub
          const take = 1 + rnd(unsent.length);
          const sent = unsent.splice(0, take);
          for (const e of sent) {
            if (e.kind === "note") {
              serverCash += notes[e.id]!;
              serverDay.appliedToday.push(e.id);
            } else if (e.kind === "close") serverDay.status = "closed";
            else
              serverDay = {
                id: e.id,
                status: "open",
                date: `2026-11-${9 + Number(e.id.slice(4))}`,
                opening: serverCash,
                appliedToday: [e.id],
              };
          }
          snapshot();
          // The computer that sent them says so, with the answer it just handed over. This is what covers entries the server took
          // on a day that is already over by the time of this answer (its applied list no longer mentions them).
          hub.confirm(
            sent.map((e) => e.id),
            hub.state().snapshot!.asOf,
          );
        }
        const v = hub.view();
        expect(v.status).toBe(open ? "open" : "closed");
        if (open) {
          expect(v.dayId).toBe(dayId);
          expect(v.balance?.["100"] ?? 0).toBe(cash);
        } else expect(v.carryOver?.["100"] ?? 0).toBe(cash);
      }
    });
  }
});
