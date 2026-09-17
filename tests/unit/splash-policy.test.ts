import { afterEach, describe, expect, it, vi } from 'vitest';
import { splashBootstrap } from '../../packages/vite/src/splash.js';
import type { HomeframeSplashConfig } from '../../packages/vite/src/types.js';

const restore: Array<() => void> = [];
const createMediaQuery = window.matchMedia.bind(window);
function property(object: object, name: string, value: unknown) {
  const descriptor = Object.getOwnPropertyDescriptor(object, name);
  restore.push(() => descriptor
    ? Object.defineProperty(object, name, descriptor)
    : Reflect.deleteProperty(object, name));
  Object.defineProperty(object, name, { configurable: true, value });
}

afterEach(() => {
  restore.splice(0).reverse().forEach((reset) => reset());
  delete document.documentElement.dataset.hfSplashEnabled;
  document.documentElement.style.cssText = '';
});

function environment({ ua = 'Chrome Windows', mode = 'browser', ios = false, touch = 0, platform = 'Win32' } = {}) {
  property(navigator, 'userAgent', ua);
  property(navigator, 'standalone', ios);
  property(navigator, 'maxTouchPoints', touch);
  property(navigator, 'platform', platform);
  property(navigator, 'userAgentData', undefined);
  const changes: Array<() => void> = [];
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
    const list = createMediaQuery(query);
    Object.defineProperty(list, 'matches', { configurable: true, get: () => query === `(display-mode: ${mode})` });
    vi.spyOn(list, 'addEventListener').mockImplementation((_event, listener) => {
      changes.push(() => {
        const event = new Event('change');
        if (typeof listener === 'function') listener(event);
        else listener.handleEvent(event);
      });
    });
    return list;
  });
  vi.spyOn(window, 'addEventListener').mockImplementation(() => undefined);
  return {
    run(config?: HomeframeSplashConfig) {
      new Function('s', splashBootstrap(config))(document.documentElement.style);
      return document.documentElement.dataset.hfSplashEnabled;
    },
    mode(next: string) { mode = next; changes.forEach((listener) => listener()); },
  };
}

describe('launch policy before first paint', () => {
  it.each([
    { label: 'desktop tab', expected: 'false' },
    { label: 'desktop app', mode: 'standalone', expected: 'false' },
    { label: 'desktop overlay app', mode: 'window-controls-overlay', expected: 'false' },
    { label: 'touchscreen desktop app', mode: 'standalone', touch: 10, expected: 'false' },
    { label: 'iPhone tab', ua: 'iPhone', expected: 'false' },
    { label: 'Android tab', ua: 'Android', expected: 'false' },
    { label: 'iPhone app', ua: 'iPhone', ios: true, expected: 'true' },
    { label: 'Android app', ua: 'Android', mode: 'standalone', expected: 'true' },
    { label: 'Android fullscreen app', ua: 'Android', mode: 'fullscreen', expected: 'true' },
    { label: 'iPad desktop user agent', ua: 'Macintosh', platform: 'MacIntel', touch: 5, mode: 'standalone', expected: 'true' },
  ])('$label defaults to splash=$expected', ({ expected, ...options }) => {
    expect(environment(options).run()).toBe(expected);
  });

  it('does not treat a narrow desktop window as a mobile app', () => {
    property(window, 'innerWidth', 390);
    expect(environment({ mode: 'standalone' }).run()).toBe('false');
  });

  it('preserves explicit browser and desktop opt-ins and respects the master switch', () => {
    const browser = environment();
    expect(browser.run({ showInBrowserTabs: true })).toBe('true');
    expect(browser.run({ enabled: false, showInBrowserTabs: true })).toBe('false');
    const desktop = environment({ mode: 'standalone' });
    expect(desktop.run({ showInDesktopApps: true })).toBe('true');
    expect(desktop.run({ showInBrowserTabs: true })).toBe('false');
    expect(environment({ ua: 'iPhone', ios: true }).run({ enabled: false })).toBe('false');
  });

  it('updates the policy when a mobile page moves between browser and installed display modes', () => {
    const mobile = environment({ ua: 'Android' });
    expect(mobile.run()).toBe('false');
    mobile.mode('standalone');
    expect(document.documentElement.dataset.hfSplashEnabled).toBe('true');
    mobile.mode('browser');
    expect(document.documentElement.dataset.hfSplashEnabled).toBe('false');
  });

  it('corrects only splash geometry for an opaque iOS window and retains legacy geometry', () => {
    property(screen, 'width', 390);
    property(screen, 'height', 844);
    property(window, 'innerWidth', 390);
    property(window, 'innerHeight', 785);
    const mobile = environment({ ua: 'iPhone', ios: true });
    mobile.run();
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--hf-splash-offset-y')).toBe('calc(363px - 50vh)');
    expect(style.getPropertyValue('--hf-splash-logo-size')).toBe('85.8px');
    expect(style.getPropertyValue('--hf-shell-height')).toBe('');
    style.cssText = '';
    mobile.run({ appleStatusBarStyle: 'black-translucent' });
    expect(style.getPropertyValue('--hf-splash-offset-y')).toBe('');
  });

  it('retries incomplete cold-launch geometry when only the content height settles', () => {
    property(screen, 'width', 402);
    property(screen, 'height', 874);
    property(window, 'innerWidth', 402);
    property(window, 'innerHeight', 0);
    const mobile = environment({ ua: 'iPhone', ios: true });
    let resize: EventListener | undefined;
    vi.mocked(window.addEventListener).mockImplementation((event: string, listener: EventListenerOrEventListenerObject) => {
      if (event === 'resize' && typeof listener === 'function') resize = listener;
    });
    mobile.run();
    expect(document.documentElement.style.getPropertyValue('--hf-splash-offset-y')).toBe('');
    property(window, 'innerHeight', 812);
    resize?.(new Event('resize'));
    // Native iOS can initially report 100vh=100dvh=874 while innerHeight=812.
    // The resulting -62px translation cancels the native content origin.
    expect(document.documentElement.style.getPropertyValue('--hf-splash-offset-y'))
      .toBe('calc(375px - 50vh)');
    property(window, 'innerHeight', 820);
    resize?.(new Event('resize'));
    expect(document.documentElement.style.getPropertyValue('--hf-splash-offset-y'))
      .toBe('calc(383px - 50vh)');
  });
});
