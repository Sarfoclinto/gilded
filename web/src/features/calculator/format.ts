export const cedis = (v: string | number) => `GHS ${Number(v).toLocaleString('en-GH', { maximumFractionDigits: 0 })}`;
/** "0.9733" -> "97.33%" (display only; the stored value stays a fraction string). */
export const percent = (fraction: string) => `${(Number(fraction) * 100).toFixed(2)}%`;
