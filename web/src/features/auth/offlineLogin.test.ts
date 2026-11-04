import { describe, expect, it } from "vitest";
import { checkRecord, makeRecord, recordKey, sameHash } from "./offlineLogin";
import type { User } from "./schemas";

const user: User = {
  id: "u1",
  username: "ama",
  displayName: "Ama",
  role: "teller",
  permissions: ["transactions:create"],
  branchIds: ["b1"],
};
const FAST = 1000; // iterations: keep tests quick, the logic is the same

describe("offline sign-in", () => {
  it("accepts the right password and returns the stored profile", async () => {
    const rec = await makeRecord("correct horse", user, 1_000, FAST);
    const r = await checkRecord(rec, "correct horse", 2_000);
    expect(r).toEqual({ ok: true, user });
  });
  it("refuses a wrong password", async () => {
    const rec = await makeRecord("correct horse", user, 1_000, FAST);
    expect(await checkRecord(rec, "wrong", 2_000)).toEqual({
      ok: false,
      reason: "wrong-password",
    });
  });
  it("refuses a person this device has never seen online", async () => {
    expect(await checkRecord(undefined, "x")).toEqual({
      ok: false,
      reason: "unknown",
    });
  });
  it("expires after the offline allowance", async () => {
    const rec = await makeRecord("pw", user, 0, FAST);
    const eightDays = 8 * 24 * 3_600_000;
    expect(await checkRecord(rec, "pw", eightDays)).toEqual({
      ok: false,
      reason: "expired",
    });
  });
  it("never stores the password itself", async () => {
    const rec = await makeRecord("supersecret", user, 0, FAST);
    expect(JSON.stringify(rec)).not.toContain("supersecret");
  });
  it("keys ignore case and spaces around the name", () => {
    expect(recordKey(" Ama ")).toBe(recordKey("ama"));
    expect(recordKey("ama")).not.toBe(recordKey("kofi"));
  });
  it("compares hashes fully", () => {
    expect(sameHash("abc", "abc")).toBe(true);
    expect(sameHash("abc", "abd")).toBe(false);
    expect(sameHash("abc", "ab")).toBe(false);
  });
});
