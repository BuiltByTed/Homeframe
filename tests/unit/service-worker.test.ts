import { describe, expect, it } from 'vitest';
import { generateServiceWorker } from '@homeframe/sw';

describe('service-worker generator', () => {
  const worker = generateServiceWorker({
    appId: '/test',
    buildId: 'build-42',
    scope: '/',
    documentFallback: '/',
    precache: [
      { url: '/', revision: 'index-revision' },
      { url: '/assets/app.123.js', revision: 'asset-revision' },
    ],
    runtimeCaching: [{
      match: '/images/',
      strategy: 'stale-while-revalidate',
      cacheName: 'images',
      maxEntries: 8,
      maxAgeSeconds: 600,
    }],
    notifications: {
      defaultTitle: 'Test',
      routeAllowlist: ['/inbox'],
    },
  });

  it('contains atomic install, activation, and app-owned cleanup behavior', () => {
    expect(worker).toContain('HF_UPDATE_READY');
    expect(worker).toContain('HF_SKIP_WAITING');
    expect(worker).toContain("self.clients.claim()");
    expect(worker).toContain('hf-test-precache-build-42');
    expect(worker).not.toContain('caches.keys()).then((keys) => Promise.all(keys.map');
  });

  it('contains bounded runtime cache metadata and offline navigation fallback', () => {
    expect(worker).toContain('homeframe-cache-meta');
    expect(worker).toContain('maxAgeSeconds');
    expect(worker).toContain('maxEntries');
    expect(worker).toContain("new Response('Offline'");
  });

  it('validates notification routes and handles clicks through scoped clients', () => {
    expect(worker).toContain("self.addEventListener('push'");
    expect(worker).toContain("self.addEventListener('notificationclick'");
    expect(worker).toContain('notificationRouteAllowed');
    expect(worker).toContain('HF_NOTIFICATION_ROUTE');
  });
});
