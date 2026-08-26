import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewportController } from '@builtbyted/runtime';

class MockVisualViewport extends EventTarget {
  width = 390;
  height = 844;
  offsetLeft = 0;
  offsetTop = 0;
  pageTop = 0;
  scale = 1;
}

function installViewport(): MockVisualViewport {
  const viewport = new MockVisualViewport();
  Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
  return viewport;
}

function mockSafeAreaTop(top: number) {
  const nativeGetComputedStyle = window.getComputedStyle.bind(window);
  return vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudoElement) => {
    const styles = nativeGetComputedStyle(element, pseudoElement);
    if (!(element instanceof HTMLElement) || element.dataset.hfSafeAreaProbe === undefined) {
      return styles;
    }
    return new Proxy(styles, {
      get(target, property, receiver) {
        if (property === 'paddingTop') return `${top}px`;
        return Reflect.get(target, property, receiver);
      },
    });
  });
}

function mockSafeAreaBottom(bottom: number) {
  const nativeGetComputedStyle = window.getComputedStyle.bind(window);
  return vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudoElement) => {
    const styles = nativeGetComputedStyle(element, pseudoElement);
    if (!(element instanceof HTMLElement) || element.dataset.hfSafeAreaProbe === undefined) {
      return styles;
    }
    return new Proxy(styles, {
      get(target, property, receiver) {
        if (property === 'paddingBottom') return `${bottom}px`;
        return Reflect.get(target, property, receiver);
      },
    });
  });
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

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
    expect(document.documentElement.dataset.hfViewportOwner).toBe('runtime');
    controller.stop();
    expect(document.documentElement.dataset.hfViewportOwner).toBe('runtime');
  });

  it('publishes and removes the configured keyboard occlusion policy', () => {
    installViewport();
    const controller = new ViewportController({
      settleDelaysMs: [],
      keyboardOcclusion: 'transparent',
    });
    controller.start();
    expect(document.documentElement.dataset.hfKeyboardOcclusion).toBe('transparent');
    controller.stop();
    expect(document.documentElement.dataset.hfKeyboardOcclusion).toBeUndefined();
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

  it('counteracts standalone iOS page pan without including native UI outside the WebView', async () => {
    const viewport = installViewport();
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    Object.defineProperty(window.screen, 'height', { value: 852, configurable: true });
    const controller = new ViewportController({
      settleDelaysMs: [1, 2],
      keyboardStabilizationMs: 5,
    });
    controller.start();
    const shell = document.createElement('div');
    shell.dataset.hfShell = '';
    const scroller = document.createElement('div');
    scroller.dataset.hfScrollView = '';
    scroller.scrollTop = 275;
    const input = document.createElement('input');
    input.style.fontSize = '16px';
    shell.append(scroller, input);
    document.body.append(shell);
    input.focus();

    viewport.height = 500;
    viewport.pageTop = 64;
    viewport.dispatchEvent(new Event('resize'));
    viewport.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => setTimeout(resolve, 15));

    expect(controller.getSnapshot()).toMatchObject({
      stableHeight: 844,
      pageTop: 64,
      keyboard: { height: 344 },
    });
    expect(document.documentElement.style.getPropertyValue('--hf-layout-viewport-top')).toBe('64px');
    expect(document.documentElement.style.getPropertyValue('--hf-shell-height')).toBe('844px');
    expect(scroller.scrollTop).toBe(275);
    expect(document.documentElement.dataset.hfIosStandalone).toBe('true');
    controller.stop();
    Object.defineProperty(navigator, 'standalone', { value: false, configurable: true });
    Object.defineProperty(window.screen, 'height', { value: 0, configurable: true });
  });

  it.each([
    { appHeight: 647, screenHeight: 667 },
    { appHeight: 790, screenHeight: 852 },
    { appHeight: 812, screenHeight: 874 },
    { appHeight: 870, screenHeight: 932 },
  ])('uses the measured $appHeight px app frame on a $screenHeight px iPhone screen', ({ appHeight, screenHeight }) => {
    const viewport = installViewport();
    viewport.height = appHeight;
    Object.defineProperty(window, 'innerHeight', { value: appHeight, configurable: true });
    Object.defineProperty(window.screen, 'height', { value: screenHeight, configurable: true });
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    const controller = new ViewportController({ settleDelaysMs: [] });
    controller.start();

    expect(controller.getSnapshot().stableHeight).toBe(appHeight);
    expect(document.documentElement.style.getPropertyValue('--hf-shell-height')).toBe(`${appHeight}px`);
    controller.stop();
    Object.defineProperty(navigator, 'standalone', { value: false, configurable: true });
    Object.defineProperty(window.screen, 'height', { value: 0, configurable: true });
  });

  it.each([
    { appHeight: 647, screenHeight: 667, safeTop: 20 },
    { appHeight: 790, screenHeight: 852, safeTop: 62 },
    { appHeight: 812, screenHeight: 874, safeTop: 62 },
    { appHeight: 870, screenHeight: 932, safeTop: 62 },
  ])('fills a measured $screenHeight px translucent scene from a $appHeight px WebKit viewport', ({ appHeight, screenHeight, safeTop }) => {
    const viewport = installViewport();
    viewport.height = appHeight;
    Object.defineProperty(window, 'innerHeight', { value: appHeight, configurable: true });
    Object.defineProperty(window.screen, 'height', { value: screenHeight, configurable: true });
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    const safeArea = mockSafeAreaTop(safeTop);
    const controller = new ViewportController({ settleDelaysMs: [] });
    controller.start();

    expect(controller.getSnapshot().stableHeight).toBe(screenHeight);
    expect(document.documentElement.style.getPropertyValue('--hf-shell-height')).toBe(`${screenHeight}px`);
    controller.stop();
    safeArea.mockRestore();
    Object.defineProperty(navigator, 'standalone', { value: false, configurable: true });
    Object.defineProperty(window.screen, 'height', { value: 0, configurable: true });
  });

  it('does not retain the translucent scene inset after WebKit expands to the full screen', async () => {
    const viewport = installViewport();
    viewport.height = 812;
    Object.defineProperty(window, 'innerHeight', { value: 812, configurable: true });
    Object.defineProperty(window.screen, 'height', { value: 874, configurable: true });
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    const safeArea = mockSafeAreaTop(62);
    const controller = new ViewportController({ settleDelaysMs: [1, 2] });
    controller.start();

    expect(controller.getSnapshot().stableHeight).toBe(874);

    Object.defineProperty(window, 'innerHeight', { value: 874, configurable: true });
    viewport.height = 874;
    viewport.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => setTimeout(resolve, 15));

    expect(controller.getSnapshot()).toMatchObject({
      height: 874,
      stableHeight: 874,
      keyboard: { phase: 'closed', height: 0 },
    });
    expect(document.documentElement.style.getPropertyValue('--hf-shell-height')).toBe('874px');
    controller.stop();
    safeArea.mockRestore();
    Object.defineProperty(navigator, 'standalone', { value: false, configurable: true });
    Object.defineProperty(window.screen, 'height', { value: 0, configurable: true });
  });

  it('closes the keyboard against a translucent scene’s measured WebKit baseline', async () => {
    const viewport = installViewport();
    viewport.height = 812;
    Object.defineProperty(window, 'innerHeight', { value: 812, configurable: true });
    Object.defineProperty(window.screen, 'height', { value: 874, configurable: true });
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    const safeArea = mockSafeAreaTop(62);
    const controller = new ViewportController({ settleDelaysMs: [1, 2] });
    controller.start();
    const input = document.createElement('input');
    input.style.fontSize = '16px';
    document.body.append(input);
    input.focus();
    viewport.height = 409;
    viewport.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(controller.getSnapshot()).toMatchObject({
      stableHeight: 874,
      keyboard: { phase: 'open', height: 465 },
    });

    input.blur();
    viewport.height = 812;
    viewport.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(controller.getSnapshot()).toMatchObject({
      stableHeight: 874,
      keyboard: { phase: 'closed', height: 0 },
    });
    expect(document.documentElement.style.getPropertyValue('--hf-shell-height')).toBe('874px');
    controller.stop();
    safeArea.mockRestore();
    Object.defineProperty(navigator, 'standalone', { value: false, configurable: true });
    Object.defineProperty(window.screen, 'height', { value: 0, configurable: true });
  });

  it('bridges a non-interactive app-header tap to the active internal scroll view', () => {
    installViewport();
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    const viewport = document.createElement('div');
    viewport.dataset.hfViewport = '';
    const header = document.createElement('header');
    header.dataset.hfHeader = '';
    header.append(document.createElement('span'));
    const scroller = document.createElement('div');
    scroller.dataset.hfScrollView = '';
    scroller.scrollTop = 360;
    viewport.append(header, scroller);
    document.body.append(viewport);
    const controller = new ViewportController({ settleDelaysMs: [] });
    controller.start();

    header.firstElementChild?.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      clientY: 70,
    }));

    expect(scroller.scrollTop).toBe(0);
    controller.stop();
    Object.defineProperty(navigator, 'standalone', { value: false, configurable: true });
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

  it('focuses a completed touch pointer tap once without waiting for a compatibility click', () => {
    installViewport();
    const controller = new ViewportController();
    controller.start();
    const input = document.createElement('input');
    input.style.fontSize = '16px';
    const focus = vi.spyOn(input, 'focus');
    document.body.append(input);
    const pointerDown = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerType: 'touch',
    });
    input.dispatchEvent(pointerDown);
    expect(pointerDown.defaultPrevented).toBe(true);
    expect(focus).not.toHaveBeenCalled();
    input.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      pointerId: pointerDown.pointerId,
      pointerType: 'touch',
    }));
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(input);
    controller.stop();
  });

  it('raises the dock only for a keyboard session owned by a dock field', async () => {
    const viewport = installViewport();
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    const controller = new ViewportController({ settleDelaysMs: [1, 2] });
    const shell = document.createElement('div');
    shell.dataset.hfShell = '';
    const scroller = document.createElement('div');
    scroller.dataset.hfScrollView = '';
    const pageInput = document.createElement('input');
    pageInput.style.fontSize = '16px';
    scroller.append(pageInput);
    const dock = document.createElement('div');
    dock.dataset.hfDock = '';
    const dockInput = document.createElement('input');
    dockInput.style.fontSize = '16px';
    dock.append(dockInput);
    shell.append(scroller, dock);
    document.body.append(shell);
    controller.start();

    dockInput.focus();
    viewport.height = 500;
    viewport.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(document.documentElement.dataset.hfKeyboardTarget).toBe('dock');
    expect(document.documentElement.style.getPropertyValue('--hf-dock-keyboard-offset')).toBe('344px');

    pageInput.focus();
    expect(document.documentElement.dataset.hfKeyboardTarget).toBe('content');
    expect(document.documentElement.style.getPropertyValue('--hf-dock-keyboard-offset')).toBe('0px');

    pageInput.blur();
    viewport.height = 844;
    viewport.pageTop = 60;
    viewport.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(document.documentElement.dataset.hfKeyboardTarget).toBe('none');
    expect(document.documentElement.style.getPropertyValue('--hf-layout-viewport-top')).toBe('0px');
    controller.stop();
    Object.defineProperty(navigator, 'standalone', { value: false, configurable: true });
  });

  it('treats a bottom viewport attachment as a keyboard-aware dock target', async () => {
    const viewport = installViewport();
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    const controller = new ViewportController({ settleDelaysMs: [1, 2] });
    const attachment = document.createElement('div');
    attachment.dataset.hfViewportAttachment = '';
    attachment.dataset.hfAttachmentAnchor = 'dock';
    const input = document.createElement('input');
    input.style.fontSize = '16px';
    attachment.append(input);
    document.body.append(attachment);
    controller.start();

    input.focus();
    viewport.height = 500;
    viewport.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(document.documentElement.dataset.hfKeyboardTarget).toBe('dock');
    expect(document.documentElement.style.getPropertyValue('--hf-dock-keyboard-offset')).toBe('344px');

    controller.stop();
    Object.defineProperty(navigator, 'standalone', { value: false, configurable: true });
  });

  it('keeps a Safari browser shell stable while a dock attachment follows the keyboard', async () => {
    const viewport = installViewport();
    Object.defineProperty(navigator, 'standalone', { value: false, configurable: true });
    const controller = new ViewportController({ settleDelaysMs: [1, 2] });
    const shell = document.createElement('div');
    shell.dataset.hfShell = '';
    shell.dataset.hfBottomKeyboardPolicy = 'manual';
    const dock = document.createElement('div');
    dock.dataset.hfDock = '';
    dock.dataset.keyboardPolicy = 'manual';
    const attachment = document.createElement('div');
    attachment.dataset.hfViewportAttachment = '';
    attachment.dataset.hfAttachmentAnchor = 'dock';
    attachment.dataset.keyboardPolicy = 'avoid';
    const input = document.createElement('input');
    input.style.fontSize = '16px';
    attachment.append(input);
    shell.append(attachment, dock);
    document.body.append(shell);
    controller.start();

    expect(document.documentElement.style.getPropertyValue('--hf-shell-height')).toBe('844px');
    input.focus();
    viewport.height = 500;
    viewport.dispatchEvent(new Event('resize'));
    await vi.waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--hf-dock-keyboard-offset')).toBe('344px');
    });

    expect(controller.getSnapshot()).toMatchObject({
      displayMode: 'browser',
      height: 500,
      stableHeight: 844,
      keyboard: { height: 344 },
    });
    expect(document.documentElement.style.getPropertyValue('--hf-shell-height')).toBe('844px');
    controller.stop();
  });

  it('tracks intermediate keyboard geometry directly instead of applying a second easing curve', async () => {
    const viewport = installViewport();
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    const safeArea = mockSafeAreaBottom(34);
    const controller = new ViewportController({ settleDelaysMs: [1, 2] });
    const dock = document.createElement('div');
    dock.dataset.hfDock = '';
    const input = document.createElement('input');
    input.style.fontSize = '16px';
    dock.append(input);
    document.body.append(dock);
    controller.start();
    input.focus();
    expect(document.activeElement).toBe(input);
    expect(document.documentElement.dataset.hfKeyboardTarget).toBe('dock');

    viewport.height = 820;
    viewport.dispatchEvent(new Event('resize'));
    await vi.waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--hf-dock-keyboard-offset')).toBe('24px');
    });
    expect(document.documentElement.style.getPropertyValue('--hf-effective-safe-bottom')).toBe('10px');
    expect(document.documentElement.dataset.hfKeyboardMotion).toBe('tracking');

    viewport.height = 780;
    viewport.dispatchEvent(new Event('resize'));
    await vi.waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--hf-dock-keyboard-offset')).toBe('64px');
    });
    expect(document.documentElement.style.getPropertyValue('--hf-effective-safe-bottom')).toBe('0px');
    expect(document.documentElement.dataset.hfKeyboardMotion).toBe('tracking');
    controller.stop();
    safeArea.mockRestore();
    Object.defineProperty(navigator, 'standalone', { value: false, configurable: true });
  });

  it('treats skipped opening and closing frames as native geometry without fallback easing', async () => {
    const viewport = installViewport();
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    const controller = new ViewportController({ settleDelaysMs: [1, 2] });
    const attachment = document.createElement('div');
    attachment.dataset.hfViewportAttachment = '';
    attachment.dataset.hfAttachmentAnchor = 'dock';
    const input = document.createElement('input');
    input.style.fontSize = '16px';
    attachment.append(input);
    document.body.append(attachment);
    controller.start();

    input.focus();
    viewport.height = 500;
    viewport.dispatchEvent(new Event('resize'));
    await vi.waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--hf-dock-keyboard-offset')).toBe('344px');
    });
    expect(document.documentElement.dataset.hfKeyboardMotion).toBe('tracking');

    input.blur();
    viewport.height = 844;
    viewport.dispatchEvent(new Event('resize'));
    await vi.waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--hf-dock-keyboard-offset')).toBe('0px');
    });
    expect(controller.getSnapshot().keyboard.phase).toBe('closed');
    expect(document.documentElement.dataset.hfKeyboardMotion).toBe('tracking');
    controller.stop();
    Object.defineProperty(navigator, 'standalone', { value: false, configurable: true });
  });

  it('does not overwrite the pre-focus scroll anchor after WebKit moves the scroller', async () => {
    installViewport();
    const controller = new ViewportController({
      settleDelaysMs: [],
      keyboardStabilizationMs: 50,
    });
    const shell = document.createElement('div');
    shell.dataset.hfShell = '';
    const scroller = document.createElement('div');
    scroller.dataset.hfScrollView = '';
    scroller.scrollTop = 120;
    const input = document.createElement('input');
    input.style.fontSize = '16px';
    scroller.append(input);
    shell.append(scroller);
    document.body.append(shell);
    input.addEventListener('focus', () => {
      // Mirrors the synchronous focus reveal observed in installed iOS PWAs.
      scroller.scrollTop = 400;
    });
    controller.start();

    input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(scroller.scrollTop).toBe(120);
    controller.stop();
  });

  it('does not reclaim an open-keyboard scroller after the user starts dragging', async () => {
    const viewport = installViewport();
    const controller = new ViewportController({
      settleDelaysMs: [],
      keyboardStabilizationMs: 50,
    });
    const shell = document.createElement('div');
    shell.dataset.hfShell = '';
    const scroller = document.createElement('div');
    scroller.dataset.hfScrollView = '';
    const pageContent = document.createElement('div');
    scroller.append(pageContent);
    const dock = document.createElement('div');
    dock.dataset.hfDock = '';
    const input = document.createElement('input');
    input.style.fontSize = '16px';
    dock.append(input);
    shell.append(scroller, dock);
    document.body.append(shell);
    controller.start();

    input.focus();
    viewport.height = 500;
    viewport.dispatchEvent(new Event('resize'));
    await vi.waitFor(() => {
      expect(controller.getSnapshot().keyboard.phase).toBe('open');
    });

    pageContent.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      pointerType: 'touch',
    }));
    scroller.scrollTop = 240;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    // iOS emits these while the same native drag is still in progress. They
    // must update geometry without restarting anchor correction.
    viewport.dispatchEvent(new Event('scroll'));
    viewport.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(scroller.scrollTop).toBe(240);
    expect(document.documentElement.dataset.hfKeyboard).toBe('open');
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
