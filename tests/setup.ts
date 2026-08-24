import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  value: ResizeObserverMock,
  configurable: true,
});

Object.defineProperty(globalThis, 'requestAnimationFrame', {
  value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0),
  configurable: true,
});

Object.defineProperty(globalThis, 'cancelAnimationFrame', {
  value: (id: number) => window.clearTimeout(id),
  configurable: true,
});

Object.defineProperty(window, 'matchMedia', {
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  }),
  configurable: true,
});

Object.defineProperty(window, 'scrollTo', { value: vi.fn(), configurable: true });
Object.defineProperty(Element.prototype, 'scrollBy', { value: vi.fn(), configurable: true });

if (!globalThis.CSS) Object.defineProperty(globalThis, 'CSS', { value: {}, configurable: true });
if (!globalThis.CSS.escape) globalThis.CSS.escape = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-hf-keyboard');
  document.documentElement.removeAttribute('data-hf-ready');
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
  vi.useRealTimers();
});
