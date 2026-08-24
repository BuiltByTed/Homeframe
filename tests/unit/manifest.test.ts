import { describe, expect, it } from 'vitest';
import { createManifest, defineHomeframe, validateConfig } from '@homeframe/vite';

const config = defineHomeframe({
  app: {
    id: '/',
    name: 'Test App',
    shortName: 'Test',
    startUrl: '/',
    scope: '/',
    themeColor: '#112233',
    backgroundColor: '#112233',
    icon: './icon.svg',
  },
});

describe('manifest generation', () => {
  it('emits stable identity and required any/maskable icons', () => {
    const manifest = createManifest(config, '/');
    expect(manifest).toMatchObject({
      id: '/',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#112233',
    });
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192', purpose: 'any' }),
      expect.objectContaining({ sizes: '512x512', purpose: 'any' }),
      expect.objectContaining({ sizes: '512x512', purpose: 'maskable' }),
    ]));
  });

  it('rejects out-of-scope identity and shortcut URLs', () => {
    expect(() => validateConfig({
      ...config,
      app: { ...config.app, scope: '/app/', id: '/other', startUrl: '/other' },
    })).toThrow(/must be inside app.scope/);
  });

  it('uses dark launch colors when the app forces dark mode', () => {
    const manifest = createManifest({
      ...config,
      app: {
        ...config.app,
        colorScheme: 'dark',
        themeColorDark: '#050607',
        backgroundColorDark: '#08090a',
      },
    }, '/');
    expect(manifest).toMatchObject({
      theme_color: '#050607',
      background_color: '#08090a',
    });
  });

  it('rejects an unsupported color scheme at runtime', () => {
    expect(() => validateConfig({
      ...config,
      app: { ...config.app, colorScheme: 'sepia' },
    } as never)).toThrow(/colorScheme must be system, light, or dark/);
  });
});
