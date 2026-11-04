import { z } from "zod";

const schema = z.object({
  VITE_API_URL: z.string().min(1).default("http://localhost:5080/api/v1"),
});

const parsed = schema.parse(import.meta.env);

// The desktop app knows which server this computer belongs to; a browser uses the address the site was built with.
const desktopApi =
  typeof window === "undefined" ? null : (window.gilded?.apiUrl ?? null);

export const env = { apiUrl: desktopApi ?? parsed.VITE_API_URL } as const;
