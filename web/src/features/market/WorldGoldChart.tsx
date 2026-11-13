import { useEffect, useRef, useState } from 'react';
import { Maximize2Icon, Minimize2Icon, WifiOffIcon } from 'lucide-react';
import { useConnectivity } from '@/shared/offline/connectivity';

export const WORLD_INTERVALS = [
  { value: '60', label: '1 hour' },
  { value: '240', label: '4 hours' },
  { value: 'D', label: 'Day' },
  { value: 'W', label: 'Week' },
] as const;
export type WorldInterval = (typeof WORLD_INTERVALS)[number]['value'];

const SCRIPT = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
/** Gold against the US dollar, per troy ounce: the price the world's markets quote. */
const SYMBOL = 'OANDA:XAUUSD';

/**
 * The live world gold price, shown with TradingView's embeddable chart. It is an outside service: it brings its own data, needs a
 * connection, and its "TradingView" attribution must stay exactly as it comes (their terms). It is never used for a valuation here:
 * the branch's price comes from GoldBod plus the margin. A director can switch this chart off in Company settings.
 *
 * The widget is their script: it is given an empty box and a small JSON of settings, and it draws inside its own frame.
 * A new interval means a new widget, so the box is emptied and filled again.
 */
const SIZE_KEY = 'gold.market.worldChartSize.v1';
type Size = 'normal' | 'tall';
const readSize = (): Size => {
  try {
    return localStorage.getItem(SIZE_KEY) === 'tall' ? 'tall' : 'normal';
  } catch {
    return 'normal';
  }
};

/**
 * `height` is the normal height. With `resizable` the person can make it taller (remembered on this device) or open it over the
 * whole screen; the chart itself is not loaded again for that, it only gets more room.
 */
export function WorldGoldChart({ interval, height, compact = false, resizable = false }: { interval: WorldInterval; height: number; compact?: boolean; resizable?: boolean }) {
  const online = useConnectivity((s) => s.online);
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>(() => (resizable ? readSize() : 'normal'));
  const [full, setFull] = useState(false);
  const pick = (s: Size) => {
    setSize(s);
    try {
      localStorage.setItem(SIZE_KEY, s);
    } catch {
      /* not remembered, that is all */
    }
  };
  // Full screen: Esc leaves it, and the page behind does not scroll meanwhile.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFull(false);
    };
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = before;
      window.removeEventListener('keydown', onKey);
    };
  }, [full]);

  useEffect(() => {
    const el = host.current;
    if (!el || !online) return;
    el.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'tradingview-widget-container__widget';
    box.style.height = 'calc(100% - 24px)';
    box.style.width = '100%';
    const credit = document.createElement('div');
    credit.className = 'tradingview-widget-copyright';
    credit.style.cssText = 'height:24px;line-height:24px;font-size:12px;text-align:center';
    credit.innerHTML = '<a href="https://www.tradingview.com/symbols/XAUUSD/" rel="noopener nofollow" target="_blank"><span style="color:#2962ff">Gold price chart</span></a> by TradingView';
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.type = 'text/javascript';
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: SYMBOL,
      interval,
      timezone: 'Africa/Accra',
      theme: 'light',
      style: '1',
      locale: 'en',
      allow_symbol_change: false,
      calendar: false,
      hide_side_toolbar: true,
      hide_top_toolbar: compact,
      hide_legend: compact,
      withdateranges: !compact,
      save_image: false,
      support_host: 'https://www.tradingview.com',
    });
    el.append(box, credit, script);
    return () => {
      el.innerHTML = '';
    };
  }, [interval, compact, online]);

  if (!online) {
    return (
      <div style={{ height }} className="grid place-items-center rounded-xl border border-dashed border-border bg-muted/40 p-4 text-center text-sm text-muted-foreground">
        <div>
          <WifiOffIcon className="mx-auto mb-2 size-5" aria-hidden />
          The world price chart needs a connection. Our own price chart still works.
        </div>
      </div>
    );
  }
  const btn = (on: boolean) => `h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-xs font-semibold transition-colors ${on ? 'border-navy bg-navy text-white' : 'border-border bg-background text-muted-foreground hover:text-foreground'}`;
  // The widget's own script sets its box to "100% high", so the height has to be held by a frame around it (a height on the box itself
  // is overwritten and the chart collapses to a strip). The same frame is what grows, or covers the screen.
  const frameHeight = size === 'tall' ? `min(${Math.round(height * 1.7)}px, 88vh)` : height;
  return (
    <div className={full ? 'fixed inset-0 z-50 flex flex-col bg-card p-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:p-4' : ''}>
      {full ? (
        <div className="mb-2 flex shrink-0 items-center justify-between gap-3">
          <span className="min-w-0 truncate text-sm font-semibold">World gold price · USD per ounce <span className="font-normal text-muted-foreground">· for watching only, not the price we pay</span></span>
          <button type="button" onClick={() => setFull(false)} className={`${btn(true)} inline-flex items-center gap-1.5`}>
            <Minimize2Icon className="size-3.5" aria-hidden />Close full screen
          </button>
        </div>
      ) : null}
      <div className={`overflow-hidden rounded-xl border border-border bg-white ${full ? 'min-h-0 flex-1' : ''}`} style={full ? undefined : { height: frameHeight, transition: 'height 200ms ease' }}>
        <div ref={host} className="tradingview-widget-container" style={{ height: '100%', width: '100%' }} />
      </div>
      {resizable && !full ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">Chart size</span>
          <button type="button" aria-pressed={size === 'normal'} onClick={() => pick('normal')} className={btn(size === 'normal')}>Normal</button>
          <button type="button" aria-pressed={size === 'tall'} onClick={() => pick('tall')} className={btn(size === 'tall')}>Tall</button>
          <button type="button" onClick={() => setFull(true)} className={`${btn(false)} inline-flex items-center gap-1.5`}>
            <Maximize2Icon className="size-3.5" aria-hidden />Full screen
          </button>
        </div>
      ) : null}
    </div>
  );
}