import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';

// server rendering reads a store's first state, so the connection is stubbed instead
let online = true;
vi.mock('@/shared/offline/connectivity', () => ({ useConnectivity: (pick: (s: { online: boolean }) => unknown) => pick({ online }) }));
import { GoldbodWorldTile } from './GoldbodWorldTile';

const gb = { usdPerOunce: '3759.35', rate: '11.55', publishedAt: '2026-11-18T15:00:00Z' };
function html(live: string | null, props: Partial<Parameters<typeof GoldbodWorldTile>[0]> = {}, on = true) {
  online = on;
  const qc = new QueryClient();
  if (live) qc.setQueryData(['market', 'world-price'], { available: true, usdPerOunce: live, at: new Date().toISOString(), source: 'xaus.com', checkedAt: new Date().toISOString() });
  else qc.setQueryData(['market', 'world-price'], { available: false, checkedAt: new Date().toISOString() });
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(GoldbodWorldTile, { goldbod: gb, live: true, ...props })));
}

describe('GoldbodWorldTile', () => {
  it('always shows GoldBod\'s figure; a green arrow when the world price is up since', () => {
    const h = html('3781.20');
    expect(h).toContain('USD 3,759.35');
    expect(h).toContain('USD 3,781.20');
    expect(h).toContain('+21.85 (0.58%)');
    expect(h).toContain('bg-emerald-600');
    expect(h).toContain('is up since GoldBod published');
  });
  it('a red arrow when it is down', () => {
    const h = html('3740.00');
    expect(h).toContain('−19.35');
    expect(h).toContain('bg-red-600');
  });
  it('without the live price: GoldBod\'s figure, no arrow, and why', () => {
    expect(html(null)).toContain('could not be fetched');
    expect(html(null)).not.toContain('role="img"');
    expect(html('3781.20', {}, false)).toContain('needs a connection');
    expect(html('3781.20', {}, false)).not.toContain('role="img"');
    expect(html('3781.20', { live: false })).not.toContain('Now');
    expect(html('3781.20', { goldbod: null })).toContain('once the price has been read from GoldBod');
  });
  it('preview for a screenshot (only when TILE_PREVIEW names a file)', () => {
    if (!process.env.TILE_PREVIEW) return;
    writeFileSync(process.env.TILE_PREVIEW, [html('3781.20'), html('3740.00', { compact: true }), html(null), html('3781.20', { live: false })].join('\n'));
  });
});