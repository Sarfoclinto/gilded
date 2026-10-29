export const MIN_PASSWORD = 10;

export interface Strength {
  /** 0 (empty) to 4 (strong). */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
}

const COMMON = [
  "password",
  "1234567890",
  "qwertyuiop",
  "abcdefghij",
  "goldgold",
  "letmein",
];

/**
 * A rough guide for the person, not a rule: length counts most, then variety. Only MIN_PASSWORD is enforced
 * (the server decides the real rules). Several plain words together score well on purpose.
 */
export function passwordStrength(p: string): Strength {
  if (!p) return { score: 0, label: "" };
  if (
    p.length < MIN_PASSWORD ||
    COMMON.some((c) => p.toLowerCase().includes(c))
  )
    return { score: 1, label: "Too easy to guess" };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) =>
    r.test(p),
  ).length;
  const repeated = /^(.)\1+$/.test(p);
  if (repeated) return { score: 1, label: "Too easy to guess" };
  const points =
    (p.length >= 14 ? 2 : p.length >= 12 ? 1 : 0) +
    (kinds >= 3 ? 1 : 0) +
    (/\s/.test(p) && p.length >= 14 ? 1 : 0);
  if (points >= 3) return { score: 4, label: "Strong" };
  if (points === 2) return { score: 3, label: "Good" };
  return { score: 2, label: "Fair" };
}
