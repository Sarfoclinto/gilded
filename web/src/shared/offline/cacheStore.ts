import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';

/**
 * Where the read cache is kept between visits. IndexedDB, not localStorage: it holds far more (recent transactions and debts
 * run to megabytes) and does not block the screen while writing. Falls back to localStorage if IndexedDB is unavailable.
 */
const DB = 'gold-cache';
const STORE = 'kv';
const KEY = 'rq';
const OLD_LOCAL_KEY = 'gold.rq.v1';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function createCachePersister(throttleMs = 250): Persister {
  const db = typeof indexedDB === 'undefined' ? null : open().catch(() => null);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest: PersistedClient | null = null;

  const flush = async () => {
    timer = null;
    const d = await db;
    const value = latest;
    if (!value) return;
    try {
      if (d) await run(d, 'readwrite', (s) => s.put(value, KEY));
      else localStorage.setItem(OLD_LOCAL_KEY, JSON.stringify(value));
    } catch {
      /* storage full or blocked: the live cache still works, it just will not survive a reload */
    }
  };

  return {
    persistClient: (client) => {
      latest = client;
      timer ??= setTimeout(() => void flush(), throttleMs);
    },
    restoreClient: async () => {
      const d = await db;
      try {
        if (d) {
          try {
            localStorage.removeItem(OLD_LOCAL_KEY); // the previous version of this cache
          } catch {
            /* ignore */
          }
          return (await run(d, 'readonly', (s) => s.get(KEY) as IDBRequest<PersistedClient | undefined>)) ?? undefined;
        }
        const raw = localStorage.getItem(OLD_LOCAL_KEY);
        return raw ? (JSON.parse(raw) as PersistedClient) : undefined;
      } catch {
        return undefined;
      }
    },
    removeClient: async () => {
      latest = null;
      const d = await db;
      try {
        if (d) await run(d, 'readwrite', (s) => s.delete(KEY));
        else localStorage.removeItem(OLD_LOCAL_KEY);
      } catch {
        /* nothing to remove */
      }
    },
  };
}