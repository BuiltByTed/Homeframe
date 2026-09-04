import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createHomeframeRouter } from '@builtbyted/router';
import { useStateCheckpoint } from '@builtbyted/react';
import { generateServiceWorker } from '@builtbyted/sw';

beforeEach(() => {
  history.replaceState({}, '', '/');
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('checkpoint identity', () => {
  it('restores a different draft without overwriting either draft or accepting its stale setter', () => {
    sessionStorage.setItem('hf:checkpoint:1:alice', JSON.stringify('Alice draft'));
    sessionStorage.setItem('hf:checkpoint:1:bob', JSON.stringify('Bob draft'));
    const { result, rerender } = renderHook(({ key }) => useStateCheckpoint({ key, initialValue: '' }), {
      initialProps: { key: 'alice' },
    });
    const setAlice = result.current[1];
    expect(result.current[0]).toBe('Alice draft');
    rerender({ key: 'bob' });
    expect(result.current[0]).toBe('Bob draft');
    act(() => setAlice('Late Alice response'));
    expect(result.current[0]).toBe('Bob draft');
    act(() => result.current[1]((draft) => `${draft}!`));
    expect(sessionStorage.getItem('hf:checkpoint:1:alice')).toBe(JSON.stringify('Alice draft'));
    expect(sessionStorage.getItem('hf:checkpoint:1:bob')).toBe(JSON.stringify('Bob draft!'));
  });

  it('restores version and storage changes and initializes missing identities independently', () => {
    sessionStorage.setItem('hf:checkpoint:2:draft', JSON.stringify('Version two'));
    localStorage.setItem('hf:checkpoint:2:draft', JSON.stringify('Local draft'));
    const { result, rerender } = renderHook(
      ({ storage, version }: { storage: 'session' | 'local'; version: number }) =>
        useStateCheckpoint({ key: 'draft', initialValue: 'New draft', storage, version }),
      { initialProps: { storage: 'session', version: 1 } },
    );
    act(() => result.current[1]('Version one'));
    rerender({ storage: 'session', version: 2 });
    expect(result.current[0]).toBe('Version two');
    rerender({ storage: 'local', version: 2 });
    expect(result.current[0]).toBe('Local draft');
    rerender({ storage: 'local', version: 3 });
    expect(result.current[0]).toBe('New draft');
    expect(sessionStorage.getItem('hf:checkpoint:1:draft')).toBe(JSON.stringify('Version one'));
  });
});

describe('route data lifetime', () => {
  it('loads fresh data on new visits and revalidates without adding history entries', async () => {
    let account = 'Alice';
    const loader = vi.fn(() => ({ account }));
    const router = createHomeframeRouter([
      { id: 'home', path: '/', element: null },
      { id: 'profile', path: '/profile', element: null, loader },
    ]);
    router.start();
    try {
      await router.navigate('/profile');
      await router.navigate('/');
      account = 'Bob';
      await router.navigate('/profile');
      expect(router.getSnapshot().match?.data).toEqual({ account: 'Bob' });
      const { key, index } = router.getSnapshot();
      const length = history.length;
      account = 'Carol';
      await router.revalidate();
      expect(router.getSnapshot()).toMatchObject({ key, index, scroll: 'preserve', match: { data: { account: 'Carol' } } });
      expect(history.length).toBe(length);
      expect(loader).toHaveBeenCalledTimes(3);
    } finally { router.stop(); }
  });

  it('uses a prefetch once, expires old prefetches, and bounds history reuse', async () => {
    const loader = vi.fn(() => loader.mock.calls.length);
    const router = createHomeframeRouter([
      { id: 'home', path: '/', element: null },
      { id: 'data', path: '/data', element: null, loader },
    ], { historyMode: 'managed' });
    router.start();
    const now = Date.now();
    const date = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      await router.prefetch('/data');
      await router.navigate('/data');
      expect(loader).toHaveBeenCalledTimes(1);
      await router.navigate('/');
      router.back();
      await Promise.resolve();
      expect(loader).toHaveBeenCalledTimes(1);
      await router.navigate('/');
      date.mockReturnValue(now + 61_000);
      router.back();
      await Promise.resolve();
      expect(loader).toHaveBeenCalledTimes(2);
      await router.navigate('/');
      await router.navigate('/data');
      expect(loader).toHaveBeenCalledTimes(3);
      await router.navigate('/');
      await router.prefetch('/data');
      date.mockReturnValue(now + 92_000);
      await router.navigate('/data');
      expect(loader).toHaveBeenCalledTimes(5);
    } finally { router.stop(); }
  });

  it('discards a late prefetch after logout even when its loader ignores abort', async () => {
    let finish!: (value: string) => void;
    const loader = vi.fn()
      .mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }))
      .mockResolvedValue('Bob');
    const router = createHomeframeRouter([
      { id: 'home', path: '/', element: null },
      { id: 'profile', path: '/profile', element: null, loader },
    ]);
    router.start();
    try {
      const pending = router.prefetch('/profile');
      window.dispatchEvent(new Event('homeframe:logout'));
      finish('Alice');
      await pending;
      await router.navigate('/profile');
      expect(router.getSnapshot().match?.data).toBe('Bob');
    } finally { router.stop(); }
  });

  it('settles an aborted navigation cleanly when the router stops', async () => {
    const router = createHomeframeRouter([
      { id: 'home', path: '/', element: null },
      { id: 'slow', path: '/slow', element: null, loader: ({ signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }) },
    ]);
    router.start();
    const navigating = router.navigate('/slow');
    router.stop();
    await expect(navigating).resolves.toBeUndefined();
  });

  it('bounds retained DOM and loader data without discarding older history destinations', async () => {
    document.body.innerHTML = '<div data-hf-viewport><div data-hf-scroll-view>'
      + '<p>Thread item</p>'.repeat(200) + '</div></div>';
    const router = createHomeframeRouter([{ id: 'all', path: '*', element: null, loader: () => 'data' }], {
      historyMode: 'managed',
    });
    router.start();
    try {
      for (let i = 0; i < 120; i += 1) await router.navigate(`/thread/${i}`);
      expect(router['managedEntries'].filter((entry) => entry.snapshot)).toHaveLength(6);
      expect(router['dataCache'].size).toBeLessThanOrEqual(100);
      for (let i = 0; i < 10; i += 1) {
        router.back();
        await Promise.resolve();
      }
      expect(router.getSnapshot().url.pathname).toBe('/thread/109');
      const guard = document.querySelector('[data-hf-edge-guard="back"]')!;
      const touch = new Event('touchstart', { bubbles: true, cancelable: true });
      Object.defineProperty(touch, 'touches', { value: [{ clientX: 4, clientY: 100 }] });
      guard.dispatchEvent(touch);
      expect(router.getNavigationGestureSnapshot().phase).toBe('tracking');
      expect(document.querySelector('[data-hf-edge-preview]')).not.toBeNull();
    } finally { router.stop(); }
  });
});

describe('runtime cache bounds', () => {
  const source = generateServiceWorker({ appId: '/regression', buildId: 'regression', scope: '/', documentFallback: '/', precache: [] });
  const worker = { location: { origin: 'https://example.test' }, addEventListener() {} };

  it.each([null, { updatedAt: Date.now() - 86_400_000 }])('rejects a cached response with missing or expired metadata (%j)', async (meta) => {
    const cache = { match: async () => new Response('yesterday'), delete: vi.fn(async () => true) };
    const deleteMeta = vi.fn(async () => undefined);
    const match = new Function('self', 'caches', 'hooks', `${source}\ngetMeta = hooks.getMeta; deleteMeta = hooks.deleteMeta; return cacheMatch;`)(
      worker, { open: async () => cache }, { getMeta: async () => meta, deleteMeta },
    );
    expect(await match(new Request('https://example.test/data'), { cacheName: 'data', maxAgeSeconds: 60 })).toBeNull();
    expect(cache.delete).toHaveBeenCalledOnce();
    expect(deleteMeta).toHaveBeenCalledOnce();
  });

  it('serves fresh cache hits without extending their expiry', async () => {
    const touchMeta = vi.fn(async () => undefined);
    const match = new Function('self', 'caches', 'hooks', `${source}\ngetMeta = hooks.getMeta; touchMeta = hooks.touchMeta; return cacheMatch;`)(
      worker, { open: async () => ({ match: async () => new Response('fresh') }) },
      { getMeta: async () => ({ updatedAt: Date.now() - 1_000 }), touchMeta },
    );
    const response = await match(new Request('https://example.test/data'), { cacheName: 'data', maxAgeSeconds: 60 });
    expect(await response.text()).toBe('fresh');
    expect(touchMeta.mock.calls[0]?.at(-1)).toBe(false);
  });

  it('rejects an oversized cache clone before the application consumes its streamed response', async () => {
    const bounded = new Function('self', `${source}\nreturn boundedCacheResponse;`)(worker);
    let chunks = 0;
    const response = new Response(new ReadableStream({ pull(controller) {
      controller.enqueue(new Uint8Array(100));
      if (++chunks === 100) controller.close();
    } }));
    const result = bounded(response, 10) as Promise<Response | null>;
    try {
      await expect(Promise.race([result, new Promise((resolve) => setTimeout(() => resolve('stalled'), 200))])).resolves.toBeNull();
      expect(chunks).toBeLessThan(100);
    } finally {
      expect((await response.arrayBuffer()).byteLength).toBe(10_000);
      await result;
    }
  });
});
