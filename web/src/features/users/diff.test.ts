import { describe, expect, it } from "vitest";
import { diffUser, formFromUser, temporaryPassword } from "./diff";
import type { ManagedUser } from "./schemas";

const user: ManagedUser = {
  id: "u",
  username: "ama",
  displayName: "Ama",
  email: null,
  phone: "024",
  role: { key: "teller", name: "Teller" },
  branchIds: ["a", "b"],
  isActive: true,
  mustChangePassword: false,
  lastLoginAt: null,
  createdAt: "t",
  overrides: [{ permission: "customers:manage", effect: "allow" }],
  permissions: [],
};

describe("saving a user", () => {
  it("sends nothing when nothing changed", () => {
    expect(diffUser(user, formFromUser(user))).toEqual({});
  });
  it("sends only the name when only the name changed (so nobody is signed out)", () => {
    expect(
      diffUser(user, { ...formFromUser(user), displayName: " Ama M " }),
    ).toEqual({ displayName: "Ama M" });
  });
  it("treats branches and overrides as sets, not lists", () => {
    expect(
      diffUser(user, { ...formFromUser(user), branchIds: ["b", "a"] }),
    ).toEqual({});
    expect(diffUser(user, { ...formFromUser(user), branchIds: ["a"] })).toEqual(
      { branchIds: ["a"] },
    );
    expect(diffUser(user, { ...formFromUser(user), overrides: [] })).toEqual({
      overrides: [],
    });
  });
  it("clears an email or phone by sending null", () => {
    expect(diffUser(user, { ...formFromUser(user), phone: "" })).toEqual({
      phone: null,
    });
  });
  it("changes the role only when it differs", () => {
    expect(
      diffUser(user, { ...formFromUser(user), roleKey: "manager" }),
    ).toEqual({ roleKey: "manager" });
  });
});

describe("temporary passwords", () => {
  it("are long enough for the API and avoid look-alike characters", () => {
    const p = temporaryPassword();
    expect(p).toHaveLength(12);
    expect(p).not.toMatch(/[0OolI1]/);
  });
});
