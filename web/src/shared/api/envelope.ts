import { z } from 'zod';

/** Success: { data, meta? }. Matches docs/openapi.yaml. */
export const dataEnvelope = <T extends z.ZodType>(data: T) =>
  z.object({ data, meta: z.record(z.string(), z.unknown()).optional() });

/** Failure: { error: { code, message, fieldErrors?, traceId } } with a real HTTP status. */
export const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
    traceId: z.string().optional(),
  }),
});
