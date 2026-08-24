import { createHash } from 'node:crypto';
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
      rangeRequests: true,
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
    expect(worker).toContain("crypto.subtle.digest('SHA-256'");
    expect(worker).toContain('Revision mismatch for ');
    expect(worker).not.toContain('caches.keys()).then((keys) => Promise.all(keys.map');
  });

  it('commits only revision-matching precache bodies and deletes a failed build cache', async () => {
    const body = 'verified application chunk';
    const salt = 'emergency-bust';
    const revision = createHash('sha256').update(body).update(salt).digest('hex');
    const matching = generateServiceWorker({
      appId: '/verify',
      buildId: 'matching',
      scope: '/',
      documentFallback: '/asset.js',
      revisionSalt: salt,
      precache: [{ url: '/asset.js', revision }],
    });
    const success = executeWorkerInstall(matching, body);
    await expect(success.install).resolves.toBeUndefined();
    expect(success.puts).toBe(1);
    expect(success.deletes).toBe(0);

    const mismatching = generateServiceWorker({
      appId: '/verify',
      buildId: 'mismatch',
      scope: '/',
      documentFallback: '/asset.js',
      precache: [{ url: '/asset.js', revision: '0'.repeat(64) }],
    });
    const failure = executeWorkerInstall(mismatching, body);
    await expect(failure.install).rejects.toThrow(/Revision mismatch/);
    expect(failure.puts).toBe(0);
    expect(failure.deletes).toBe(1);
  });

  it('contains bounded runtime cache metadata and offline navigation fallback', () => {
    expect(worker).toContain('homeframe-cache-meta');
    expect(worker).toContain('maxAgeSeconds');
    expect(worker).toContain('maxEntries');
    expect(worker).toContain('maxResponseBytes');
    expect(worker).toContain('boundedCacheResponse');
    expect(worker).toContain("response.type === 'opaque'");
    expect(worker).toContain('purgeMetaCache');
    expect(worker).toContain('deleteMeta(cacheName, request.url)');
    expect(worker).toContain('rangedResponse');
    expect(worker).toContain('^bytes=(\\d*)-(\\d*)$');
    expect(worker).toContain('ignoreSearch: false, ignoreVary: true');
    expect(worker).toContain("status: 206, statusText: 'Partial Content'");
    expect(worker).toContain('response.status === 206');
    expect(() => new Function(worker)).not.toThrow();
    expect(worker).toContain("new Response('Offline'");
  });

  it('validates notification routes and handles clicks through scoped clients', () => {
    expect(worker).toContain("self.addEventListener('push'");
    expect(worker).toContain("self.addEventListener('notificationclick'");
    expect(worker).toContain('notificationRouteAllowed');
    expect(worker).toContain('maximumPayloadBytes');
    expect(worker).toContain('notificationActions');
    expect(worker).toContain("data.version !== 1");
    expect(worker).toContain('HF_NOTIFICATION_ROUTE');
    expect(worker).toContain("self.addEventListener('pushsubscriptionchange'");
    expect(worker).toContain('self.registration.pushManager.subscribe');
    expect(worker).toContain('synchronizeRotatedSubscription');
  });

  it('partitions private runtime data by a one-way account key and makes logout purge explicit', async () => {
    const privateWorker = generateServiceWorker({
      appId: '/private-test',
      buildId: 'private-build',
      scope: '/',
      documentFallback: '/',
      precache: [{ url: '/', revision: 'document' }],
      runtimeCaching: [{
        match: '/api/profile',
        matchType: 'exact',
        strategy: 'network-first',
        cacheName: 'private-profile',
        maxEntries: 4,
        maxAgeSeconds: 60,
        sensitiveData: {
          partitionKeySource: "(request) => request.headers.get('x-test-account') || ''",
          purgeOnLogout: true,
          threatReview: 'SEC-PRIVATE-ACCOUNT-SWITCH',
        },
      }],
    });
    const runtime = exposeWorkerInternals(privateWorker);
    const rule = runtime.HF.runtimeCaching[0];
    const alice = await runtime.cacheKey(new Request('https://homeframe.test/api/profile', {
      headers: { 'x-test-account': 'alice@example.test' },
    }), rule);
    const bob = await runtime.cacheKey(new Request('https://homeframe.test/api/profile', {
      headers: { 'x-test-account': 'bob@example.test' },
    }), rule);
    const anonymous = await runtime.cacheKey(new Request('https://homeframe.test/api/profile'), rule);

    expect(alice?.url).not.toBe(bob?.url);
    expect(alice?.url).not.toContain('alice');
    expect(bob?.url).not.toContain('bob');
    expect(new URL(alice!.url).searchParams.get('__hf_partition')).toMatch(/^[a-f0-9]{64}$/);
    expect(anonymous).toBeNull();
    expect(privateWorker).toContain("message.type === 'HF_PURGE_PRIVATE'");
    expect(privateWorker).toContain('purgeOnLogout');
  });

  it('supports trusted function request matchers without runtime eval', () => {
    const matchingWorker = generateServiceWorker({
      appId: '/matcher-test',
      buildId: 'matcher-build',
      scope: '/',
      documentFallback: '/',
      precache: [{ url: '/', revision: 'document' }],
      runtimeCaching: [{
        match: '[configured matcher]',
        matchType: 'function',
        matchFunctionSource: "(request, url) => request.method === 'GET' && url.pathname.endsWith('/avatar')",
        strategy: 'cache-first',
        cacheName: 'avatars',
        maxEntries: 4,
        maxAgeSeconds: 60,
        sensitiveData: 'none',
      }],
    });
    const runtime = exposeWorkerInternals(matchingWorker);
    expect(runtime.ruleFor(new Request('https://homeframe.test/users/1/avatar'))?.cacheName).toBe('avatars');
    expect(runtime.ruleFor(new Request('https://homeframe.test/users/1/profile'))).toBeUndefined();
    expect(matchingWorker).not.toMatch(/\beval\s*\(/);
  });

  it('focuses the best same-origin client and routes a validated notification click', async () => {
    const messages: unknown[] = [];
    let focused = 0;
    const visibleClient = {
      url: 'https://homeframe.test/history',
      visibilityState: 'visible',
      async focus() { focused += 1; },
      postMessage(message: unknown) { messages.push(message); },
    };
    const runtime = executeWorkerEvents(worker, [
      { ...visibleClient, visibilityState: 'hidden' },
      visibleClient,
      { url: 'https://other.test/', visibilityState: 'visible', async focus() {}, postMessage() {} },
    ]);
    let closed = 0;
    await runtime.dispatch('notificationclick', {
      notification: {
        data: { route: '/inbox/thread-42' },
        close() { closed += 1; },
      },
    });
    expect(closed).toBe(1);
    expect(focused).toBe(1);
    expect(messages).toEqual([{ type: 'HF_NOTIFICATION_ROUTE', route: '/inbox/thread-42' }]);
    expect(runtime.opened).toEqual([]);
  });

  it('treats notification allowlist entries as path boundaries', async () => {
    const runtime = executeWorkerEvents(worker, []);
    await runtime.dispatch('notificationclick', {
      notification: {
        data: { route: '/inbox-impersonator/thread-42' },
        close() {},
      },
    });
    expect(runtime.opened).toEqual(['https://homeframe.test/']);
  });

  it('sanitizes an untrusted push payload before displaying a notification', async () => {
    const runtime = executeWorkerEvents(worker, []);
    await runtime.dispatch('push', {
      data: {
        text: () => JSON.stringify({
          version: 1,
          title: { toString: () => { throw new Error('must not execute'); } },
          body: 'Safe body',
          route: 'https://attacker.example/phish',
          icon: 'https://attacker.example/icon.png',
          renotify: true,
          actions: Array.from({ length: 10 }, (_, index) => ({ action: `a${index}`, title: `A${index}` })),
        }),
      },
    });
    expect(runtime.notifications).toHaveLength(1);
    expect(runtime.notifications[0]).toMatchObject({
      title: 'Test',
      options: {
        body: 'Safe body',
        icon: undefined,
        tag: undefined,
        renotify: false,
        data: { route: '/', payloadVersion: 1 },
      },
    });
    expect(runtime.notifications[0]?.options.actions).toHaveLength(2);
  });
});

function exposeWorkerInternals(worker: string): {
  HF: { runtimeCaching: Array<Record<string, unknown>> };
  cacheKey(request: Request, rule: unknown): Promise<Request | null>;
  ruleFor(request: Request): { cacheName?: string } | undefined;
} {
  const self = {
    location: { origin: 'https://homeframe.test' },
    clients: { matchAll: async () => [], claim: async () => undefined },
    navigator: {},
    registration: {},
    addEventListener() {},
    skipWaiting: async () => undefined,
  };
  const run = new Function(
    'self',
    'caches',
    'fetch',
    'Request',
    'Response',
    'Headers',
    'TextEncoder',
    'crypto',
    'indexedDB',
    `${worker}\nreturn { HF, cacheKey, ruleFor };`,
  );
  return run(
    self,
    {},
    fetch,
    Request,
    Response,
    Headers,
    TextEncoder,
    globalThis.crypto,
    {},
  );
}

function executeWorkerEvents(
  worker: string,
  windowClients: Array<Record<string, unknown>>,
): {
  dispatch(type: string, value: Record<string, unknown>): Promise<void>;
  notifications: Array<{ title: string; options: Record<string, unknown> }>;
  opened: string[];
} {
  const listeners = new Map<string, (event: Record<string, unknown> & { waitUntil(value: Promise<void>): void }) => void>();
  const notifications: Array<{ title: string; options: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const self = {
    location: { origin: 'https://homeframe.test' },
    clients: {
      matchAll: async () => windowClients,
      claim: async () => undefined,
      async openWindow(url: string) { opened.push(url); },
    },
    navigator: {},
    registration: {
      async showNotification(title: string, options: Record<string, unknown>) {
        notifications.push({ title, options });
      },
    },
    addEventListener(type: string, listener: typeof listeners extends Map<string, infer T> ? T : never) {
      listeners.set(type, listener);
    },
    skipWaiting: async () => undefined,
  };
  const run = new Function(
    'self', 'caches', 'fetch', 'Request', 'Response', 'Headers', 'TextEncoder', 'crypto', 'indexedDB', worker,
  );
  run(self, {}, fetch, Request, Response, Headers, TextEncoder, globalThis.crypto, {});
  return {
    notifications,
    opened,
    async dispatch(type, value) {
      let work = Promise.resolve();
      listeners.get(type)?.({ ...value, waitUntil(next) { work = next; } });
      await work;
    },
  };
}

function executeWorkerInstall(worker: string, body: string): {
  install: Promise<void>;
  readonly puts: number;
  readonly deletes: number;
} {
  const listeners = new Map<string, (event: { waitUntil(value: Promise<void>): void }) => void>();
  let install = Promise.resolve();
  let puts = 0;
  let deletes = 0;
  const self = {
    location: { origin: 'https://homeframe.test' },
    clients: { matchAll: async () => [], claim: async () => undefined },
    navigator: {},
    registration: {},
    addEventListener(type: string, listener: (event: { waitUntil(value: Promise<void>): void }) => void) {
      listeners.set(type, listener);
    },
    skipWaiting: async () => undefined,
  };
  const caches = {
    async open() {
      return {
        async put() { puts += 1; },
      };
    },
    async delete() { deletes += 1; return true; },
    async keys() { return []; },
  };
  class RelativeRequest {
    url: string;
    method = 'GET';
    mode = 'same-origin';
    headers = new Headers();
    constructor(value: string) {
      this.url = new URL(value, self.location.origin).href;
    }
  }
  const run = new Function(
    'self',
    'caches',
    'fetch',
    'Request',
    'Response',
    'Headers',
    'TextEncoder',
    'crypto',
    'indexedDB',
    worker,
  );
  run(
    self,
    caches,
    async () => new Response(body, { status: 200, headers: { 'Content-Type': 'text/javascript' } }),
    RelativeRequest,
    Response,
    Headers,
    TextEncoder,
    globalThis.crypto,
    {},
  );
  listeners.get('install')?.({ waitUntil(value) { install = value; } });
  return {
    get install() { return install; },
    get puts() { return puts; },
    get deletes() { return deletes; },
  };
}
