/**
 * Where queued commands are kept. IndexedDB survives closing the tab and a phone restart.
 * If IndexedDB is unavailable (some private modes) we fall back to memory so the app still works,
 * and the UI is told the queue is not durable.
 */
export interface OutboxEntry<P = unknown> {
  /** Command id. For a transaction this is the transaction id and the Idempotency-Key. */
  id: string;
  type: string;
  /** Who saved it. Only that person's session sends it, so a purchase is never recorded under someone else. */
  userId?: string;
  payload: P;
  status: "pending" | "syncing" | "failed";
  attempts: number;
  createdAt: number;
  nextAttemptAt: number;
  lastError?: { code?: string; message: string };
}

export interface OutboxStore {
  readonly durable: boolean;
  getAll(): Promise<OutboxEntry[]>;
  put(entry: OutboxEntry): Promise<void>;
  remove(id: string): Promise<void>;
}

export class MemoryOutboxStore implements OutboxStore {
  readonly durable = false;
  private map = new Map<string, OutboxEntry>();
  async getAll() {
    return [...this.map.values()].map((e) => structuredClone(e));
  }
  async put(entry: OutboxEntry) {
    this.map.set(entry.id, structuredClone(entry));
  }
  async remove(id: string) {
    this.map.delete(id);
  }
}

const DB = "gold-offline";
const STORE = "outbox";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function wrap<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class IndexedDbOutboxStore implements OutboxStore {
  readonly durable = true;
  private db: Promise<IDBDatabase> = open();
  async getAll() {
    return wrap(
      await this.db,
      "readonly",
      (s) => s.getAll() as IDBRequest<OutboxEntry[]>,
    );
  }
  async put(entry: OutboxEntry) {
    await wrap(await this.db, "readwrite", (s) => s.put(entry));
  }
  async remove(id: string) {
    await wrap(await this.db, "readwrite", (s) => s.delete(id));
  }
}

export async function createBestStore(): Promise<OutboxStore> {
  try {
    if (typeof indexedDB === "undefined") return new MemoryOutboxStore();
    const store = new IndexedDbOutboxStore();
    await store.getAll(); // proves it opens and works
    return store;
  } catch {
    return new MemoryOutboxStore();
  }
}
