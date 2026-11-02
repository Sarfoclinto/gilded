import { LayoutListIcon, ScanLineIcon } from 'lucide-react';

export type PurchaseLayout = 'classic' | 'focus';

const OPTIONS: { value: PurchaseLayout; label: string; hint: string; icon: typeof LayoutListIcon }[] = [
  { value: 'classic', label: 'Classic', hint: 'Compact form', icon: LayoutListIcon },
  { value: 'focus', label: 'Focus', hint: 'Big inputs, big result', icon: ScanLineIcon },
];

/**
 * Switches between the two ways of entering a purchase. A sliding pill, big enough to tap, and it says in words what each one is.
 * The choice is kept for this person on this device.
 */
export function LayoutSwitch({ value, onChange, showHint = false }: { value: PurchaseLayout; onChange: (v: PurchaseLayout) => void; showHint?: boolean }) {
  const index = OPTIONS.findIndex((o) => o.value === value);
  return (
    <div role="radiogroup" aria-label="Screen design" className="relative inline-grid grid-cols-2 rounded-full border border-border bg-muted p-1">
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-navy shadow transition-transform duration-300 ease-out motion-reduce:transition-none"
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {OPTIONS.map((o) => {
        const on = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            title={o.hint}
            className={`relative z-10 flex min-h-10 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors ${on ? 'text-white' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Icon className={`size-4 ${on ? 'text-gold' : ''}`} aria-hidden />
            <span>{o.label}</span>
            {showHint ? <span className="sr-only">{o.hint}</span> : null}
          </button>
        );
      })}
    </div>
  );
}