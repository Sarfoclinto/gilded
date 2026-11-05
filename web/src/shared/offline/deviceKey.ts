import {
  generateKeyPair,
  publicKeyBase64,
  signCommand,
  type SignedPart,
} from "./signing";

/**
 * This device's identity for offline sync: a random device id and, for each person who uses the device, a signing key pair.
 * The private key is stored as a non-extractable CryptoKey in IndexedDB, so even someone with access to the browser's
 * storage cannot copy it out. If IndexedDB is unavailable the key lives in memory for this page load only.
 */
const DB = "gold-device";
const STORE = "keys";
const DEVICE_ID = "gold.deviceId.v1";

interface KeyRecord {
  userId: string;
  privateKey: CryptoKey;
  publicKey: string;
}

const memory = new Map<string, KeyRecord>();
let memoryDeviceId: string | null = null;

export function getDeviceId(): string {
  try {
    const stored = localStorage.getItem(DEVICE_ID);
    if (stored) return stored;
    const fresh = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID, fresh);
    return fresh;
  } catch {
    return (memoryDeviceId ??= crypto.randomUUID());
  }
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore(STORE, { keyPath: "userId" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(
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

async function readRecord(userId: string): Promise<KeyRecord | undefined> {
  const m = memory.get(userId);
  if (m) return m;
  try {
    if (typeof indexedDB === "undefined") return undefined;
    return (
      (await run(
        await open(),
        "readonly",
        (s) => s.get(userId) as IDBRequest<KeyRecord | undefined>,
      )) ?? undefined
    );
  } catch {
    return undefined;
  }
}

async function writeRecord(rec: KeyRecord): Promise<void> {
  memory.set(rec.userId, rec);
  try {
    if (typeof indexedDB === "undefined") return;
    await run(await open(), "readwrite", (s) => s.put(rec));
  } catch {
    /* kept in memory for this page load */
  }
}

/** The key for this person on this device; made the first time. */
export async function ensureDeviceKey(
  userId: string,
): Promise<{ deviceId: string; publicKey: string }> {
  let rec = await readRecord(userId);
  if (!rec) {
    const pair = await generateKeyPair();
    rec = {
      userId,
      privateKey: pair.privateKey,
      publicKey: await publicKeyBase64(pair.publicKey),
    };
    await writeRecord(rec);
  }
  return { deviceId: getDeviceId(), publicKey: rec.publicKey };
}

/** Signs a command for this person, or returns undefined when there is no key (then the command goes the normal way). */
export async function signForUser(c: {
  id: string;
  type: string;
  userId: string;
  capturedAt: string;
  payload: unknown;
}): Promise<SignedPart | undefined> {
  try {
    const rec = await readRecord(c.userId);
    if (!rec) return undefined;
    return await signCommand(rec.privateKey, { ...c, deviceId: getDeviceId() });
  } catch {
    return undefined;
  }
}

/** Remembers which key the server has, so registration happens once per key rather than at every sign-in. */
const regKey = (userId: string) => `gold.deviceReg.v1.${userId}`;
export const isRegistered = (userId: string, publicKey: string) => {
  try {
    return localStorage.getItem(regKey(userId)) === publicKey;
  } catch {
    return false;
  }
};
export const markRegistered = (userId: string, publicKey: string | null) => {
  try {
    if (publicKey) localStorage.setItem(regKey(userId), publicKey);
    else localStorage.removeItem(regKey(userId));
  } catch {
    /* ignore */
  }
};

/** For "Forget this device": removes every key here. */
export async function forgetDeviceKeys(): Promise<void> {
  memory.clear();
  try {
    if (typeof indexedDB !== "undefined")
      await run(await open(), "readwrite", (s) => s.clear());
    for (const k of Object.keys(localStorage))
      if (k.startsWith("gold.deviceReg.v1.")) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}
