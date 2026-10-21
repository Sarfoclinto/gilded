import { z } from 'zod';

const schema = z.object({
  VITE_API_URL: z.string().min(1).default('http://localhost:5080/api/v1'),
  // No backend yet: `npm run dev` uses the mock unless told otherwise. Production builds never do.
  VITE_USE_MOCK: z.enum(['true', 'false']).default(import.meta.env.DEV ? 'true' : 'false'),
});

const parsed = schema.parse(import.meta.env);

export const env = {
  apiUrl: parsed.VITE_API_URL,
  useMock: parsed.VITE_USE_MOCK === 'true',
} as const;
