import { describe, expect, it } from 'vitest';
import { createHomeframeRouter } from '@homeframe/router';

describe('HomeframeRouter', () => {
  it('uses genuine history entries and derives back direction', async () => {
    history.replaceState(null, '', '/');
    const router = createHomeframeRouter([
      { id: 'home', path: '/', element: null },
      { id: 'item', path: '/items/:id', element: null },
    ]);
    router.start();
    const initial = router.getSnapshot();
    await router.navigate('/items/7');
    expect(location.pathname).toBe('/items/7');
    expect(router.getSnapshot()).toMatchObject({
      index: initial.index + 1,
      direction: 'push',
      status: 'idle',
      match: { params: { id: '7' } },
    });
    const initialState = { __homeframe: { version: 1, key: initial.key, index: initial.index } };
    history.replaceState(initialState, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate', { state: initialState }));
    await Promise.resolve();
    expect(router.getSnapshot().direction).toBe('back');
    expect(router.getSnapshot().url.pathname).toBe('/');
    router.stop();
  });

  it('aborts stale loaders and retains only the newest destination', async () => {
    history.replaceState(null, '', '/');
    let releaseFirst: (() => void) | undefined;
    const router = createHomeframeRouter([
      { id: 'home', path: '/', element: null },
      {
        id: 'slow',
        path: '/slow',
        element: null,
        loader: ({ signal }) => new Promise<string>((resolve, reject) => {
          releaseFirst = () => resolve('slow');
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
      },
      { id: 'fast', path: '/fast', element: null, loader: () => 'fast' },
    ]);
    router.start();
    const slow = router.navigate('/slow');
    await router.navigate('/fast');
    releaseFirst?.();
    await slow;
    expect(router.getSnapshot().url.pathname).toBe('/fast');
    expect(router.getSnapshot().match?.data).toBe('fast');
    router.stop();
  });

  it('uses an internal stack without native swipe surfaces in managed mode', async () => {
    history.replaceState(null, '', '/');
    const nativeLength = history.length;
    const router = createHomeframeRouter([
      { id: 'home', path: '/', element: null },
      { id: 'item', path: '/items/:id', element: null },
    ], { historyMode: 'managed', edgeNavigation: false });
    router.start();

    await router.navigate('/items/1');
    await router.navigate('/items/2');
    expect(history.length).toBe(nativeLength);
    expect(router.getSnapshot()).toMatchObject({
      direction: 'push',
      match: { params: { id: '2' } },
    });

    router.back();
    await Promise.resolve();
    expect(location.pathname).toBe('/items/1');
    expect(router.getSnapshot().direction).toBe('back');

    router.forward();
    await Promise.resolve();
    expect(location.pathname).toBe('/items/2');
    expect(router.getSnapshot().direction).toBe('forward');
    router.stop();
  });
});
