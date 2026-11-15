import type { PhotoRecord } from "./model";

/**
 * Where pictures wait on the device until they are sent. IndexedDB survives closing the tab and restarting the phone.
 * `photos` holds the small record and its thumbnail (cheap to list); `files` holds the full picture (read only when opened or sent).
 */
export interface StoredPhoto {
  record: PhotoRecord;
  thumb: Blob;
}
export interface PhotoStore {
  readonly durable: boolean;
  all(): Promise<StoredPhoto[]>;
  put(p: StoredPhoto, file?: Blob): Promise<void>;
  file(id: string): Promise<Blob | undefined>;
  dropFile(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export class MemoryPhotoStore implements PhotoStore {
  readonly durable = false;
  private meta = new Map<string, StoredPhoto>();
  private files = new Map<string, Blob>();
  async all() {
    return [...this.meta.values()].map((p) => ({
      record: { ...p.record },
      thumb: p.thumb,
    }));
  }
  async put(p: StoredPhoto, file?: Blob) {
    this.meta.set(p.record.id, { record: { ...p.record }, thumb: p.thumb });
    if (file) this.files.set(p.record.id, file);
  }
  async file(id: string) {
    return this.files.get(id);
  }
  async dropFile(id: string) {
    this.files.delete(id);
  }
  async remove(id: string) {
    this.meta.delete(id);
    this.files.delete(id);
  }
}

const DB = "gold-photos";
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("photos", { keyPath: "record.id" });
      req.result.createObjectStore("files");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const run = <T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => IDBRequest<T> | void,
): Promise<T | undefined> =>
  new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const req = fn(tx);
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

export async function openPhotoStore(): Promise<PhotoStore> {
  try {
    if (typeof indexedDB === "undefined") return new MemoryPhotoStore();
    const db = await open();
    return {
      durable: true,
      all: async () =>
        (await run<StoredPhoto[]>(db, ["photos"], "readonly", (tx) =>
          tx.objectStore("photos").getAll(),
        )) ?? [],
      put: async (p, file) => {
        await run(db, ["photos", "files"], "readwrite", (tx) => {
          tx.objectStore("photos").put(p);
          if (file) tx.objectStore("files").put(file, p.record.id);
        });
      },
      file: async (id) =>
        await run<Blob | undefined>(db, ["files"], "readonly", (tx) =>
          tx.objectStore("files").get(id),
        ),
      dropFile: async (id) => {
        await run(db, ["files"], "readwrite", (tx) => {
          tx.objectStore("files").delete(id);
        });
      },
      remove: async (id) => {
        await run(db, ["photos", "files"], "readwrite", (tx) => {
          tx.objectStore("photos").delete(id);
          tx.objectStore("files").delete(id);
        });
      },
    };
  } catch {
    return new MemoryPhotoStore();
  }
}
