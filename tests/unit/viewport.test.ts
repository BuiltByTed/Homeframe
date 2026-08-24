import { describe, expect, it, vi } from 'vitest';
import { ViewportController } from '@homeframe/runtime';

class MockVisualViewport extends EventTarget {
  width = 390;
  height = 844;
  offsetLeft = 0;
  offsetTop = 0;
  scale = 1;
}

function installViewport(): MockVisualViewport {
  const viewport = new MockVisualViewport();
  Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
  return viewport;
}

describe('ViewportController', () => {
  it('publishes stable viewport geometry and CSS variables before React needs it', async () => {
    installViewport();
    const controller = new ViewportController();
    controller.start();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(controller.getSnapshot()).toMatchObject({
      width: 390,
      height: 844,
      stableHeight: 844,
      keyboard: { phase: 'closed', height: 0 },
    });
    expect(document.documentElement.style.getPropertyValue('--hf-viewport-height')).toBe('844px');
    expect(document.documentElement.dataset.hfKeyboard).toBe('closed');
    controller.stop();
  });

  it('detects the keyboard only with editable focus and a meaningful visual reduction', async () => {
    const viewport = installViewport();
    const controller = new ViewportController({ settleDelaysMs: [1, 2] });
    controller.start();
    const input = document.createElement('input');
    input.style.fontSize = '16px';
    document.body.append(input);
    input.focus();
    viewport.height = 500;
    viewport.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(controller.getSnapshot().keyboard).toMatchObject({
      phase: 'open',
      height: 344,
      source: 'visual-viewport',
    });
    expect(document.documentElement.style.getPropertyValue('--hf-effective-safe-bottom')).toBe('0px');
    controller.stop();
  });

  it('keeps the shell origin fixed when iOS pans the visual viewport for the keyboard', async () => {
    const viewport = installViewport();
    const controller = new ViewportController({ settleDelaysMs: [1, 2] });
    controller.start();
    const input = document.createElement('input');
    input.style.fontSize = '16px';
    document.body.append(input);
    input.focus();
    viewport.height = 420;
    viewport.offsetTop = 80;
    viewport.dispatchEvent(new Event('resize'));
    viewport.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => setTimeout(resolve, 15));

    expect(controller.getSnapshot()).toMatchObject({ height: 420, y: 80 });
    expect(document.documentElement.style.getPropertyValue('--hf-viewport-y')).toBe('80px');
    expect(document.documentElement.style.getPropertyValue('--hf-shell-height')).toBe('500px');
    controller.stop();
  });

  it('restores installed-app height when the app backgrounds with stale keyboard geometry', async () => {
    const viewport = installViewport();
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    const controller = new ViewportController({ settleDelaysMs: [1, 2] });
    controller.start();
    const input = document.createElement('input');
    input.style.fontSize = '16px';
    document.body.append(input);
    input.focus();
    viewport.height = 500;
    viewport.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(document.documentElement.style.getPropertyValue('--hf-shell-height')).toBe('844px');
    expect(document.documentElement.style.getPropertyValue('--hf-keyboard-height')).toBe('344px');

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(controller.getSnapshot().keyboard.phase).toBe('closed');
    expect(document.documentElement.style.getPropertyValue('--hf-shell-height')).toBe('844px');
    expect(document.activeElement).not.toBe(input);
    controller.stop();
    Object.defineProperty(navigator, 'standalone', { value: false, configurable: true });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('does not call an ordinary window resize a keyboard', async () => {
    const viewport = installViewport();
    const controller = new ViewportController({ settleDelaysMs: [1] });
    controller.start();
    viewport.height = 500;
    viewport.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(controller.getSnapshot().keyboard.phase).toBe('closed');
    controller.stop();
  });

  it('handles geometry-before-focus and duplicate resize events without a false keyboard close', async () => {
    const viewport = installViewport();
    const controller = new ViewportController({ settleDelaysMs: [1, 2] });
    controller.start();
    viewport.height = 500;
    viewport.dispatchEvent(new Event('resize'));
    viewport.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(controller.getSnapshot().keyboard.phase).toBe('closed');

    const input = document.createElement('input');
    input.style.fontSize = '16px';
    document.body.append(input);
    input.focus();
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(controller.getSnapshot().keyboard).toMatchObject({ phase: 'open', height: 344 });
    controller.stop();
  });

  it('keeps the dock geometry in closing until stale iOS keyboard geometry recovers', async () => {
    const viewport = installViewport();
    const controller = new ViewportController({ settleDelaysMs: [1, 2] });
    controller.start();
    const input = document.createElement('input');
    input.style.fontSize = '16px';
    document.body.append(input);
    input.focus();
    viewport.height = 500;
    viewport.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => setTimeout(resolve, 15));
    input.blur();
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(controller.getSnapshot().keyboard).toMatchObject({ phase: 'closing', height: 344 });
    expect(document.documentElement.style.getPropertyValue('--hf-keyboard-height')).toBe('344px');

    viewport.height = 844;
    viewport.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(controller.getSnapshot().keyboard).toMatchObject({ phase: 'closed', height: 0 });
    controller.stop();
  });

  it('preserves geometry invariants across randomized transient samples', async () => {
    const viewport = installViewport();
    const controller = new ViewportController({ settleDelaysMs: [] });
    controller.start();
    let seed = 0x5eed1234;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    for (let index = 0; index < 80; index += 1) {
      viewport.width = random() < 0.1 ? Number.NaN : -100 + random() * 1_200;
      viewport.height = random() < 0.1 ? Number.POSITIVE_INFINITY : -100 + random() * 2_500;
      viewport.offsetLeft = -50 + random() * 1_000;
      viewport.offsetTop = -50 + random() * 2_000;
      viewport.scale = -1 + random() * 14;
      viewport.dispatchEvent(new Event('resize'));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const next = controller.getSnapshot();
      expect(Number.isFinite(next.width) && next.width >= 0).toBe(true);
      expect(Number.isFinite(next.height) && next.height >= 0).toBe(true);
      expect(Number.isFinite(next.x) && next.x >= 0).toBe(true);
      expect(Number.isFinite(next.y) && next.y >= 0).toBe(true);
      expect(next.keyboard.height).toBeGreaterThanOrEqual(0);
      expect(next.safeArea.top).toBeLessThanOrEqual(next.stableHeight / 2);
      expect(next.safeArea.bottom).toBeLessThanOrEqual(next.stableHeight / 2);
    }
    controller.stop();
  });

  it('reports sub-16px focused controls', () => {
    installViewport();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const controller = new ViewportController();
    controller.start();
    const input = document.createElement('input');
    input.style.fontSize = '12px';
    document.body.append(input);
    input.focus();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('HF_INPUT_ZOOM'), input);
    controller.stop();
  });

  it('focuses completed taps with preventScroll without focusing during touch-down', () => {
    installViewport();
    const controller = new ViewportController();
    controller.start();
    const input = document.createElement('input');
    input.style.fontSize = '16px';
    const focus = vi.spyOn(input, 'focus');
    document.body.append(input);
    input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(focus).not.toHaveBeenCalled();
    input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(input);
    controller.stop();
  });

  it('raises the editable-text minimum when the initial viewport is scaled down', async () => {
    const viewport = installViewport();
    viewport.scale = 0.75;
    const controller = new ViewportController();
    controller.start();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(Number.parseFloat(
      document.documentElement.style.getPropertyValue('--hf-input-min-font-size'),
    )).toBeCloseTo(16 / 0.75, 4);
    controller.stop();
  });

  it('does not misclassify a deeply shrunken portrait keyboard viewport as landscape', async () => {
    const viewport = installViewport();
    const controller = new ViewportController({ settleDelaysMs: [1, 2] });
    controller.start();
    const input = document.createElement('input');
    input.style.fontSize = '16px';
    document.body.append(input);
    input.focus();
    viewport.height = 280;
    viewport.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(controller.getSnapshot()).toMatchObject({
      orientation: 'portrait',
      keyboard: { phase: 'open', height: 564 },
    });
    controller.stop();
  });

  it('self-corrects orientation without depending on an orientationchange event', async () => {
    const viewport = installViewport();
    const controller = new ViewportController({ settleDelaysMs: [1, 2] });
    controller.start();
    Object.defineProperty(window, 'innerWidth', { value: 844, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 390, configurable: true });
    viewport.width = 844;
    viewport.height = 390;
    viewport.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(controller.getSnapshot()).toMatchObject({
      orientation: 'landscape',
      stableWidth: 844,
      stableHeight: 390,
      keyboard: { phase: 'closed' },
    });
    controller.stop();
  });

  it('rejects invalid and overlarge visual viewport samples without publishing corrupt CSS', async () => {
    const viewport = installViewport();
    const controller = new ViewportController({ settleDelaysMs: [1] });
    controller.start();
    const before = controller.getSnapshot();
    viewport.width = Number.POSITIVE_INFINITY;
    viewport.height = 999_999;
    viewport.offsetLeft = -50;
    viewport.offsetTop = Number.NaN;
    viewport.scale = 999;
    viewport.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const snapshot = controller.getSnapshot();
    expect(snapshot).toMatchObject({
      width: before.width,
      height: before.height,
      x: before.x,
      y: before.y,
      scale: before.scale,
    });
    const css = document.documentElement.getAttribute('style') ?? '';
    expect(css).not.toMatch(/NaN|Infinity|999999/);
    controller.stop();
  });
});
