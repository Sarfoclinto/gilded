import { describe, expect, it } from "vitest";
import {
  branchesText,
  filterUsers,
  NO_FILTERS,
  roleCounts,
  seenText,
  sortUsers,
  summarize,
} from "./model";
import type { ManagedUser } from "./schemas";

const u = (o: Partial<ManagedUser> & { id: string }): ManagedUser => ({
  username: o.id,
  displayName: o.id,
  role: { key: "teller", name: "Teller" },
  branchIds: ["b1"],
  isActive: true,
  mustChangePassword: false,
  createdAt: "2026-01-01T00:00:00Z",
  overrides: [],
  permissions: [],
  ...o,
});
const users = [
  u({ id: "ama", displayName: "Ama Bene", phone: "0595788898" }),
  u({
    id: "kofi",
    role: { key: "manager", name: "Manager" },
    branchIds: ["b2"],
    mustChangePassword: true,
  }),
  u({
    id: "boss",
    role: { key: "director", name: "Director" },
    branchIds: [],
    permissions: ["branches:all"],
  }),
  u({ id: "old", isActive: false }),
];

describe("users model", () => {
  it("searches name, username and phone", () => {
    expect(
      filterUsers(users, { ...NO_FILTERS, q: "bene" }).map((x) => x.id),
    ).toEqual(["ama"]);
    expect(
      filterUsers(users, { ...NO_FILTERS, q: "0595" }).map((x) => x.id),
    ).toEqual(["ama"]);
  });
  it("filters by role, status and branch (directors belong everywhere)", () => {
    expect(filterUsers(users, { ...NO_FILTERS, role: "manager" })).toHaveLength(
      1,
    );
    expect(
      filterUsers(users, { ...NO_FILTERS, status: "off" }).map((x) => x.id),
    ).toEqual(["old"]);
    expect(
      filterUsers(users, { ...NO_FILTERS, status: "pending" }).map((x) => x.id),
    ).toEqual(["kofi"]);
    expect(
      filterUsers(users, { ...NO_FILTERS, branch: "b2" }).map((x) => x.id),
    ).toEqual(["kofi", "boss"]);
  });
  it("summarises", () => {
    expect(summarize(users)).toEqual({
      total: 4,
      active: 3,
      off: 1,
      pending: 1,
      neverSignedIn: 3,
    });
    expect(roleCounts(users).map((r) => `${r.key}:${r.count}`)).toEqual([
      "director:1",
      "manager:1",
      "teller:1",
    ]);
  });
  it("shows branches in words", () => {
    expect(branchesText(users[0]!, { b1: "Takoradi" })).toBe("Takoradi");
    expect(branchesText(users[2]!, {})).toBe("All branches");
    expect(branchesText(users[1]!, {})).toBe("No branch");
  });
  it("puts active people first", () => {
    expect(sortUsers(users).at(-1)!.id).toBe("old");
  });
  it("says when someone was last seen", () => {
    const now = new Date("2026-10-29T12:00:00Z");
    expect(seenText(null, now)).toBe("Never signed in");
    expect(seenText("2026-10-29T10:00:00Z", now)).toBe("Seen 2 hours ago");
    expect(seenText("2026-10-27T12:00:00Z", now)).toBe("Seen 2 days ago");
  });
});
