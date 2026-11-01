import { z } from "zod";
import { request } from "@/shared/api/client";
import { useApiQuery } from "@/shared/api/hooks";
import { useConnectivity } from "@/shared/offline/connectivity";

const statsSchema = z.object({
  n: z.number(),
  enough: z.boolean(),
  usual: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  name: z.string().optional(),
});
export type CaratStats = z.infer<typeof statsSchema>;

export const expectationsSchema = z.object({
  town: statsSchema.nullable(),
  customer: statsSchema.nullable(),
});
export type Expectations = z.infer<typeof expectationsSchema>;

/** What carat to expect from this town and this customer, from what the company has bought before. Needs a connection; silent without one. */
export function useExpectations(
  townId: string | null,
  customerId: string | null,
) {
  const online = useConnectivity((s) => s.online);
  return useApiQuery({
    queryKey: ["expectations", townId ?? "", customerId ?? ""],
    queryFn: ({ signal }) =>
      request(
        {
          method: "get",
          url: "/expectations",
          params: {
            townId: townId || undefined,
            customerId: customerId || undefined,
          },
          signal,
        },
        expectationsSchema,
      ),
    enabled: online && !!(townId || customerId),
    staleTime: 60_000,
    retry: false,
  });
}

/** One plain sentence, or null when there is nothing worth saying (no history). */
export function describeCarat(
  who: string,
  s: CaratStats | null | undefined,
  verb: string,
): string | null {
  if (!s || s.n === 0) return null;
  const pieces = `${s.n} piece${s.n === 1 ? "" : "s"}`;
  if (!s.enough || !s.usual)
    return `${who}: only ${pieces} bought so far, too few to say what is usual.`;
  const range =
    s.from && s.to && s.from !== s.to ? ` (mostly ${s.from} to ${s.to})` : "";
  return `${who} ${verb} ${s.usual}${range} · ${pieces}`;
}
