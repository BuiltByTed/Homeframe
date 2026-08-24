import { describe, expect, it, vi } from 'vitest';
import { createHomeframeRouter } from '@homeframe/router';

function dispatchTouch(target: Element, type: string, clientX?: number, clientY?: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', {
    value: clientX === undefined || clientY === undefined ? [] : [{ clientX, clientY }],
  });
  target.dispatchEvent(event);
  return event;
}

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

    await router.navigate('/items/1', { state: { galleryItem: 'one' } });
    await router.navigate('/items/2');
    expect(history.length).toBe(nativeLength);
    expect(router.getSnapshot()).toMatchObject({
      direction: 'push',
      scroll: 'reset',
      match: { params: { id: '2' } },
    });

    await router.navigate('/items/2?gallery=one', {
      replace: true,
      state: { galleryItem: 'one' },
      preventScrollReset: true,
    });
    expect(router.getSnapshot()).toMatchObject({
      direction: 'replace',
      scroll: 'preserve',
      state: { galleryItem: 'one' },
    });

    router.back();
    await Promise.resolve();
    expect(location.pathname).toBe('/items/1');
    expect(router.getSnapshot().direction).toBe('back');
    expect(router.getSnapshot().scroll).toBe('restore');
    expect(router.getSnapshot().state).toEqual({ galleryItem: 'one' });

    router.forward();
    await Promise.resolve();
    expect(location.pathname).toBe('/items/2');
    expect(router.getSnapshot().direction).toBe('forward');
    router.stop();
  });

  it('coalesces edge tracking into direct compositor transforms', async () => {
    history.replaceState(null, '', '/');
    document.body.innerHTML = `
      <div data-hf-viewport>
        <div data-hf-scroll-view><p>Snapshot content</p></div>
      </div>
    `;
    const router = createHomeframeRouter([
      { id: 'home', path: '/', element: null },
      { id: 'item', path: '/items/:id', element: null },
    ], { historyMode: 'managed' });
    router.start();
    await router.navigate('/items/1');

    const guard = document.querySelector<HTMLElement>('[data-hf-edge-guard="back"]')!;
    const live = document.querySelector<HTMLElement>('[data-hf-viewport]')!;
    const clone = vi.spyOn(Node.prototype, 'cloneNode');
    const animationFrame = vi.spyOn(window, 'requestAnimationFrame');

    dispatchTouch(guard, 'touchstart', 4, 100);
    dispatchTouch(guard, 'touchmove', 44, 101);
    dispatchTouch(guard, 'touchmove', 104, 102);

    expect(clone).toHaveBeenCalledTimes(1);
    expect(animationFrame).toHaveBeenCalledTimes(1);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(live.style.transform).toBe('translate3d(100px, 0, 0)');
    expect(document.documentElement.style.getPropertyValue('--hf-edge-live-offset')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--hf-edge-preview-offset')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--hf-edge-progress')).toBe('');

    clone.mockRestore();
    animationFrame.mockRestore();
    router.stop();
  });

  it('intercepts only same-origin HTTP routes inside the configured scope', () => {
    history.replaceState(null, '', '/app/');
    const router = createHomeframeRouter([
      { id: 'home', path: '/app/', element: null },
    ], { scope: '/app/' });
    expect(router.canHandle('/app/items/1')).toBe(true);
    expect(router.canHandle('/outside')).toBe(false);
    expect(router.canHandle('https://example.com/app/')).toBe(false);
    expect(router.canHandle('mailto:hello@example.com')).toBe(false);
  });
});
