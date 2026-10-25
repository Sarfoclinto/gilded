import { z } from "zod";
import { request, requestVoid } from "@/shared/api/client";
import { createKeys } from "@/shared/api/queryKeys";
import { useApiMutation, useApiQuery } from "@/shared/api/hooks";
import {
  managedUserSchema,
  roleSchema,
  type CreateUserInput,
  type ManagedUser,
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
    staleTime: 60_000,
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
