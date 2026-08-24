import { describe, expect, it } from 'vitest';
import { criticalCss } from '../../packages/vite/src/critical.js';
import type { HomeframeConfig } from '../../packages/vite/src/types.js';

function config(): HomeframeConfig {
  return {
    app: {
      id: 'dev.homeframe.test',
      name: 'Homeframe Test',
      shortName: 'Homeframe',
      description: 'Critical CSS test',
      startUrl: '/',
      scope: '/',
      display: 'standalone',
      backgroundColor: '#102030',
      backgroundColorDark: '#010203',
      themeColor: '#102030',
      icon: './icon.svg',
    },
  };
}

describe('Homeframe critical CSS', () => {
  it('keeps the HTML splash centered on the same immutable canvas as the native startup image', () => {
    const css = criticalCss(config());

    expect(css).toContain('#homeframe-boot-splash{position:fixed');
    expect(css).toContain('width:100vw;height:100vh;display:grid;place-items:center');
    expect(css).toContain('#homeframe-boot-splash img{grid-area:1/1');
    expect(css).toContain('#homeframe-boot-splash span{position:absolute');
    expect(css).not.toMatch(/#homeframe-boot-splash\{[^}]*--hf-shell-height/);
    expect(css).not.toMatch(/#homeframe-boot-splash\{[^}]*padding:/);
  });

  it('paints the configured launch background before application CSS loads', () => {
    const css = criticalCss(config());

    expect(css).toContain('--hf-app-background:#102030');
    expect(css).toContain('background:var(--hf-app-background)');
    expect(css).toContain('@media(prefers-color-scheme:dark)');
    expect(css).toContain('--hf-app-background:#010203');
  });
});
