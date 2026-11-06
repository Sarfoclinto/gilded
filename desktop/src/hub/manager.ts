import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadOrCreateCert, type HubCert } from './cert';
import { HubClient, HubError, pairWithHub, type HubLink } from './client';
import type { DayStateLike, DrawerCommand } from '@gold/core';
import type { SubmitResult } from './hub';
import type { StoredEntry } from './store';
import { Hub } from './hub';
import { decodePairing, encodePairing, Pairing, type PairedDevice } from './pairing';
import { createHubServer } from './server';
import { SqliteHubStore, type HubStore } from './store';

export const HUB_PORT = 47600;
/** The hub computer's own commands are filed under this name in its log. */
export const HUB_SELF = 'hub-local';

export type Role = 'off' | 'hub' | 'member';

interface Saved {
  role: Role;
  /** Set on a hub computer: the branch it serves. */
  branchId?: string;
  hubName?: string;
  /** Set on a member computer: how to reach its hub. */
  link?: HubLink & { hubName: string; branchId: string; deviceId?: string };
}

export type MemberState = 'connected' | 'unreachable' | 'different-hub' | 'not-paired';

export interface HubState {
  role: Role;
  hub?: { running: boolean; address: string; port: number; name: string; devices: PairedDevice[]; code: { text: string; code: string; expiresAt: string } | null; error?: string };
  member?: { hubName: string; address: string; state: MemberState; lastOk: string | null };
  /** This computer's own id in the hub's log, so its screens can tell its own commands from the others'. */
  selfId?: string;
}

export interface ManagerDeps {
  /** Folder for this computer's hub files (config, log, certificate). */
  dir: string;
  /** Test hook: how to find this computer's address on the branch network. */
  address?: () => string;
  /** Test hook: open the log somewhere other than a file. */
  openStore?: () => HubStore;
  now?: () => number;
}

/** The first private IPv4 address of this computer, i.e. the one the other computers can reach. */
export function lanAddress(): string {
  const nets = os.networkInterfaces();
  const all = Object.values(nets).flatMap((n) => n ?? []).filter((n) => n.family === 'IPv4' && !n.internal);
  const priv = all.find((n) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(n.address));
  return (priv ?? all[0])?.address ?? '127.0.0.1';
}

/**
 * What this computer is in its branch: nothing special (`off`, as today), the hub (`hub`: runs the shared log and the LAN service),
 * or a member that talks to the hub (`member`). The choice is saved, so it comes back after a restart. A member that cannot reach
 * its hub just reports `unreachable`; the screens then keep working alone, exactly as they do without a hub.
 */
export class HubManager {
  private saved: Saved = { role: 'off' };
  private store: HubStore | null = null;
  private hub: Hub | null = null;
  private pairing: Pairing | null = null;
  private server: ReturnType<typeof createHubServer> | null = null;
  private cert: HubCert | null = null;
  private port = HUB_PORT;
  private error: string | undefined;
  private code: { text: string; code: string; expiresAt: string } | null = null;
  private client: HubClient | null = null;
  private memberState: MemberState = 'unreachable';
  private lastOk: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(s: HubState) => void>();

  constructor(private deps: ManagerDeps) {}

  private file = () => path.join(this.deps.dir, 'hub-config.json');
  private address = () => (this.deps.address ?? lanAddress)();

  async start(): Promise<void> {
    try {
      this.saved = JSON.parse(fs.readFileSync(this.file(), 'utf8')) as Saved;
    } catch {
      this.saved = { role: 'off' };
    }
    await this.apply();
  }

  private persist() {
    fs.mkdirSync(this.deps.dir, { recursive: true });
    fs.writeFileSync(this.file(), JSON.stringify(this.saved), { mode: 0o600 });
  }

  private async apply() {
    await this.stopAll();
    if (this.saved.role === 'hub') await this.startHub();
    else if (this.saved.role === 'member' && this.saved.link) this.startMember();
    this.emit();
  }

  private async startHub() {
    this.error = undefined;
    try {
      this.store = this.deps.openStore ? this.deps.openStore() : new SqliteHubStore(path.join(this.deps.dir, 'hub.db'));
      this.cert = await loadOrCreateCert(this.deps.dir);
      this.hub = new Hub(this.store, { branchId: this.saved.branchId ?? '' });
      this.pairing = new Pairing(this.store, this.deps.now);
      this.server = createHubServer({ hub: this.hub, pairing: this.pairing, cert: this.cert, branchId: this.saved.branchId ?? '', hubName: this.saved.hubName ?? 'Hub' });
      this.port = await this.server.listen(this.port === 0 ? 0 : HUB_PORT);
    } catch (e) {
      this.error = (e as { code?: string }).code === 'EADDRINUSE' ? `Port ${HUB_PORT} is already in use on this computer.` : 'The hub could not start.';
      await this.stopAll();
      this.saved = { ...this.saved }; // keep the choice; the person sees the problem
    }
  }

  private startMember() {
    const l = this.saved.link!;
    this.client = new HubClient(l);
    this.memberState = 'unreachable';
    const poll = async () => {
      try {
        await this.client!.status();
        this.memberState = 'connected';
        this.lastOk = new Date().toISOString();
      } catch (e) {
        const code = e instanceof HubError ? e.code : '';
        this.memberState = code === 'CERT_CHANGED' ? 'different-hub' : code === 'NOT_PAIRED' ? 'not-paired' : 'unreachable';
      }
      this.emit();
    };
    void poll();
    this.timer = setInterval(() => void poll(), 10_000);
    this.timer.unref?.();
  }

  private async stopAll() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.client = null;
    await this.server?.close();
    this.server = null;
    this.store?.close();
    this.store = null;
    this.hub = null;
    this.pairing = null;
    this.code = null;
  }

  state(): HubState {
    const s: HubState = { role: this.saved.role, ...(this.saved.role === 'hub' ? { selfId: HUB_SELF } : this.saved.role === 'member' && this.saved.link?.deviceId ? { selfId: this.saved.link.deviceId } : {}) };
    if (this.saved.role === 'hub') {
      s.hub = { running: !!this.server, address: this.address(), port: this.port, name: this.saved.hubName ?? 'Hub', devices: this.pairing?.list() ?? [], code: this.liveCode(), error: this.error };
    } else if (this.saved.role === 'member' && this.saved.link) {
      s.member = { hubName: this.saved.link.hubName, address: `${this.saved.link.host}:${this.saved.link.port}`, state: this.memberState, lastOk: this.lastOk };
    }
    return s;
  }

  private liveCode() {
    if (this.code && !this.pairing?.hasCode) this.code = null; // used, locked or expired
    return this.code;
  }

  onChange(l: (s: HubState) => void) {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }
  private emit() {
    const s = this.state();
    this.listeners.forEach((l) => l(s));
  }

  /** Make this computer the branch hub. */
  async becomeHub(branchId: string, name: string): Promise<HubState> {
    this.saved = { role: 'hub', branchId, hubName: name.trim().slice(0, 60) || 'Hub' };
    this.persist();
    await this.apply();
    return this.state();
  }

  /** Back to working alone. A hub keeps its log on disk; turning it off does not erase it. */
  async turnOff(): Promise<HubState> {
    this.saved = { role: 'off' };
    this.persist();
    await this.apply();
    return this.state();
  }

  /** On the hub: a fresh pairing code and the one line to type on the other computer. */
  newCode(): HubState {
    if (!this.pairing || !this.cert) return this.state();
    const c = this.pairing.newCode();
    this.code = { code: c.code, expiresAt: c.expiresAt, text: encodePairing({ host: this.address(), port: this.port, code: c.code, fingerprint: this.cert.fingerprint }) };
    this.emit();
    return this.state();
  }

  revoke(id: string): HubState {
    this.pairing?.revoke(id);
    this.emit();
    return this.state();
  }

  /** On another computer: join the hub with the line the hub showed. */
  async join(text: string, deviceName: string): Promise<HubState> {
    const p = decodePairing(text);
    if (!p) throw new HubError('BAD_PAIRING_TEXT', 'That does not look like the line shown on the hub computer.');
    const r = await pairWithHub({ ...p, deviceName });
    this.saved = { role: 'member', link: { host: r.host, port: r.port, certPem: r.certPem, fingerprint: r.fingerprint, token: r.token, hubName: r.hubName, branchId: r.branchId, deviceId: r.deviceId } };
    this.persist();
    await this.apply();
    return this.state();
  }

  /**
   * What the screens do with the hub, the same on the hub computer (straight into its own log) and on a member (over the link).
   * An unreachable hub is not an error for the screens: they report `unreachable` and carry on alone.
   */
  async share<T>(fn: (a: ShareAccess) => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; unreachable: boolean; message: string }> {
    const access = this.access();
    if (!access) return { ok: false, unreachable: true, message: 'No hub.' };
    try {
      return { ok: true, data: await fn(access) };
    } catch (e) {
      if (e instanceof HubError) {
        if (e.code === 'CERT_CHANGED') this.memberState = 'different-hub';
        else if (e.code === 'NOT_PAIRED') this.memberState = 'not-paired';
        return { ok: false, unreachable: e.unreachable || e.code === 'CERT_CHANGED' || e.code === 'NOT_PAIRED', message: e.message };
      }
      return { ok: false, unreachable: false, message: 'The hub could not do that.' };
    }
  }

  private access(): ShareAccess | null {
    if (this.saved.role === 'hub' && this.hub) {
      const hub = this.hub;
      return {
        submit: async (r) => hub.submit({ command: r.command, deviceId: HUB_SELF, userId: r.userId, capturedAt: r.capturedAt, localSeq: r.localSeq, strict: r.strict }),
        since: async (after) => hub.since(after),
        snapshot: async (state, asOf) => ({ accepted: hub.setSnapshot(state, asOf) }),
      };
    }
    const c = this.client;
    if (this.saved.role === 'member' && c) {
      return { submit: (r) => c.submit(r), since: (after) => c.since(after), snapshot: (state, asOf) => c.snapshot(state, asOf) };
    }
    return null;
  }

  /** The connection for the screens' own use (phase 5), when this computer is a member. */
  memberClient(): HubClient | null {
    return this.client;
  }
  localHub(): Hub | null {
    return this.hub;
  }

  async stop() {
    await this.stopAll();
  }
}

export interface ShareAccess {
  submit(r: { command: DrawerCommand; userId: string; capturedAt: string; localSeq?: number; strict?: boolean }): Promise<SubmitResult>;
  since(after: number): Promise<StoredEntry[]>;
  snapshot(state: DayStateLike, asOf: string): Promise<{ accepted: boolean }>;
}