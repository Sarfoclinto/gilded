import { z } from "zod";
import { createResource } from "@/shared/api/createResource";

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

/** Branch names by id, for showing "Kumasi" instead of a uuid. Empty until the list has loaded. */
export function useBranchNames(): Record<string, string> {
  const { data } = branches.useList();
  return Object.fromEntries((data ?? []).map((b) => [b.id, b.name]));
}
