import type { ManagedUser, Override, UpdateUserInput } from "./schemas";

export interface UserForm {
  displayName: string;
  email: string;
  phone: string;
  roleKey: string;
  branchIds: string[];
  overrides: Override[];
}

export const formFromUser = (u: ManagedUser): UserForm => ({
  displayName: u.displayName,
  email: u.email ?? "",
  phone: u.phone ?? "",
  roleKey: u.role.key,
  branchIds: [...u.branchIds],
  overrides: u.overrides.map((o) => ({ ...o })),
});

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
const key = (o: Override) => `${o.permission}=${o.effect}`;

/**
 * What to send when saving an existing user. Access fields (role, branches, overrides) are only sent when they really changed,
 * because changing them signs the person out and a plain name or phone edit should not.
 */
export function diffUser(before: ManagedUser, form: UserForm): UpdateUserInput {
  const out: UpdateUserInput = {};
  if (form.displayName.trim() !== before.displayName)
    out.displayName = form.displayName.trim();
  if (form.email.trim() !== (before.email ?? ""))
    out.email = form.email.trim() || null;
  if (form.phone.trim() !== (before.phone ?? ""))
    out.phone = form.phone.trim() || null;
  if (form.roleKey !== before.role.key) out.roleKey = form.roleKey;
  if (!sameSet(form.branchIds, before.branchIds))
    out.branchIds = form.branchIds;
  if (!sameSet(form.overrides.map(key), before.overrides.map(key)))
    out.overrides = form.overrides;
  return out;
}

/** A password people can read out over the phone: no 0/O, 1/l/I. */
export function temporaryPassword(length = 12): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
