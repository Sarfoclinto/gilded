import { DatabaseSync } from "node:sqlite";
import type { DayStateLike, DrawerCommand } from "@gold/core";

/** One command in the branch log, as the hub keeps it. */
export interface StoredEntry {
  /** The hub's number for it. Strictly increasing, never reused. */
  seq: number;
  command: DrawerCommand;
  deviceId: string;
  userId: string;
  /** ISO time on the machine that made it. */
  capturedAt: string;
  localSeq: number;
  /** ISO time the hub received it. */
  receivedAt: string;
  /** False when the drawer could not cover it at its place in the order. It is kept and counted regardless. */
  covered: boolean;
  /** Notes missing at that point, per denomination. */
  short: Record<string, number>;
  /** The signed envelope as the machine made it, kept so it can be sent on to the server unchanged. */
  signed: {
    deviceId: string;
    capturedAt: string;
    payloadJson: string;
    signature: string;
  } | null;
  /**
   * Set once the server is known to have the command: the `asOf` of a server answer that includes it. From then on the command is
   * left out whenever the hub's stored server answer is at least that new. It is what keeps yesterday's entries from being counted
   * again today, when the server's list of applied ids only covers the day that is open.
   */
  confirmedAsOf?: string | null;
}

export interface Snapshot {
  state: DayStateLike;
  /** When the server produced it (its `asOf`). A newer one replaces an older one, never the reverse. */
  asOf: string;
}

export interface HubStore {
  /** Appends and returns the stored entry with its number, or the existing one when the command id was already stored. */
  append(e: Omit<StoredEntry, "seq">): {
    entry: StoredEntry;
    duplicate: boolean;
  };
  /** Entries with a number above `after`, in order. */
  since(after: number, limit?: number): StoredEntry[];
  all(): StoredEntry[];
  get(commandId: string): StoredEntry | undefined;
  /** Marks commands as known to the server as of that server answer. A command already marked keeps its earlier mark. */
  confirm(commandIds: string[], asOf: string): void;
  getSnapshot(): Snapshot | null;
  setSnapshot(s: Snapshot): void;
  /** Hub-wide settings that must survive a restart (branch id, pairing). */
  getMeta(key: string): string | null;
  setMeta(key: string, value: string): void;
  close(): void;
}

export class MemoryHubStore implements HubStore {
  private entries: StoredEntry[] = [];
  private snap: Snapshot | null = null;
  private meta = new Map<string, string>();
  append(e: Omit<StoredEntry, "seq">) {
    const existing = this.get(e.command.id);
    if (existing) return { entry: existing, duplicate: true };
    const entry = {
      ...structuredClone(e),
      seq: (this.entries.at(-1)?.seq ?? 0) + 1,
    };
    this.entries.push(entry);
    return { entry: structuredClone(entry), duplicate: false };
  }
  since(after: number, limit = 500) {
    return this.entries
      .filter((e) => e.seq > after)
      .slice(0, limit)
      .map((e) => structuredClone(e));
  }
  all() {
    return this.entries.map((e) => structuredClone(e));
  }
  get(id: string) {
    const e = this.entries.find((x) => x.command.id === id);
    return e ? structuredClone(e) : undefined;
  }
  confirm(ids: string[], asOf: string) {
    const set = new Set(ids);
    for (const e of this.entries)
      if (set.has(e.command.id) && !e.confirmedAsOf) e.confirmedAsOf = asOf;
  }
  getSnapshot() {
    return this.snap ? structuredClone(this.snap) : null;
  }
  setSnapshot(s: Snapshot) {
    this.snap = structuredClone(s);
  }
  getMeta(k: string) {
    return this.meta.get(k) ?? null;
  }
  setMeta(k: string, v: string) {
    this.meta.set(k, v);
  }
  close() {}
}

interface Row {
  seq: number;
  id: string;
  device_id: string;
  user_id: string;
  type: string;
  captured_at: string;
  local_seq: number;
  received_at: string;
  covered: number;
  short: string;
  command: string;
  signed: string | null;
  confirmed_as_of?: string | null;
}

/**
 * The hub's log on disk, in Node's built-in SQLite (no add-on to compile). WAL mode, and synchronous=FULL, so a command the hub
 * has acknowledged is on disk even if the computer loses power a moment later.
 */
export class SqliteHubStore implements HubStore {
  private db: DatabaseSync;
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS log (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        device_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        local_seq INTEGER NOT NULL,
        received_at TEXT NOT NULL,
        covered INTEGER NOT NULL,
        short TEXT NOT NULL,
        command TEXT NOT NULL,
        signed TEXT
      );
      CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), as_of TEXT NOT NULL, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    // Added later (B53): a log file made by an earlier version gets the column the first time it is opened.
    const cols = this.db.prepare("PRAGMA table_info(log)").all() as unknown as {
      name: string;
    }[];
    if (!cols.some((c) => c.name === "confirmed_as_of"))
      this.db.exec("ALTER TABLE log ADD COLUMN confirmed_as_of TEXT");
  }
  private toEntry(r: Row): StoredEntry {
    return {
      seq: r.seq,
      command: JSON.parse(r.command) as DrawerCommand,
      deviceId: r.device_id,
      userId: r.user_id,
      capturedAt: r.captured_at,
      localSeq: r.local_seq,
      receivedAt: r.received_at,
      covered: r.covered === 1,
      short: JSON.parse(r.short) as Record<string, number>,
      signed: r.signed ? (JSON.parse(r.signed) as StoredEntry["signed"]) : null,
      confirmedAsOf: r.confirmed_as_of ?? null,
    };
  }
  get(id: string) {
    const r = this.db
      .prepare("SELECT * FROM log WHERE id = ?")
      .get(id) as unknown as Row | undefined;
    return r ? this.toEntry(r) : undefined;
  }
  append(e: Omit<StoredEntry, "seq">) {
    const existing = this.get(e.command.id);
    if (existing) return { entry: existing, duplicate: true };
    this.db
      .prepare(
        "INSERT INTO log (id, device_id, user_id, type, captured_at, local_seq, received_at, covered, short, command, signed) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        e.command.id,
        e.deviceId,
        e.userId,
        e.command.type,
        e.capturedAt,
        e.localSeq,
        e.receivedAt,
        e.covered ? 1 : 0,
        JSON.stringify(e.short),
        JSON.stringify(e.command),
        e.signed ? JSON.stringify(e.signed) : null,
      );
    return { entry: this.get(e.command.id)!, duplicate: false };
  }
  since(after: number, limit = 500) {
    return (
      this.db
        .prepare("SELECT * FROM log WHERE seq > ? ORDER BY seq LIMIT ?")
        .all(after, limit) as unknown as Row[]
    ).map((r) => this.toEntry(r));
  }
  all() {
    return (
      this.db
        .prepare("SELECT * FROM log ORDER BY seq")
        .all() as unknown as Row[]
    ).map((r) => this.toEntry(r));
  }
  confirm(ids: string[], asOf: string) {
    const stmt = this.db.prepare(
      "UPDATE log SET confirmed_as_of = ? WHERE id = ? AND confirmed_as_of IS NULL",
    );
    for (const id of ids) stmt.run(asOf, id);
  }
  getSnapshot() {
    const r = this.db
      .prepare("SELECT as_of, state FROM snapshot WHERE id = 1")
      .get() as unknown as { as_of: string; state: string } | undefined;
    return r
      ? { asOf: r.as_of, state: JSON.parse(r.state) as DayStateLike }
      : null;
  }
  setSnapshot(s: Snapshot) {
    this.db
      .prepare(
        "INSERT INTO snapshot (id, as_of, state) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET as_of = excluded.as_of, state = excluded.state",
      )
      .run(s.asOf, JSON.stringify(s.state));
  }
  getMeta(k: string) {
    const r = this.db
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get(k) as unknown as { value: string } | undefined;
    return r?.value ?? null;
  }
  setMeta(k: string, v: string) {
    this.db
      .prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(k, v);
  }
  close() {
    this.db.close();
  }
}
