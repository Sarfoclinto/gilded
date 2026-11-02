import { offlineMaxAgeMs } from "@/shared/offline/policy";
import type { User } from "./schemas";

/**
 * Signing in with no connection.
 *
 * After every successful online sign-in this device keeps a salted PBKDF2 hash of the password (never the password) plus the
 * last profile the server sent. With no connection the same person can sign in by proving the password against that hash.
 * - Works only for people who have signed in on this device while online, and only for the company's offline allowance (7 days unless the Director changed it) after their last online contact.
 * - Permissions are those the server last sent. Revoking someone takes effect when this device next reaches the server.
 * - No access token exists in this mode; the first request after reconnecting trades the refresh cookie for one.
 */
const KEY = "gold.offlineLogin.v1";
const ITERATIONS = 600_000;

export interface OfflineRecord {
  salt: string;
  hash: string;
  iterations: number;
  user: User;
  lastOnlineAt: number;
}
type Book = Record<string, OfflineRecord>;

export const recordKey = (company: string | undefined, username: string) =>
  `${(company ?? "").trim().toLowerCase()}|${username.trim().toLowerCase()}`;

const b64 = (b: ArrayBuffer | Uint8Array) =>
  btoa(
    String.fromCharCode(
      ...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b)),
    ),
  );
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function hashPassword(
  password: string,
  salt: Uint8Array,
  iterations = ITERATIONS,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return b64(bits);
}

/** Same answer in the same time whether the first or the last character differs. */
export function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function makeRecord(
  password: string,
  user: User,
  now = Date.now(),
  iterations = ITERATIONS,
): Promise<OfflineRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {
    salt: b64(salt),
    hash: await hashPassword(password, salt, iterations),
    iterations,
    user,
    lastOnlineAt: now,
  };
}

export type OfflineCheck =
  | { ok: true; user: User }
  | { ok: false; reason: "unknown" | "wrong-password" | "expired" };

export async function checkRecord(
  rec: OfflineRecord | undefined,
  password: string,
  now = Date.now(),
): Promise<OfflineCheck> {
  if (!rec) return { ok: false, reason: "unknown" };
  if (now - rec.lastOnlineAt > offlineMaxAgeMs())
    return { ok: false, reason: "expired" };
  const h = await hashPassword(password, unb64(rec.salt), rec.iterations);
  return sameHash(h, rec.hash)
    ? { ok: true, user: rec.user }
    : { ok: false, reason: "wrong-password" };
}

function read(): Book {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Book;
  } catch {
    return {};
  }
}
function write(book: Book) {
  try {
    localStorage.setItem(KEY, JSON.stringify(book));
  } catch {
    /* storage full or blocked: offline sign-in simply will not be available */
  }
}

/** Call after a successful online sign-in. */
export async function rememberLogin(
  company: string | undefined,
  username: string,
  password: string,
  user: User,
) {
  const book = read();
  book[recordKey(company, username)] = await makeRecord(password, user);
  write(book);
}

/** Call whenever the server confirms a session (login or refresh): newer profile, fresh clock. */
export function touchLogin(
  company: string | undefined,
  user: User,
  now = Date.now(),
) {
  const book = read();
  const k = recordKey(company, user.username);
  const rec = book[k];
  if (!rec) return;
  book[k] = { ...rec, user, lastOnlineAt: now };
  write(book);
}

export async function offlineSignIn(
  company: string | undefined,
  username: string,
  password: string,
): Promise<OfflineCheck> {
  return checkRecord(read()[recordKey(company, username)], password);
}

/** "Forget this device": removes every stored password check. */
export function forgetOfflineLogins() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
