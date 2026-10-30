import { z } from "zod";

export const overrideSchema = z.object({
  permission: z.string(),
  effect: z.enum(["allow", "deny"]),
});
export type Override = z.infer<typeof overrideSchema>;

export const managedUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  role: z.object({ key: z.string(), name: z.string() }),
  branchIds: z.array(z.string()),
  isActive: z.boolean(),
  mustChangePassword: z.boolean(),
  lastLoginAt: z.string().nullable().optional(),
  createdAt: z.string(),
  overrides: z.array(overrideSchema),
  permissions: z.array(z.string()),
});
export type ManagedUser = z.infer<typeof managedUserSchema>;

export const roleMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  username: z.string(),
  isActive: z.boolean(),
});
export const roleSchema = z.object({
  key: z.string(),
  name: z.string(),
  isSystem: z.boolean(),
  description: z.string().nullable().optional(),
  permissions: z.array(z.string()),
  activeMembers: z.number().optional().default(0),
  members: z.array(roleMemberSchema).optional().default([]),
});
export type Role = z.infer<typeof roleSchema>;

export interface CreateUserInput {
  id: string;
  username: string;
  displayName: string;
  email?: string | null;
  phone?: string | null;
  password: string;
  roleKey: string;
  branchIds: string[];
  overrides: Override[];
}

/** Only the fields that changed. An absent field means "leave it". */
export interface UpdateUserInput {
  displayName?: string;
  email?: string | null;
  phone?: string | null;
  roleKey?: string;
  branchIds?: string[];
  overrides?: Override[];
  isActive?: boolean;
}
