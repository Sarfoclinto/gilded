import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DayStateLike, DrawerCommand } from "@gold/core";
import { loadOrCreateCert, type HubCert } from "./cert";
import { HubClient, HubError, pairWithHub } from "./client";
import { Hub } from "./hub";
import { decodePairing, encodePairing, MAX_DEVICES, Pairing } from "./pairing";
import { createHubServer } from "./server";
import { MemoryHubStore } from "./store";

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

let dir: string;
let cert: HubCert;
let other: HubCert;
let clock = 1_000_000;
let store: MemoryHubStore;
let hub: Hub;
let pairing: Pairing;
let server: ReturnType<typeof createHubServer>;
let port: number;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lan-"));
  cert = await loadOrCreateCert(path.join(dir, "a"));
  other = await loadOrCreateCert(path.join(dir, "b"));
  clock = 1_000_000;
  store = new MemoryHubStore();
  hub = new Hub(store, { branchId: "b" });
  hub.setSnapshot(day({ "100": 3 }), "2026-11-05T08:00:00.000Z");
  pairing = new Pairing(store, () => clock);
  server = createHubServer({
    hub,
    pairing,
    cert,
    branchId: "b",
    hubName: "Front desk",
  });
  port = await server.listen(0, "127.0.0.1");
});
afterEach(async () => {
  await server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const pairNew = async (name = "PC-2") => {
  const { code } = pairing.newCode();
  return pairWithHub({
    host: "127.0.0.1",
    port,
    code,
    fingerprintPrefix: cert.fingerprint.slice(0, 16),
    deviceName: name,
  });
};

describe("pairing text", () => {
  it("round trips and refuses nonsense", () => {
    const t = encodePairing({
      host: "192.168.1.5",
      port: 47600,
      code: "048213",
      fingerprint: cert.fingerprint,
    });
    expect(decodePairing(t)).toEqual({
      host: "192.168.1.5",
      port: 47600,
      code: "048213",
      fingerprintPrefix: cert.fingerprint.slice(0, 16),
    });
    expect(decodePairing("hello")).toBeNull();
    expect(
      decodePairing("192.168.1.5:99999#048213#" + "A".repeat(16)),
    ).toBeNull();
  });
});

describe("certificate", () => {
  it("is made once and reused after a restart", async () => {
    const again = await loadOrCreateCert(path.join(dir, "a"));
    expect(again.fingerprint).toBe(cert.fingerprint);
    expect(cert.fingerprint).toMatch(/^[0-9A-F]{64}$/);
  });
});

describe("pairing over a real TLS connection", () => {
  it("a computer with the right code and fingerprint pairs, then works with the hub", async () => {
    const link = await pairNew();
    expect(link.fingerprint).toBe(cert.fingerprint);
    expect(link).toMatchObject({ branchId: "b", hubName: "Front desk" });
    const c = new HubClient(link);
    const st = await c.status();
    expect(st.you.name).toBe("PC-2");
    expect(st.view.balance).toEqual({ "100": 3 });
  });

  it("two computers racing for notes are told apart by the hub", async () => {
    const a = new HubClient(await pairNew("PC-1"));
    const b = new HubClient(await pairNew("PC-2"));
    expect((await a.check(pay("t1", { "100": 2 }))).ok).toBe(true);
    expect(
      await a.submit({
        command: pay("t1", { "100": 2 }),
        userId: "u1",
        capturedAt: "2026-11-05T09:00:00.000Z",
      }),
    ).toMatchObject({ seq: 1, covered: true });
    expect(await b.check(pay("t2", { "100": 2 }))).toMatchObject({
      ok: false,
      short: { "100": 1 },
    });
    expect(
      await b.submit({
        command: pay("t2", { "100": 2 }),
        userId: "u2",
        capturedAt: "2026-11-05T09:00:01.000Z",
      }),
    ).toMatchObject({ seq: 2, covered: false });
    expect((await a.since(1)).map((e) => e.command.id)).toEqual(["t2"]);
  });

  it("who sent a command is the paired computer, not what the sender claims", async () => {
    const link = await pairNew("PC-1");
    await new HubClient(link).submit({
      command: pay("t1", { "100": 1 }),
      userId: "u1",
      capturedAt: "2026-11-05T09:00:00.000Z",
      ...({ deviceId: "someone-else" } as object),
    });
    expect(hub.since(0)[0]!.deviceId).toBe(link.deviceId);
  });

  it("refuses a wrong code, locks after five, and a code works only once", async () => {
    pairing.newCode();
    for (let i = 0; i < 4; i++)
      await expect(
        pairWithHub({
          host: "127.0.0.1",
          port,
          code: "000000x".slice(0, 6),
          fingerprintPrefix: cert.fingerprint.slice(0, 16),
          deviceName: "x",
        }),
      ).rejects.toMatchObject({ code: "BAD_CODE" });
    await expect(
      pairWithHub({
        host: "127.0.0.1",
        port,
        code: "000000",
        fingerprintPrefix: cert.fingerprint.slice(0, 16),
        deviceName: "x",
      }),
    ).rejects.toMatchObject({ code: "LOCKED" });
    const { code } = pairing.newCode();
    const ok = {
      host: "127.0.0.1",
      port,
      code,
      fingerprintPrefix: cert.fingerprint.slice(0, 16),
      deviceName: "x",
    };
    await pairWithHub(ok);
    await expect(pairWithHub(ok)).rejects.toMatchObject({ code: "EXPIRED" });
  });

  it("a code expires after ten minutes", async () => {
    const { code } = pairing.newCode();
    clock += 11 * 60_000;
    await expect(
      pairWithHub({
        host: "127.0.0.1",
        port,
        code,
        fingerprintPrefix: cert.fingerprint.slice(0, 16),
        deviceName: "x",
      }),
    ).rejects.toMatchObject({ code: "EXPIRED" });
  });

  it("turns away something that is not the hub (certificate does not start with the shown fingerprint)", async () => {
    const { code } = pairing.newCode();
    await expect(
      pairWithHub({
        host: "127.0.0.1",
        port,
        code,
        fingerprintPrefix: other.fingerprint.slice(0, 16),
        deviceName: "x",
      }),
    ).rejects.toMatchObject({ code: "CERT_CHANGED" });
    expect(pairing.list()).toHaveLength(0); // the code never reached a stranger and was not used
  });

  it("stops talking if the hub later shows a different certificate", async () => {
    const link = await pairNew();
    await server.close();
    server = createHubServer({
      hub,
      pairing,
      cert: other,
      branchId: "b",
      hubName: "Front desk",
    });
    port = await server.listen(0, "127.0.0.1");
    await expect(
      new HubClient({ ...link, port }).status(),
    ).rejects.toMatchObject({ code: "CERT_CHANGED" });
  });

  it("refuses anyone without a token or with a revoked one", async () => {
    const link = await pairNew();
    await expect(
      new HubClient({ ...link, token: "nope" }).status(),
    ).rejects.toMatchObject({ code: "NOT_PAIRED", status: 401 });
    expect(pairing.revoke(link.deviceId)).toBe(true);
    await expect(new HubClient(link).status()).rejects.toMatchObject({
      code: "NOT_PAIRED",
    });
  });

  it("allows at most five computers", async () => {
    for (let i = 0; i < MAX_DEVICES; i++) await pairNew(`PC-${i}`);
    await expect(pairNew("PC-6")).rejects.toMatchObject({ code: "FULL" });
  });

  it("keeps only a hash of each token", async () => {
    const link = await pairNew();
    expect(store.getMeta("devices")).not.toContain(link.token);
  });

  it("reports unreachable when nothing is listening, so the machine can fall back to working alone", async () => {
    const link = await pairNew();
    await server.close();
    const err = await new HubClient(link).status().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HubError);
    expect((err as HubError).unreachable).toBe(true);
    server = createHubServer({
      hub,
      pairing,
      cert,
      branchId: "b",
      hubName: "x",
    });
    port = await server.listen(0, "127.0.0.1"); // so afterEach can close
  });

  it("takes the server answer from any paired computer and ignores an older one", async () => {
    const c = new HubClient(await pairNew());
    expect(
      await c.snapshot(day({ "100": 9 }), "2026-11-05T10:00:00.000Z"),
    ).toEqual({ accepted: true });
    expect(
      await c.snapshot(day({ "100": 1 }), "2026-11-05T07:00:00.000Z"),
    ).toEqual({ accepted: false });
    expect((await c.view()).balance).toEqual({ "100": 9 });
  });

  it("rejects broken requests without crashing", async () => {
    const c = new HubClient(await pairNew());
    await expect(c.check({ nonsense: true } as never)).rejects.toMatchObject({
      code: "BAD_COMMAND",
      status: 422,
    });
    expect((await c.status()).view.status).toBe("open"); // still serving
  });
});
