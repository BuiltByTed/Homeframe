import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { homeframe, type HomeframeConfig } from '@builtbyted/vite';
import { doctorStatusBar } from '../../packages/cli/src/index.js';

async function generate(style?: 'default' | 'black' | 'black-translucent', input = '<html><head></head><body></body></html>') {
  const config: HomeframeConfig = {
    app: { id: '/', name: 'Test', shortName: 'Test', startUrl: '/', scope: '/',
      themeColor: '#112233', backgroundColor: '#112233',
      icon: resolve('examples/kitchen-sink/brand/icon.svg') },
    splash: { generateAppleStartupImages: false, ...(style ? { appleStatusBarStyle: style } : {}) },
    serviceWorker: false,
  };
  const plugin = homeframe(config);
  if (typeof plugin.configResolved !== 'function' || typeof plugin.transformIndexHtml !== 'function') throw new Error('Expected function hooks');
  const warn = vi.fn();
  plugin.configResolved.call({ warn } as never, { root: process.cwd(), base: '/', command: 'serve' } as never);
  const html = await plugin.transformIndexHtml.call({} as never, input, {} as never) as string;
  return { html, warn };
}

describe('iOS status-bar build contract', () => {
  it.each([undefined, 'default'] as const)('resolves %s to one default declaration and matching bootstrap', async (style) => {
    const { html, warn } = await generate(style);
    expect(doctorStatusBar(html)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    document.documentElement.innerHTML = html;
    const bootstrap = document.getElementById('homeframe-bootstrap')!.textContent!;
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    const append = vi.spyOn(document.documentElement, 'appendChild');
    try {
      new Function(bootstrap)();
      expect(window.__HOMEFRAME_BUILD__?.appleStatusBarStyle).toBe('default');
      expect(append).not.toHaveBeenCalled(); // No translucent safe-area probe.
    } finally {
      append.mockRestore();
      Object.defineProperty(navigator, 'standalone', { configurable: true, value: false });
      delete window.__HOMEFRAME_BUILD__;
    }
  });

  it.each(['black', 'black-translucent'] as const)('preserves legacy %s generation but rejects compliance', async (style) => {
    const { html, warn } = await generate(style);
    expect(html).toContain(`content="${style}"`);
    expect(html).toContain(`edge=${style === 'black-translucent'}`);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('HF_IOS_STATUS_BAR'));
    expect(doctorStatusBar(html)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'HF_IOS_STATUS_BAR', severity: 'error' }),
      expect.objectContaining({ code: 'HF_IOS_STATUS_BAR_BOOTSTRAP', severity: 'error' }),
    ]));
  });

  it.each([
    '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
    "<meta content='black' name = 'apple-mobile-web-app-status-bar-style'>",
    '<meta name=apple-mobile-web-app-status-bar-style content=default>',
  ])('rejects an app-authored status-bar tag: %s', async (tag) => {
    await expect(generate(undefined, `<html><head>${tag}</head><body></body></html>`)).rejects.toThrow('Remove duplicates');
  });

  it('rejects missing/duplicate declarations, legacy bootstrap, and mismatched geometry', async () => {
    const { html } = await generate();
    const tag = '<meta name="apple-mobile-web-app-status-bar-style" content="default">';
    for (const invalid of [html.replace(tag, ''), html.replace(tag, tag + tag),
      html.replace(tag, `${tag}<meta content=black name=apple-mobile-web-app-status-bar-style>`)]) {
      expect(doctorStatusBar(invalid)).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'HF_IOS_STATUS_BAR', severity: 'error' }),
      ]));
    }
    for (const invalid of [html.replace('edge=false', 'edge=true'),
      html.replace('"appleStatusBarStyle":"default"', '"appleStatusBarStyle":"black"'),
      html.replace('"appleStatusBarStyle":"default",', '')]) {
      expect(doctorStatusBar(invalid)).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'HF_IOS_STATUS_BAR_BOOTSTRAP', severity: 'error' }),
      ]));
    }
  });
});
