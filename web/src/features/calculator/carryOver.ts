/** Values carried from a calculator into the New purchase form (via router state). Nothing is saved until the purchase is confirmed there. */
export interface PurchasePrefill {
  top: string;
  down: string;
  price: string;
  /** True when the person typed their own price rather than today's. */
  priceTouched: boolean;
}

export const readPrefill = (state: unknown): PurchasePrefill | null => {
  const p = (state as { prefill?: Partial<PurchasePrefill> } | null)?.prefill;
  if (
    !p ||
    typeof p.top !== "string" ||
    typeof p.down !== "string" ||
    typeof p.price !== "string"
  )
    return null;
  return {
    top: p.top,
    down: p.down,
    price: p.price,
    priceTouched: !!p.priceTouched,
  };
};
