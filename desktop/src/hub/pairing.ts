import {
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import type { HubStore } from "./store";

export interface PairedDevice {
  id: string;
  name: string;
  pairedAt: string;
  lastSeen: string | null;
}

interface StoredDevice extends PairedDevice {
  /** SHA-256 of the token; the token itself is not kept. */
  tokenHash: string;
}

const CODE_LIFE_MS = 10 * 60_000;
const MAX_WRONG = 5;
export const MAX_DEVICES = 5;

const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const safeEqual = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export type PairResult =
  | { ok: true; token: string; deviceId: string }
  | { ok: false; reason: "bad-code" | "expired" | "locked" | "full" };

/**
 * Pairing: the person at the hub computer asks for a code (six digits, valid ten minutes, used once). Typing it on another computer
 * gives that computer a long random token, which it sends with every request afterwards. After five wrong tries the code is
 * thrown away, so it cannot be guessed. At most five computers per branch.
 */
export class Pairing {
  private code: { value: string; expiresAt: number; wrong: number } | null =
    null;
  constructor(
    private store: HubStore,
    private now: () => number = Date.now,
  ) {}

  newCode(): { code: string; expiresAt: string } {
    const value = String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.code = { value, expiresAt: this.now() + CODE_LIFE_MS, wrong: 0 };
    return {
      code: value,
      expiresAt: new Date(this.code.expiresAt).toISOString(),
    };
  }

  /** Is there a code that can still be used? */
  get hasCode(): boolean {
    return !!this.code && this.now() <= this.code.expiresAt;
  }

  cancelCode() {
    this.code = null;
  }

  private devices(): StoredDevice[] {
    const raw = this.store.getMeta("devices");
    return raw ? (JSON.parse(raw) as StoredDevice[]) : [];
  }
  private save(d: StoredDevice[]) {
    this.store.setMeta("devices", JSON.stringify(d));
  }

  redeem(code: string, deviceName: string): PairResult {
    const c = this.code;
    if (!c) return { ok: false, reason: "expired" };
    if (this.now() > c.expiresAt) {
      this.code = null;
      return { ok: false, reason: "expired" };
    }
    if (!safeEqual(code.trim(), c.value)) {
      c.wrong++;
      if (c.wrong >= MAX_WRONG) {
        this.code = null;
        return { ok: false, reason: "locked" };
      }
      return { ok: false, reason: "bad-code" };
    }
    const devices = this.devices();
    if (devices.length >= MAX_DEVICES) return { ok: false, reason: "full" };
    this.code = null; // used once
    const token = randomBytes(32).toString("base64url");
    const id = randomBytes(8).toString("hex");
    devices.push({
      id,
      name: deviceName.trim().slice(0, 60) || "Computer",
      pairedAt: new Date(this.now()).toISOString(),
      lastSeen: null,
      tokenHash: hash(token),
    });
    this.save(devices);
    return { ok: true, token, deviceId: id };
  }

  /** The paired computer this token belongs to, or null. */
  authenticate(token: string): PairedDevice | null {
    const h = hash(token);
    const devices = this.devices();
    const d = devices.find((x) => safeEqual(x.tokenHash, h));
    if (!d) return null;
    d.lastSeen = new Date(this.now()).toISOString();
    this.save(devices);
    return {
      id: d.id,
      name: d.name,
      pairedAt: d.pairedAt,
      lastSeen: d.lastSeen,
    };
  }

  list(): PairedDevice[] {
    return this.devices().map(({ tokenHash: _t, ...d }) => d);
  }

  revoke(id: string): boolean {
    const devices = this.devices();
    const next = devices.filter((d) => d.id !== id);
    if (next.length === devices.length) return false;
    this.save(next);
    return true;
  }
}

/** What the hub shows and the other computer types: address, code and the start of the certificate fingerprint, in one line. */
export const encodePairing = (p: {
  host: string;
  port: number;
  code: string;
  fingerprint: string;
}) =>
  `${p.host}:${p.port}#${p.code}#${p.fingerprint.slice(0, 16).toUpperCase()}`;

export function decodePairing(
  text: string,
): {
  host: string;
  port: number;
  code: string;
  fingerprintPrefix: string;
} | null {
  const m = /^\s*([^\s:#]+):(\d{2,5})#(\d{6})#([0-9A-Fa-f]{16})\s*$/.exec(text);
  if (!m) return null;
  const port = Number(m[2]);
  if (port < 1 || port > 65535) return null;
  return {
    host: m[1]!,
    port,
    code: m[3]!,
    fingerprintPrefix: m[4]!.toUpperCase(),
  };
}
