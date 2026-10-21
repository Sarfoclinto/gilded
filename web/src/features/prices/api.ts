import { z } from 'zod';
import { request } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/hooks';

export const currentPriceSchema = z.object({
  branchId: z.string(),
  basePrice: z.string(),
  margin: z.string(),
  effectivePrice: z.string(),
  source: z.enum(['goldbod', 'manual']),
  status: z.enum(['approved', 'provisional']),
  asOf: z.string(),
});
export type CurrentPrice = z.infer<typeof currentPriceSchema>;

export const priceKeys = {
  current: (branchId: string) => ['prices', 'current', branchId] as const,
};

export function useCurrentPrice(branchId: string | null) {
  return useApiQuery({
    queryKey: priceKeys.current(branchId ?? ''),
    queryFn: () => request({ method: 'get', url: '/prices/current', params: { branchId } }, currentPriceSchema),
    enabled: !!branchId,
    staleTime: 60_000,
  });
}
