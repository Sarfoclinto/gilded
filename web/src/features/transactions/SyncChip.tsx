import type { TransactionFlag } from './schemas';
import type { TransactionView } from './view';

/** Small status label for a transaction row: saved on the server, waiting on this device, or refused. */
export function SyncChip({ sync, flags }: { sync: TransactionView['sync']; flags: TransactionFlag[] }) {
  if (sync === 'waiting') return <Chip tone="amber">Waiting to sync</Chip>;
  if (sync === 'failed') return <Chip tone="red">Needs attention</Chip>;
  if (flags.length > 0) return <Chip tone="sky">Flagged</Chip>;
  return <Chip tone="green">Saved</Chip>;
}

const tones = {
  amber: 'bg-amber-500/20 text-amber-800 dark:text-amber-300',
  red: 'bg-red-500/20 text-red-700 dark:text-red-300',
  sky: 'bg-sky-500/20 text-sky-800 dark:text-sky-300',
  green: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
};
function Chip({ tone, children }: { tone: keyof typeof tones; children: string }) {
  return <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}
