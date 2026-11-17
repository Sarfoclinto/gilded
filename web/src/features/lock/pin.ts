import { hashPassword, sameHash } from "@/features/auth/offlineLogin";

/**
 * The unlock PIN, kept on this device only: a salted PBKDF2 hash per person (never the PIN). It unlocks the lock screen, also with no
 * connection. It is a counter-side guard against someone using a session left open, not a password: the account itself is still
 * protected by the password, and five wrong PINs sign the person out.
 */
const KEY = "gold.pin.v1";
const ITERATIONS = 150_000;
export const PIN_MIN = 4;
export const PIN_MAX = 6;

export interface PinRecord {
  salt: string;
  hash: string;
  iterations: number;
  length: number;
  setAt: number;
}
type Book = Record<string, PinRecord>;

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function read(): Book {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Book;
  } catch {
    return {};
  }
}
function write(b: Book) {
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    /* storage blocked: no PIN on this device, the password still unlocks */
  }
}

/** Whether a string can be a PIN: 4 to 6 digits, not all the same digit and not a plain run like 1234 or 9876. */
export function pinProblem(pin: string): string | null {
  if (!/^\d+$/.test(pin)) return "Use digits only.";
  if (pin.length < PIN_MIN || pin.length > PIN_MAX)
    return `Use ${PIN_MIN} to ${PIN_MAX} digits.`;
  if (/^(\d)\1+$/.test(pin)) return "Do not use the same digit every time.";
  const up = "01234567890";
  const down = "09876543210";
  if (up.includes(pin) || down.includes(pin))
    return "Do not use digits in a row, like 1234.";
  return null;
}

export const pinFor = (userId: string): PinRecord | undefined => read()[userId];

export async function setPin(
  userId: string,
  pin: string,
  iterations = ITERATIONS,
): Promise<void> {
  const problem = pinProblem(pin);
  if (problem) throw new Error(problem);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const book = read();
  book[userId] = {
    salt: b64(salt),
    hash: await hashPassword(pin, salt, iterations),
    iterations,
    length: pin.length,
    setAt: Date.now(),
  };
  write(book);
}

export async function checkPin(userId: string, pin: string): Promise<boolean> {
  const rec = read()[userId];
  if (!rec) return false;
  return sameHash(
    await hashPassword(pin, unb64(rec.salt), rec.iterations),
    rec.hash,
  );
}

export function removePin(userId: string) {
  const book = read();
  delete book[userId];
  write(book);
}

/** "Forget this device" removes every PIN too. */
export function forgetPins() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
