import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { request } from "@/shared/api/client";
import { createKeys } from "@/shared/api/queryKeys";
import { useApiMutation, useApiQuery } from "@/shared/api/hooks";
import { useAuth } from "@/features/auth/store";
import { readSnapshot, writeSnapshot } from "./local";

/** Group Sheets: private running records for a chosen group. Who sees what is decided by the server; these are only the shapes. */
export const gsKeys = createKeys("group-sheets");

const person = z.object({ id: z.string(), displayName: z.string() });
export type Person = z.infer<typeof person>;
export const ROLES = ["keeper", "writer", "reader"] as const;
export type GroupRole = (typeof ROLES)[number];
export type Access = "write" | "read" | "none";

export const entrySchema = z.object({
  id: z.string(),
  sheetId: z.string(),
  amount: z.string(),
  moneyDate: z.string(),
  note: z.string().nullable(),
  dayTotal: z.boolean(),
  takesBack: z.string().nullable(),
  writtenBy: person,
  writtenAt: z.string(),
  receivedAt: z.string(),
  afterRemoval: z.boolean(),
  mine: z.boolean(),
  takenBack: z
    .object({ by: person, at: z.string(), id: z.string() })
    .nullable(),
  /** Savings sheets: whose savings (B75). */
  person: z
    .object({ id: z.string(), name: z.string(), userId: z.string().nullable() })
    .nullable()
    .optional(),
  /** Quantity sheets: + came in, − went out, in the sheet's unit (B75). */
  quantity: z.string().nullable().optional(),
  /** Receipt photos on the entry (B75). */
  photos: z
    .array(
      z.object({
        id: z.string(),
        by: person,
        at: z.string(),
        mine: z.boolean(),
      }),
    )
    .optional(),
});
export type Entry = z.infer<typeof entrySchema>;

export const SHEET_KINDS = ["money", "people", "quantity"] as const;
export type SheetKind = (typeof SHEET_KINDS)[number];
export const sheetPersonSchema = z.object({
  id: z.string(),
  name: z.string(),
  userId: z.string().nullable(),
  balance: z.string(),
  entries: z.number(),
});
export type SheetPerson = z.infer<typeof sheetPersonSchema>;

export const sheetSchema = z.object({
  id: z.string(),
  /** money: one balance · people: savings, one balance per person · quantity: money and an amount of something (B75; missing from an older server = money). */
  kind: z.enum(SHEET_KINDS).optional().default("money"),
  unit: z.string().nullable().optional(),
  openingQuantity: z.string().optional(),
  /** Quantity sheets: what is in hand now. */
  stock: z.string().nullable().optional(),
  /** The caller's own alert on money taken out, or null when off. */
  alert: z.object({ minAmount: z.string() }).nullable().optional(),
  people: z.array(sheetPersonSchema).nullable().optional(),
  groupId: z.string(),
  name: z.string(),
  branchId: z.string().nullable(),
  branchName: z.string().nullable(),
  openingBalance: z.string(),
  openingDate: z.string().nullable(),
  closed: z.boolean(),
  closedAt: z.string().nullable(),
  access: z.enum(["write", "read", "none"]),
  createdAt: z.string(),
  last: entrySchema.nullable(),
  balance: z.string(),
  todayIn: z.string(),
  todayOut: z.string(),
  entries: z.number(),
});
export type Sheet = z.infer<typeof sheetSchema>;

export const homeSchema = z.object({
  canCreate: z.boolean(),
  groups: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      myRole: z.enum(ROLES),
      sheets: z.array(sheetSchema),
    }),
  ),
  needKeeper: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      members: z.array(person.extend({ role: z.enum(ROLES), how: z.string() })),
    }),
  ),
});
export type Home = z.infer<typeof homeSchema>;

const member = person.extend({
  role: z.enum(ROLES),
  how: z.enum(["handpicked", "branch"]),
});
export type Member = z.infer<typeof member>;
export const groupSchema = z.object({
  id: z.string(),
  name: z.string(),
  myRole: z.enum(ROLES),
  createdAt: z.string(),
  members: z.array(member),
  keepers: z.number(),
  rules: z.array(
    z.object({
      branchId: z.string(),
      branchName: z.string(),
      role: z.enum(["writer", "reader"]),
    }),
  ),
  leftOut: z.array(person),
  sheets: z.array(sheetSchema),
  access: z.array(
    z.object({
      sheetId: z.string(),
      userId: z.string().nullable(),
      access: z.enum(["write", "read", "none"]),
    }),
  ),
});
export type Group = z.infer<typeof groupSchema>;

const flow = z.object({ in: z.string(), out: z.string() });
export const sheetDetailSchema = sheetSchema.extend({
  groupName: z.string(),
  myRole: z.enum(ROLES),
  today: z.string(),
  from: z.string(),
  to: z.string(),
  balanceBefore: z.string(),
  stockBefore: z.string().nullable().optional(),
  /** Set when the sheet is shown for one person (a savings statement). */
  personId: z.string().nullable().optional(),
  olderEntries: z.boolean(),
  week: flow,
  month: flow,
  days: z.array(
    z.object({
      date: z.string(),
      in: z.string(),
      out: z.string(),
      closing: z.string(),
      qtyIn: z.string().optional(),
      qtyOut: z.string().optional(),
      stock: z.string().nullable().optional(),
      entries: z.array(entrySchema),
    }),
  ),
});
export type SheetDetail = z.infer<typeof sheetDetailSchema>;

export const activitySchema = z.array(
  z.object({
    id: z.string(),
    kind: z.string(),
    at: z.string(),
    actor: person.nullable(),
    subject: person.nullable(),
    detail: z.record(z.string(), z.unknown()),
  }),
);
export type Activity = z.infer<typeof activitySchema>;

export const entryAddedSchema = z
  .object({
    id: z.string(),
    sheetId: z.string(),
    afterRemoval: z.boolean().optional(),
    alreadyReceived: z.boolean().optional(),
  })
  .passthrough();

export interface NewEntry {
  id: string;
  sheetId: string;
  /** Money: both set, or both left out on a quantity sheet when only the quantity moved. */
  direction?: "in" | "out";
  amount?: string;
  /** Savings sheets: whose savings. */
  personId?: string;
  /** Quantity sheets. */
  quantity?: string;
  qtyDirection?: "in" | "out";
  note?: string;
  moneyDate: string;
  dayTotal: boolean;
  writtenAt: string;
}

export const gsApi = {
  home: (signal?: AbortSignal) =>
    request({ method: "get", url: "/group-sheets", signal }, homeSchema),
  group: (id: string, signal?: AbortSignal) =>
    request(
      { method: "get", url: `/group-sheets/groups/${id}`, signal },
      groupSchema,
    ),
  sheet: (id: string, from?: string, personId?: string, signal?: AbortSignal) =>
    request(
      {
        method: "get",
        url: `/group-sheets/sheets/${id}`,
        params: from || personId ? { from, personId } : undefined,
        signal,
      },
      sheetDetailSchema,
    ),
  activity: (id: string, signal?: AbortSignal) =>
    request(
      { method: "get", url: `/group-sheets/groups/${id}/activity`, signal },
      activitySchema,
    ),
  createGroup: (b: { id: string; name: string }) =>
    request(
      { method: "post", url: "/group-sheets/groups", data: b },
      groupSchema,
    ),
  renameGroup: (id: string, name: string) =>
    request(
      { method: "patch", url: `/group-sheets/groups/${id}`, data: { name } },
      groupSchema,
    ),
  groupVerb: (
    id: string,
    verb:
      | "members"
      | "members-remove"
      | "members-back"
      | "rules"
      | "rules-remove",
    data: Record<string, unknown>,
  ) =>
    request(
      { method: "post", url: `/group-sheets/groups/${id}/${verb}`, data },
      groupSchema,
    ),
  leave: (id: string) =>
    request(
      { method: "post", url: `/group-sheets/groups/${id}/leave`, data: {} },
      z.unknown(),
    ),
  nameKeeper: (id: string, userId: string) =>
    request(
      {
        method: "post",
        url: `/group-sheets/groups/${id}/name-keeper`,
        data: { userId },
      },
      homeSchema,
    ),
  createSheet: (
    groupId: string,
    b: {
      id: string;
      name: string;
      kind?: SheetKind;
      unit?: string;
      openingQuantity?: string;
      branchId?: string | null;
      openingBalance?: string;
      openingDate?: string | null;
    },
  ) =>
    request(
      {
        method: "post",
        url: `/group-sheets/groups/${groupId}/sheets`,
        data: b,
      },
      sheetSchema,
    ),
  updateSheet: (id: string, b: { name?: string; closed?: boolean }) =>
    request(
      { method: "patch", url: `/group-sheets/sheets/${id}`, data: b },
      sheetSchema,
    ),
  deleteSheet: (id: string) =>
    request(
      { method: "delete", url: `/group-sheets/sheets/${id}` },
      z.unknown(),
    ),
  setAccess: (sheetId: string, userId: string | null, access: Access | null) =>
    request(
      {
        method: "post",
        url: `/group-sheets/sheets/${sheetId}/access`,
        data: { userId, access },
      },
      groupSchema,
    ),
  addEntry: (e: NewEntry) =>
    request(
      {
        method: "post",
        url: `/group-sheets/sheets/${e.sheetId}/entries`,
        data: e,
      },
      entryAddedSchema,
    ),
  takeBack: (entryId: string, id: string) =>
    request(
      {
        method: "post",
        url: `/group-sheets/entries/${entryId}/take-back`,
        data: { id },
      },
      entrySchema,
    ),
  addPerson: (
    sheetId: string,
    b: { id: string; name?: string; userId?: string },
  ) =>
    request(
      {
        method: "post",
        url: `/group-sheets/sheets/${sheetId}/people`,
        data: b,
      },
      sheetSchema,
    ),
  renamePerson: (personId: string, name: string) =>
    request(
      {
        method: "patch",
        url: `/group-sheets/people/${personId}`,
        data: { name },
      },
      sheetSchema,
    ),
  setAlert: (sheetId: string, on: boolean, minAmount?: string) =>
    request(
      {
        method: "post",
        url: `/group-sheets/sheets/${sheetId}/alert`,
        data: { on, minAmount },
      },
      sheetSchema,
    ),
  removePhoto: (photoId: string) =>
    request(
      {
        method: "post",
        url: `/group-sheets/photos/${photoId}/remove`,
        data: {},
      },
      z.unknown(),
    ),
};

/** Where a receipt photo is fetched from (the server checks the person may see the sheet). */
export const gsPhotoUrl = (id: string, thumb: boolean) =>
  `/group-sheets/photos/${id}/${thumb ? "thumb" : "file"}`;

/**
 * Reads keep a copy for this person on this device, so a sheet still shows offline (marked as such). The copy is never in the cache that
 * survives sign-out: a shared branch computer must not show one person's group to the next.
 */
function useSnapshotQuery<T>(
  key: readonly unknown[],
  name: string,
  fn: (signal: AbortSignal) => Promise<T>,
  enabled = true,
) {
  const user = useAuth((s) => s.user?.id ?? "");
  return useApiQuery<T>({
    queryKey: [...key, user],
    queryFn: async ({ signal }) => {
      try {
        const data = await fn(signal);
        writeSnapshot(user, name, data);
        return data;
      } catch (e) {
        // gone (removed from the group, sheet hidden): forget the copy too
        if (
          (e as { status?: number }).status === 404 ||
          (e as { status?: number }).status === 403
        )
          writeSnapshot(user, name, null);
        throw e;
      }
    },
    // the last copy on this device while the server answers (or when there is no connection); the types cannot express a generic T here
    placeholderData: ((previous: T | undefined) =>
      previous ?? readSnapshot<T>(user, name) ?? undefined) as never,
    enabled: enabled && !!user,
    staleTime: 15_000,
    // other members' entries appear without a reload
    refetchInterval: 30_000,
    retry: (n, e) =>
      n < 1 &&
      (e as { status?: number }).status !== 404 &&
      (e as { status?: number }).status !== 403,
  });
}

export const useGsHome = () =>
  useSnapshotQuery(gsKeys.custom("home"), "home", (s) => gsApi.home(s));
export const useGsGroup = (id: string) =>
  useSnapshotQuery(
    gsKeys.detail(`g:${id}`),
    `g:${id}`,
    (s) => gsApi.group(id, s),
    !!id,
  );
export const useGsSheet = (id: string, from?: string, personId?: string) =>
  useSnapshotQuery(
    gsKeys.custom("sheet", { id, from, personId }),
    `s:${id}${from ? `:${from}` : ""}${personId ? `:p${personId}` : ""}`,
    (s) => gsApi.sheet(id, from, personId, s),
    !!id,
  );
export const useGsActivity = (id: string, enabled: boolean) =>
  useApiQuery({
    queryKey: gsKeys.custom("activity", { id }),
    queryFn: ({ signal }) => gsApi.activity(id, signal),
    enabled: enabled && !!id,
    staleTime: 15_000,
  });

/** After any change: refresh everything Group Sheets shows (it is small). */
export function useGsInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: gsKeys.all });
}

export function useGsMutation<TVars, TData>(
  fn: (v: TVars) => Promise<TData>,
  successMessage?: string | ((d: TData, v: TVars) => string),
) {
  return useApiMutation<TData, TVars>({
    mutationFn: fn,
    invalidates: [gsKeys.all],
    successMessage,
  });
}
