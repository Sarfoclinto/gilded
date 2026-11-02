import { z } from "zod";
import { request } from "@/shared/api/client";
import { useApiQuery } from "@/shared/api/hooks";
import { createKeys } from "@/shared/api/queryKeys";

export const settingsKeys = createKeys("settings");

/** Every company setting, with the server's defaults filled in. Keep in step with gold.setting_defaults(). */
export const settingsSchema = z.object({
  /** Saving a purchase books the cash as still to be paid; someone hands it over in a second step. */
  "payout.twoStep": z.boolean().default(false),
  /** Whether the person who recorded a purchase may also pay it out (a one-person branch needs this). */
  "payout.sameUserMayPay": z.boolean().default(true),
  /** The payer re-enters the amount from the weights, blind; a different figure stops the payment. */
  "payout.blindCheck": z.boolean().default(false),
  /** Open and close counts are made without showing what the books say; a mismatch is shown only after pressing the button, and without the amounts. */
  "count.blind": z.boolean().default(false),
  /** A purchase with a new customer name and phone saves that customer. Off: the purchase keeps the name and phone but no customer record is made. */
  "customers.autoCreate": z.boolean().default(true),
  /** Days a device may work and stay signed in with no contact with the server (1 to 30). */
  "offline.maxDays": z.number().default(7),
  "allowance.perPerson": z.number().default(100),
  "receipt.printer": z.boolean().default(false),
  "receipt.paper": z.enum(["80", "58", "a4"]).default("80"),
  "receipt.businessName": z.string().default(""),
  "receipt.tagline": z.string().default(""),
  "receipt.address": z.string().default(""),
  "receipt.phone": z.string().default(""),
  "receipt.footer": z.string().default(""),
});
export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

export const settingsApi = {
  get: (signal?: AbortSignal) =>
    request({ method: "get", url: "/settings", signal }, settingsSchema),
  update: (changes: Partial<Settings>) =>
    request({ method: "put", url: "/settings", data: changes }, settingsSchema),
};

/**
 * The company's settings. Cached like any read, so a device that was online once still knows them offline.
 * Until they have loaded the defaults apply (purchases are paid at once).
 */
export function useSettings(): Settings {
  const q = useApiQuery({
    queryKey: settingsKeys.all,
    queryFn: ({ signal }) => settingsApi.get(signal),
    staleTime: 60_000,
  });
  return q.data ?? DEFAULT_SETTINGS;
}
