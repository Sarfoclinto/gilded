/**
 * The rules of the global search, as they apply on the device (for pages, and for what the device holds when there is no connection).
 * They follow the server's rules (migration 0055) so the same typing finds the same things either way:
 *  - every word typed must be found, in any order, whatever the capitals or accents;
 *  - a phone number is compared by its digits (0244 123 456 = +233244123456 = 244-123-456);
 *  - a number is also tried as an amount.
 */
export const fold = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export const tidy = (q: string) =>
  fold(q).trim().replace(/\s+/g, " ").slice(0, 80);

export const wordsOf = (q: string): string[] =>
  tidy(q).split(" ").filter(Boolean);

const digitsOf = (s: string) => s.replace(/\D/g, "");

/** A phone number as its last nine digits: what is left without spaces, dashes, a leading 0 or the country code. */
export const phoneKey = (s: string | null | undefined): string =>
  digitsOf(s ?? "")
    .replace(/^(233|0)/, "")
    .slice(-9);

/** What was typed, read as (part of) a phone number, or null when it is not one. */
export function asPhone(q: string): string | null {
  const t = tidy(q);
  const d = digitsOf(t);
  if (!/^[\d\s+()-]+$/.test(t) || d.length < 4) return null;
  return d.replace(/^(233|0)/, "").slice(-9);
}

/** What was typed, read as an amount ("8605", "8,605", "8605.50"), or null. */
export function asAmount(q: string): number | null {
  const t = tidy(q);
  if (!/^\d[\d,]*(\.\d{1,2})?$/.test(t)) return null;
  const d = digitsOf(t);
  if (d.length < 2 || d.length > 12) return null;
  return Number(t.replace(/,/g, ""));
}

export const hasWords = (text: string, words: string[]): boolean => {
  const t = fold(text);
  return words.length > 0 && words.every((w) => t.includes(w));
};

export interface Part {
  text: string;
  hit: boolean;
}

/**
 * Splits a text into the pieces that match what was typed and the pieces that do not, for showing the match in bold.
 * A phone-like query also marks the digits where they sit in a formatted number.
 */
export function highlight(text: string, q: string): Part[] {
  if (!text) return [];
  const folded = fold(text);
  // Accents can change a string's length when folded; if they do, do not risk marking the wrong letters.
  if (folded.length !== text.length) return [{ text, hit: false }];
  const marks = new Array<boolean>(text.length).fill(false);
  for (const w of wordsOf(q)) {
    if (w.length < 2) continue;
    let from = 0;
    for (;;) {
      const i = folded.indexOf(w, from);
      if (i < 0) break;
      for (let k = i; k < i + w.length; k++) marks[k] = true;
      from = i + w.length;
    }
  }
  const pk = asPhone(q);
  if (pk && pk.length >= 4) {
    // walk the digits of the text and mark the stretch whose digits equal the typed ones
    const pos: number[] = [];
    let ds = "";
    for (let i = 0; i < text.length; i++) {
      if (/\d/.test(text[i]!)) {
        pos.push(i);
        ds += text[i];
      }
    }
    const at = ds.indexOf(pk);
    if (at >= 0)
      for (let k = pos[at]!; k <= pos[at + pk.length - 1]!; k++)
        marks[k] = true;
  }
  const out: Part[] = [];
  for (let i = 0; i < text.length; i++) {
    const hit = marks[i]!;
    const last = out[out.length - 1];
    if (last && last.hit === hit) last.text += text[i];
    else out.push({ text: text[i]!, hit });
  }
  return out;
}

/** Rank for a text against what was typed: exact first, then starts-with, then all words found. 0 = not found. */
export function rank(text: string, q: string): number {
  const t = fold(text);
  const query = tidy(q);
  if (!query) return 0;
  if (t === query) return 100;
  if (t.startsWith(query)) return 90;
  if (t.split(/[\s/]+/).some((w) => w.startsWith(query))) return 80;
  return hasWords(text, wordsOf(q)) ? 70 : 0;
}
