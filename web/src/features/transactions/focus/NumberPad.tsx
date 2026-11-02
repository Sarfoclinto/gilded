import { DeleteIcon } from 'lucide-react';
import type { PadKey } from './keypad';

const KEY = 'min-h-14 rounded-2xl text-xl font-semibold active:scale-95 transition-transform select-none';

/**
 * A big on-screen number pad for touch screens, so the phone's own keyboard never covers the form. It is only shown for the field being
 * typed in; pressing a key never takes focus away from that field (so the caret stays), and Next moves on without closing it.
 */
export function NumberPad({ title, subtitle, nextLabel, onKey, onNext, onDone }: { title: string; subtitle?: string; nextLabel: string; onKey: (k: PadKey) => void; onNext: () => void; onDone: () => void }) {
  const press = (k: PadKey) => (e: React.PointerEvent) => { e.preventDefault(); onKey(k); };
  const num = (k: PadKey, label = k) => (
    <button key={k} type="button" onPointerDown={press(k)} onClick={(e) => e.preventDefault()} className={`${KEY} bg-muted text-foreground`} aria-label={k === '.' ? 'Decimal point' : label}>{label}</button>
  );
  const stop = (fn: () => void) => ({ onPointerDown: (e: React.PointerEvent) => e.preventDefault(), onClick: fn });
  return (
    <div role="group" aria-label="Number pad" className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border-t border-border bg-card px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_30px_rgba(0,0,0,0.15)]">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{title}</p>
          {subtitle ? <p className="tnum truncate text-base font-bold text-primary">{subtitle}</p> : null}
        </div>
        <button type="button" {...stop(onDone)} className="min-h-11 rounded-full bg-primary/10 px-5 text-sm font-semibold text-primary">Done</button>
      </div>
      <div className="grid grid-cols-4 grid-rows-4 gap-2">
        {num('1')}{num('2')}{num('3')}
        <button type="button" onPointerDown={press('back')} onClick={(e) => e.preventDefault()} className={`${KEY} grid place-items-center bg-primary/10 text-primary`} aria-label="Delete"><DeleteIcon className="size-6" aria-hidden /></button>
        {num('4')}{num('5')}{num('6')}
        <button type="button" {...stop(onNext)} className={`${KEY} bg-primary/10 text-base text-primary`}>{nextLabel}</button>
        {num('7')}{num('8')}{num('9')}
        <button type="button" {...stop(onDone)} className={`${KEY} row-span-2 bg-primary text-base text-primary-foreground`}>Done</button>
        {num('.', '.')}{num('0')}{num('00')}
      </div>
    </div>
  );
}