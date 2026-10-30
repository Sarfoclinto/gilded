import { z } from "zod";
import { request, requestVoid } from "@/shared/api/client";
import { createKeys } from "@/shared/api/queryKeys";
import { useApiMutation, useApiQuery } from "@/shared/api/hooks";
import {
  managedUserSchema,
  roleSchema,
  type CreateUserInput,
  type ManagedUser,
  type Role,
  type UpdateUserInput,
} from "./schemas";

export const userKeys = createKeys("users");
export const roleKeys = createKeys("roles");

export function useUsers() {
  return useApiQuery({
    queryKey: userKeys.list({}),
    queryFn: ({ signal }) =>
      request(
        { method: "get", url: "/users", signal },
        z.array(managedUserSchema),
      ),
    staleTime: 0,
  });
}

export function useRoles() {
  return useApiQuery({
    queryKey: roleKeys.list({}),
    queryFn: ({ signal }) =>
      request({ method: "get", url: "/roles", signal }, z.array(roleSchema)),
    staleTime: 0,
  });
}

export function useCreateUser() {
  return useApiMutation<ManagedUser, CreateUserInput>({
    mutationFn: (cmd) =>
      request(
        {
          method: "post",
          url: "/users",
          data: cmd,
          headers: { "Idempotency-Key": cmd.id },
        },
        managedUserSchema,
      ),
    invalidates: [userKeys.all],
    silent: true,
  });
}

export function useUpdateUser() {
  return useApiMutation<ManagedUser, { id: string; changes: UpdateUserInput }>({
    mutationFn: ({ id, changes }) =>
      request(
        { method: "patch", url: `/users/${id}`, data: changes },
        managedUserSchema,
      ),
    invalidates: [userKeys.all],
    silent: true,
  });
}

export function useResetPassword() {
  return useApiMutation<ManagedUser, { id: string; password: string }>({
    mutationFn: ({ id, password }) =>
      request(
        { method: "post", url: `/users/${id}/password`, data: { password } },
        managedUserSchema,
      ),
    invalidates: [userKeys.all],
    silent: true,
  });
}

export const securitySchema = z.object({ mustChangePassword: z.boolean() });

export function useMySecurity(enabled: boolean) {
  return useApiQuery({
    queryKey: ["me", "security"],
    queryFn: ({ signal }) =>
      request({ method: "get", url: "/me/security", signal }, securitySchema),
    enabled,
    staleTime: 0,
    retry: false,
  });
}

export function useChangeMyPassword() {
  return useApiMutation<void, { currentPassword: string; newPassword: string }>(
    {
      mutationFn: (body) =>
        requestVoid({ method: "post", url: "/me/password", data: body }),
      invalidates: [["me", "security"]],
      silent: true,
      successMessage: "Password changed",
    },
  );
}

// ---------------------------------------------------------------- roles (needs users:manage)
export function useCreateRole() {
  return useApiMutation<
    Role,
    {
      id: string;
      name: string;
      description?: string | null;
      permissions: string[];
    }
  >({
    mutationFn: (cmd) =>
      request(
        {
          method: "post",
          url: "/roles",
          data: cmd,
          headers: { "Idempotency-Key": cmd.id },
        },
        roleSchema,
      ),
    invalidates: [roleKeys.all],
    silent: true,
  });
}

export function useUpdateRole() {
  return useApiMutation<
    Role,
    {
      key: string;
      changes: {
        name?: string;
        description?: string | null;
        permissions?: string[];
      };
    }
  >({
    mutationFn: ({ key, changes }) =>
      request(
        {
          method: "patch",
          url: `/roles/${encodeURIComponent(key)}`,
          data: changes,
        },
        roleSchema,
      ),
    invalidates: [roleKeys.all, userKeys.all],
    silent: true,
  });
}

export function useDeleteRole() {
  return useApiMutation<void, { key: string }>({
    mutationFn: ({ key }) =>
      requestVoid({
        method: "delete",
        url: `/roles/${encodeURIComponent(key)}`,
      }),
    invalidates: [roleKeys.all],
    silent: true,
  });
}
