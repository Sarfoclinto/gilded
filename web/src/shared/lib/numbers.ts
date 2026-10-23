/** Whole cedis typed by a person: digits only. */
export const digitsOnly = (v: string) => v.replace(/\D/g, "");

/** A decimal typed by a person: digits and one dot. */
export const decimalOnly = (v: string) =>
  v.replace(/[^\d.]/g, "").replace(/(\..*?)\./g, "$1");

export const isWhole = (v: string) => /^\d+$/.test(v.trim()) && Number(v) > 0;

/** "24.50" -> "24.5" for display next to the server's own trimmed numbers. */
export const trimNumber = (v: string) =>
  v.includes(".") ? v.replace(/0+$/, "").replace(/\.$/, "") : v;

export const grams = (v: string | number) =>
  `${Number(v).toLocaleString("en-GH", { maximumFractionDigits: 4 })} g`;
