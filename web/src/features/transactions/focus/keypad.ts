import { decimalOnly } from "@/shared/lib/numbers";

export type PadKey =
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "00"
  | "."
  | "back";

/** The most digits one number may have (weights and prices are never longer than this). */
const MAX_LENGTH = 12;

/**
 * What a value becomes when a key on the on-screen keypad is pressed.
 * "." starts "0." when the field is empty, "00" on an empty field is just "0", a leading zero is replaced by the next digit ("0" then "5" is "5"),
 * and a second dot is ignored.
 */
export function applyKey(value: string, key: PadKey): string {
  if (key === "back") return value.slice(0, -1);
  if (value.length >= MAX_LENGTH) return value;
  if (key === ".")
    return value.includes(".") ? value : value === "" ? "0." : `${value}.`;
  if (key === "00")
    return value === "" ? "0" : value === "0" ? "0" : decimalOnly(`${value}00`);
  if (value === "0") return key;
  return decimalOnly(`${value}${key}`);
}

export type Field = "top" | "down" | "price";
export const FIELD_ORDER: Field[] = ["top", "down", "price"];

/** Where "Next" goes from a field: the next field of the item, then the first of the next item, then nowhere (the keypad closes). */
export function nextField(
  itemIds: string[],
  at: { id: string; field: Field },
): { id: string; field: Field } | null {
  const i = FIELD_ORDER.indexOf(at.field);
  if (i < FIELD_ORDER.length - 1)
    return { id: at.id, field: FIELD_ORDER[i + 1]! };
  const k = itemIds.indexOf(at.id);
  const nextId = k >= 0 ? itemIds[k + 1] : undefined;
  return nextId ? { id: nextId, field: "top" } : null;
}
