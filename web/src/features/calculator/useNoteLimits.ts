import { useCallback, useState } from 'react';
import { DENOMINATIONS, type Denomination, type NoteLimits } from '@gold/core';

/**
 * Which notes the drawer has and how many. Blank count = no limit (the note is available).
 * This is a per-device draft until the cash-drawer slice supplies the real morning count from the server.
 */
export type LimitDraft = Record<Denomination, { enabled: boolean; count: string }>;

const KEY = 'gold.calc.notes.v1';
const defaults = (): LimitDraft =>
  Object.fromEntries(DENOMINATIONS.map((d) => [d, { enabled: d !== 200, count: '' }])) as LimitDraft;

function load(): LimitDraft {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults(), ...(JSON.parse(raw) as Partial<LimitDraft>) };
  } catch {
    /* private mode or cleared storage: fall back to defaults */
  }
  return defaults();
}

export function toLimits(draft: LimitDraft): NoteLimits {
  const limits: NoteLimits = {};
  for (const d of DENOMINATIONS) {
    const row = draft[d];
    if (!row.enabled) continue;
    const n = row.count.trim() === '' ? null : Math.max(0, Math.floor(Number(row.count)));
    limits[`${d}`] = Number.isFinite(n as number) || n === null ? n : null;
  }
  return limits;
}

export function useNoteLimits() {
  const [draft, setDraft] = useState<LimitDraft>(load);
  const update = useCallback((d: Denomination, patch: Partial<LimitDraft[Denomination]>) => {
    setDraft((prev) => {
      const next = { ...prev, [d]: { ...prev[d], ...patch } };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  return { draft, update, limits: toLimits(draft) };
}
