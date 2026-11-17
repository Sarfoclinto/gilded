import type { WorkingDoc } from "@gold/core";

/**
 * Sheets on this device. Every edit lands here first (IndexedDB, so it survives closing the tab), and goes to the server when there is a
 * connection. `dirty` means the server has not seen this version yet; `version` is the server version the device started from.
 */
export interface LocalSheet {
  id: string;
  owner: string;
  name: string;
  doc: WorkingDoc;
  version: number;
  dirty: boolean;
  updatedAt: number;
}

export interface SheetStore {
  all(owner: string): Promise<LocalSheet[]>;
  get(id: string): Promise<LocalSheet | undefined>;
  put(s: LocalSheet): Promise<void>;
  remove(id: string): Promise<void>;
}

class MemorySheetStore implements SheetStore {
  private m = new Map<string, LocalSheet>();
  async all(owner: string) {
    return [...this.m.values()].filter((s) => s.owner === owner);
  }
  async get(id: string) {
    return this.m.get(id);
  }
  async put(s: LocalSheet) {
    this.m.set(s.id, s);
  }
  async remove(id: string) {
    this.m.delete(id);
  }
}

const DB = "gold-workings";
const open = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("sheets", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
const run = <T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> =>
  new Promise((resolve, reject) => {
    const tx = db.transaction(["sheets"], mode);
    const req = fn(tx.objectStore("sheets"));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

let opened: Promise<SheetStore> | undefined;
export function openSheetStore(): Promise<SheetStore> {
  if (!opened) {
    opened = (async () => {
      try {
        if (typeof indexedDB === "undefined") return new MemorySheetStore();
        const db = await open();
        return {
          all: async (owner) =>
            (
              (await run<LocalSheet[]>(db, "readonly", (s) => s.getAll())) ?? []
            ).filter((s) => s.owner === owner),
          get: async (id) =>
            run<LocalSheet | undefined>(db, "readonly", (s) => s.get(id)),
          put: async (s) => {
            await run(db, "readwrite", (st) => {
              st.put(s);
            });
          },
          remove: async (id) => {
            await run(db, "readwrite", (st) => {
              st.delete(id);
            });
          },
        } satisfies SheetStore;
      } catch {
        return new MemorySheetStore();
      }
    })();
  }
  return opened;
}
