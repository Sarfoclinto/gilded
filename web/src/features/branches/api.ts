import { z } from "zod";
import { request } from "@/shared/api/client";
import { createResource } from "@/shared/api/createResource";
import { useApiMutation, useApiQuery } from "@/shared/api/hooks";
import { createKeys } from "@/shared/api/queryKeys";

export const branchSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  isMain: z.boolean(),
});
export type Branch = z.infer<typeof branchSchema>;

export const branches = createResource({
  name: "branches",
  path: "/branches",
  itemSchema: branchSchema,
  label: "Branch",
});

/**
 * Every active branch of the company (names only). `branches` above is only the ones this person works in; pickers that name another
 * branch (transfer destination, the branch sending mobile money) and screens that show another branch's name need this list.
 * The key starts with 'branches' so it is refreshed whenever branches change.
 */
export function useAllBranches() {
  return useApiQuery({
    queryKey: [...branches.keys.all, "all"] as const,
    queryFn: ({ signal }) =>
      request(
        { method: "get", url: "/branches/all", signal },
        z.array(branchSchema),
      ),
  });
}

/** Branch names by id, for showing "Kumasi" instead of a uuid, for every branch of the company. Empty until the list has loaded. */
export function useBranchNames(): Record<string, string> {
  const { data } = useAllBranches();
  return Object.fromEntries((data ?? []).map((b) => [b.id, b.name]));
}

// ---------------------------------------------------------------- administration (needs branches:manage)
export const managedBranchSchema = branchSchema.extend({
  timezone: z.string(),
  isActive: z.boolean(),
  dayOpen: z.boolean(),
});
export type ManagedBranch = z.infer<typeof managedBranchSchema>;

export const managedBranchKeys = createKeys("branches-admin");

export function useManagedBranches() {
  return useApiQuery({
    queryKey: managedBranchKeys.list({}),
    queryFn: ({ signal }) =>
      request(
        { method: "get", url: "/branches/manage", signal },
        z.array(managedBranchSchema),
      ),
    staleTime: 0,
  });
}

/** The list the branch switcher and forms use is cached on the device, so it is refreshed whenever branches change. */
const afterChange = [managedBranchKeys.all, branches.keys.all];

export function useCreateBranch() {
  return useApiMutation<
    ManagedBranch,
    { id: string; code: string; name: string; timezone: string }
  >({
    mutationFn: (cmd) =>
      request(
        {
          method: "post",
          url: "/branches",
          data: cmd,
          headers: { "Idempotency-Key": cmd.id },
        },
        managedBranchSchema,
      ),
    invalidates: afterChange,
    silent: true,
    successMessage: "Branch added",
  });
}

export function useUpdateBranch() {
  return useApiMutation<
    ManagedBranch,
    {
      id: string;
      changes: { name?: string; timezone?: string; isActive?: boolean };
    }
  >({
    mutationFn: ({ id, changes }) =>
      request(
        { method: "patch", url: `/branches/${id}`, data: changes },
        managedBranchSchema,
      ),
    invalidates: afterChange,
    silent: true,
    successMessage: "Saved",
  });
}
