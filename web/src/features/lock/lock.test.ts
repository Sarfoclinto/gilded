import { beforeEach, describe, expect, it } from "vitest";
import { checkPin, pinFor, pinProblem, removePin, setPin } from "./pin";
import { clearLock, MAX_PIN_TRIES, shouldLock, useLock } from "./store";

// the tests run outside a browser: a small in-memory stand-in for its storage
class MemoryStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  toJSON() {
    return Object.fromEntries(this.m);
  }
}
(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();

describe("the unlock PIN", () => {
  beforeEach(() => localStorage.clear());

  it("refuses PINs that are easy to guess", () => {
    expect(pinProblem("123")).toMatch(/4 to 6/);
    expect(pinProblem("1234567")).toMatch(/4 to 6/);
    expect(pinProblem("12a4")).toMatch(/digits only/);
    expect(pinProblem("1111")).toMatch(/same digit/);
    expect(pinProblem("1234")).toMatch(/in a row/);
    expect(pinProblem("6543")).toMatch(/in a row/);
    expect(pinProblem("2580")).toBeNull();
    expect(pinProblem("905172")).toBeNull();
  });

  it("keeps only a salted hash, per person, and checks it", async () => {
    await setPin("u1", "2580", 1000);
    const rec = pinFor("u1")!;
    expect(rec.length).toBe(4);
    expect(JSON.stringify(localStorage)).not.toContain("2580");
    expect(await checkPin("u1", "2580")).toBe(true);
    expect(await checkPin("u1", "2581")).toBe(false);
    expect(await checkPin("u2", "2580")).toBe(false); // someone else's PIN does not unlock
    removePin("u1");
    expect(await checkPin("u1", "2580")).toBe(false);
  });

  it("will not save a weak PIN", async () => {
    await expect(setPin("u1", "0000", 1000)).rejects.toThrow(/same digit/);
    expect(pinFor("u1")).toBeUndefined();
  });
});

describe("when the screen locks", () => {
  beforeEach(() => {
    localStorage.clear();
    clearLock();
  });

  it("locks only after the set time with no activity, and never when switched off", () => {
    const now = 1_000_000_000;
    expect(shouldLock(5, now - 4 * 60_000, now)).toBe(false);
    expect(shouldLock(5, now - 5 * 60_000, now)).toBe(true);
    expect(shouldLock(0, now - 99 * 60_000, now)).toBe(false);
    expect(shouldLock(5, 0, now)).toBe(false); // never seen yet: do not lock straight away
  });

  it("survives a reload (kept in storage) and counts wrong PINs down to sign-out", () => {
    useLock.getState().lockNow("u1", "idle");
    expect(localStorage.getItem("gold.lock.v1")).toContain("u1");
    useLock.setState({ lock: null });
    useLock.getState().sync();
    expect(useLock.getState().lock?.userId).toBe("u1");
    let left = 0;
    for (let i = 0; i < MAX_PIN_TRIES; i++)
      left = useLock.getState().wrongPin();
    expect(left).toBe(0);
    useLock.getState().unlock();
    expect(useLock.getState().lock).toBeNull();
    expect(localStorage.getItem("gold.lock.v1")).toBeNull();
  });
});
