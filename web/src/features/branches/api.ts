import { z } from 'zod';
import { createResource } from '@/shared/api/createResource';

export const branchSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  isMain: z.boolean(),
});
export type Branch = z.infer<typeof branchSchema>;

export const branches = createResource({ name: 'branches', path: '/branches', itemSchema: branchSchema, label: 'Branch' });
