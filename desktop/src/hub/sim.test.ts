import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DayStateLike, DrawerCommand } from "@gold/core";
import { Hub } from "./hub";
import { SqliteHubStore } from "./store";

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
