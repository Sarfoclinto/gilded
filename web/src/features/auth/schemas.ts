import { z } from "zod";

export const roleSchema = z.enum(["director", "manager", "teller"]);
export type Role = z.infer<typeof roleSchema>;

export const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  role: roleSchema,
  permissions: z.array(z.string()),
  branchIds: z.array(z.string()),
});
export type User = z.infer<typeof userSchema>;

export const sessionSchema = z.object({
  accessToken: z.string(),
  expiresAt: z.string(),
  user: userSchema,
});
export type SessionData = z.infer<typeof sessionSchema>;

export interface LoginInput {
  username: string;
  password: string;
  /** The company's short name. Left out, the server uses its default company. */
  company?: string;
}
