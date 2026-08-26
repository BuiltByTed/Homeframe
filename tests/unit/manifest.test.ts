import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import {
  createManifest,
  defineHomeframe,
  generateAssets,
  homeframe,
  runtimeCacheOverlapWarnings,
  validateConfig,
} from '@builtbyted/vite';

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
      expect.objectContaining({ sizes: '192x192', purpose: 'maskable' }),
      expect.objectContaining({ sizes: '512x512', purpose: 'maskable' }),
    ]));
  });

  it('renders maskable icons on an opaque brand canvas instead of the launch background', async () => {
    const root = await mkdtemp(join(tmpdir(), 'homeframe-maskable-'));
    try {
      await writeFile(join(root, 'icon.svg'), `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="40" fill="#abff44" />
        </svg>
      `);
      const generated = await generateAssets({
        ...config,
        app: {
          ...config.app,
          themeColor: '#123456',
          backgroundColor: '#ffffff',
          icon: './icon.svg',
        },
      }, root, '/');
      const maskable = generated.assets.find((asset) =>
        asset.fileName === 'generated/icon-maskable-512.png');
      expect(maskable).toBeDefined();
      const pixel = await sharp(maskable!.source).extract({ left: 0, top: 0, width: 1, height: 1 })
        .raw()
        .toBuffer();
      expect([...pixel]).toEqual([0x12, 0x34, 0x56, 0xff]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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

  it('accepts full-bleed maskable artwork and rejects impossible insets', () => {
    expect(() => validateConfig({
      ...config,
      app: {
        ...config.app,
        maskableIconPaddingRatio: 0,
        maskableIconBackgroundColor: '#09090b',
      },
    })).not.toThrow();
    expect(() => validateConfig({
      ...config,
      app: { ...config.app, maskableIconPaddingRatio: 0.5 },
    })).toThrow(/maskableIconPaddingRatio/);
  });

  it('validates the keyboard occlusion presentation policy', () => {
    expect(() => validateConfig({
      ...config,
      viewport: { keyboardOcclusion: 'transparent' },
    })).not.toThrow();
    expect(() => validateConfig({
      ...config,
      viewport: { keyboardOcclusion: 'blurred' },
    } as never)).toThrow(/keyboardOcclusion must be opaque or transparent/);
  });

  it('accepts desktop-only text selection and rejects unknown policies', () => {
    expect(() => validateConfig({
      ...config,
      viewport: { selection: 'allow-desktop' },
    })).not.toThrow();
    expect(() => validateConfig({
      ...config,
      viewport: { selection: 'sometimes' },
    } as never)).toThrow(/selection must be controls-only, allow-desktop, or allow/);
  });

  it('rejects unsafe worker paths, unbounded rules, and out-of-scope notification routes', () => {
    expect(() => validateConfig({
      ...config,
      serviceWorker: {
        fileName: '../worker.js?old=1',
        runtimeCaching: [{
          match: '/media/',
          strategy: 'cache-first',
          cacheName: 'media/private',
          maxEntries: 0,
          maxAgeSeconds: -1,
          maxResponseBytes: 0,
          responseTypes: ['opaque'],
        }],
        notifications: { routeAllowlist: ['https://attacker.example/'] },
      },
    })).toThrow(/fileName|cacheName|maxEntries|maxAgeSeconds|maxResponseBytes|opaque|Notification route/);
  });

  it('requires private caches to declare a logout purge and threat review', () => {
    expect(() => validateConfig({
      ...config,
      serviceWorker: {
        runtimeCaching: [{
          match: '/api/private/',
          strategy: 'network-first',
          cacheName: 'private-data',
          maxEntries: 2,
          maxAgeSeconds: 60,
          sensitiveData: {
            partitionKey: () => 'account',
            purgeOnLogout: true,
            threatReview: '',
          },
        }],
      },
    })).toThrow(/threatReview/);
  });

  it('rejects immediate update reload without explicit data-loss acceptance', () => {
    expect(() => validateConfig({
      ...config,
      serviceWorker: { update: { mode: 'automatic', reload: 'immediate' } },
    })).toThrow(/acceptDataLossRisk/);
    expect(() => validateConfig({
      ...config,
      serviceWorker: {
        update: { mode: 'automatic', reload: 'immediate', acceptDataLossRisk: true },
      },
    })).not.toThrow();
  });

  it('reports deterministic runtime-cache overlap with an example URL', () => {
    const warnings = runtimeCacheOverlapWarnings({
      ...config,
      serviceWorker: {
        runtimeCaching: [
          { match: '/api/', strategy: 'network-first', cacheName: 'api', maxEntries: 5, maxAgeSeconds: 60 },
          { match: '/api/images/', strategy: 'cache-first', cacheName: 'images', maxEntries: 5, maxAgeSeconds: 60 },
        ],
      },
    });
    expect(warnings).toEqual([
      expect.stringContaining('/api/images/'),
    ]);
  });

  it('emits optional desktop/install integration fields from typed config', () => {
    const manifest = createManifest({
      ...config,
      app: {
        ...config.app,
        displayOverride: ['window-controls-overlay', 'standalone'],
        screenshots: [{ src: '/wide.png', sizes: '1280x720', formFactor: 'wide' }],
        shareTarget: { action: '/share', params: { title: 'title', files: [{ name: 'media', accept: ['video/mp4'] }] } },
        protocolHandlers: [{ protocol: 'web+homeframe', url: '/open?value=%s' }],
      },
    }, '/');
    expect(manifest).toMatchObject({
      display_override: ['window-controls-overlay', 'standalone'],
      screenshots: [{ src: '/wide.png', sizes: '1280x720', form_factor: 'wide' }],
      share_target: { action: '/share', method: 'POST', enctype: 'multipart/form-data' },
      protocol_handlers: [{ protocol: 'web+homeframe', url: '/open?value=%s' }],
    });
  });

  it('serves generated assets in development without using Rollup emitFile', async () => {
    const plugin = homeframe({
      ...config,
      app: {
        ...config.app,
        icon: resolve(process.cwd(), 'examples/kitchen-sink/brand/icon.svg'),
      },
      splash: { generateAppleStartupImages: false },
    });
    const configResolved = plugin.configResolved;
    const buildStart = plugin.buildStart;
    if (typeof configResolved !== 'function' || typeof buildStart !== 'function') {
      throw new TypeError('Expected function-form Vite hooks.');
    }
    configResolved.call({ warn: vi.fn() } as never, {
      root: process.cwd(),
      base: '/',
      command: 'serve',
      build: { outDir: 'dist' },
    } as never);
    const emitFile = vi.fn();
    await buildStart.call({ emitFile } as never, {} as never);
    expect(emitFile).not.toHaveBeenCalled();
  });
});
