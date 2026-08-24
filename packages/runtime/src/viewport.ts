import { emitRuntimeEvent } from './events.js';
import { getHomeframeRootStyle } from './style-store.js';

export type KeyboardPhase = 'closed' | 'opening' | 'open' | 'closing';
export type DisplayMode =
  | 'standalone'
  | 'fullscreen'
  | 'minimal-ui'
  | 'browser'
  | 'unknown';

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface HomeframeViewportSnapshot {
  width: number;
  height: number;
  x: number;
  y: number;
  /** Layout-viewport pan that iOS may apply independently of offsetTop. */
  pageTop: number;
  stableWidth: number;
  stableHeight: number;
  scale: number;
  orientation: 'portrait' | 'landscape';
  safeArea: SafeAreaInsets;
  keyboard: {
    phase: KeyboardPhase;
    height: number;
    source: 'virtual-keyboard' | 'visual-viewport' | 'none';
  };
  displayMode: DisplayMode;
  revision: number;
}

export interface ViewportRuntimeOptions {
  keyboardThresholdPx?: number;
  keyboardThresholdRatio?: number;
  inputZoomMinimumPx?: number;
  strictInputZoom?: boolean;
  settleDelaysMs?: number[];
  /** Hold the document and internal scroller steady after viewport activity. */
  keyboardStabilizationMs?: number;
  /** Scroll the active AppScrollView to top when app-owned header chrome is tapped. */
  topTapToTop?: boolean;
}

interface VirtualKeyboardLike extends EventTarget {
  boundingRect?: DOMRectReadOnly;
  overlaysContent?: boolean;
}

interface NavigatorWithVirtualKeyboard extends Navigator {
  virtualKeyboard?: VirtualKeyboardLike;
  standalone?: boolean;
}

interface EditableScrollDrag {
  identifier: number;
  startX: number;
  startY: number;
  startScrollTop: number;
  scroller: HTMLElement | null;
  editable: HTMLElement;
  dragging: boolean;
}

const defaultViewport: HomeframeViewportSnapshot = {
  width: 0,
  height: 0,
  x: 0,
  y: 0,
  pageTop: 0,
  stableWidth: 0,
  stableHeight: 0,
  scale: 1,
  orientation: 'portrait',
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  keyboard: { phase: 'closed', height: 0, source: 'none' },
  displayMode: 'unknown',
  revision: 0,
};

const editableSelector =
  'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable]:not([contenteditable="false"])';

export function isEditableElement(value: EventTarget | null): value is HTMLElement {
  return value instanceof HTMLElement && value.matches(editableSelector);
}

function needsKeyboardFocusGuard(value: EventTarget | null): value is HTMLElement {
  if (!isEditableElement(value) || value instanceof HTMLSelectElement) return false;
  return !(value instanceof HTMLInputElement)
    || !['date', 'datetime-local', 'month', 'time', 'week', 'color', 'file', 'range'].includes(value.type);
}

export function detectDisplayMode(): DisplayMode {
  if (typeof window === 'undefined') return 'unknown';
  for (const mode of ['fullscreen', 'standalone', 'minimal-ui'] as const) {
    if (window.matchMedia(`(display-mode: ${mode})`).matches) return mode;
  }
  if ((navigator as NavigatorWithVirtualKeyboard).standalone === true) return 'standalone';
  return 'browser';
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function bounded(value: number, fallback: number, maximum: number): number {
  return Number.isFinite(value) && value >= 0 && value <= maximum ? value : fallback;
}

function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.5;
}

export class ViewportController {
  private options: Required<ViewportRuntimeOptions>;
  private snapshot: HomeframeViewportSnapshot = defaultViewport;
  private listeners = new Set<() => void>();
  private abortController: AbortController | null = null;
  private safeAreaProbe: HTMLDivElement | null = null;
  private frameRequest = 0;
  private settleTimers = new Set<number>();
  private stableSamples = 0;
  private lastCandidate: Omit<HomeframeViewportSnapshot, 'revision'> | null = null;
  private focusedEditable: HTMLElement | null = null;
  private editableScrollDrag: EditableScrollDrag | null = null;
  private keyboardAnchor: { scroller: HTMLElement; scrollTop: number } | null = null;
  private keyboardCorrectionFrame = 0;
  private keyboardCorrectionTimer = 0;
  private keyboardSettling = false;
  private userOwnsKeyboardScroll = false;
  private correctingKeyboardScroll = false;
  /** Native points exposed by an edge-to-edge standalone scene but omitted
   * from WebKit's closed visual/layout viewport. */
  private installedFrameInset = 0;

  constructor(options: ViewportRuntimeOptions = {}) {
    this.options = {
      keyboardThresholdPx: options.keyboardThresholdPx ?? 120,
      keyboardThresholdRatio: options.keyboardThresholdRatio ?? 0.18,
      inputZoomMinimumPx: options.inputZoomMinimumPx ?? 16,
      strictInputZoom: options.strictInputZoom ?? false,
      settleDelaysMs: options.settleDelaysMs ?? [50, 150, 320],
      keyboardStabilizationMs: options.keyboardStabilizationMs ?? 220,
      topTapToTop: options.topTapToTop ?? true,
    };
  }

  getSnapshot = (): HomeframeViewportSnapshot => this.snapshot;

  getServerSnapshot = (): HomeframeViewportSnapshot => defaultViewport;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(): () => void {
    if (typeof window === 'undefined') return () => undefined;
    if (this.abortController) return () => this.stop();

    this.abortController = new AbortController();
    const { signal } = this.abortController;
    this.createSafeAreaProbe();

    const schedule = () => this.scheduleMeasure();
    const scheduleKeyboardViewportChange = () => {
      this.scheduleMeasure();
      if (this.focusedEditable || this.snapshot.keyboard.phase !== 'closed') {
        this.beginKeyboardSettlement();
      }
    };
    window.addEventListener('resize', schedule, { signal });
    window.addEventListener('orientationchange', () => this.invalidateStableSize(), {
      signal,
    });
    window.addEventListener('pageshow', () => this.scheduleSettle(), { signal });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.suspendKeyboard();
      this.scheduleSettle();
    }, { signal });
    window.addEventListener('pagehide', () => this.suspendKeyboard(), { signal });
    window.addEventListener('scroll', () => {
      if (window.scrollY !== 0 && (window.visualViewport?.scale ?? 1) <= 1.01) {
        window.scrollTo(0, 0);
      }
      schedule();
    }, { signal, passive: true });

    window.visualViewport?.addEventListener('resize', scheduleKeyboardViewportChange, { signal });
    window.visualViewport?.addEventListener('scroll', scheduleKeyboardViewportChange, { signal });

    const virtualKeyboard = (navigator as NavigatorWithVirtualKeyboard).virtualKeyboard;
    virtualKeyboard?.addEventListener('geometrychange', schedule, { signal });

    // WebKit starts its implicit input-focus work before `click`, which is too
    // late to prevent the standalone layout viewport from panning. Claim the
    // initial touch now; touchend below focuses only completed taps, so a drag
    // beginning on a field still scrolls instead of opening the keyboard.
    document.addEventListener('pointerdown', (event) => {
      if (!needsKeyboardFocusGuard(event.target)
        || document.activeElement === event.target
        || (event.pointerType !== 'touch' && event.pointerType !== 'pen')) return;
      this.captureKeyboardAnchor(event.target);
      this.beginKeyboardSettlement();
      event.preventDefault();
    }, { signal, capture: true, passive: false });

    // Once an inactive editable's native touch action is claimed, explicitly
    // transfer vertical movement to the application scroller. This applies to
    // route fields and dock fields alike and preserves the tap-versus-scroll
    // distinction while suppressing WebKit's automatic focus pan.
    document.addEventListener('touchstart', (event) => {
      if (!needsKeyboardFocusGuard(event.target)
        || document.activeElement === event.target
        || event.touches.length !== 1) return;
      const scroller = this.primaryScroller(event.target);
      const touch = event.touches[0];
      if (!touch) return;
      event.preventDefault();
      this.captureKeyboardAnchor(event.target);
      this.beginKeyboardSettlement();
      this.editableScrollDrag = {
        identifier: touch.identifier,
        startX: touch.clientX,
        startY: touch.clientY,
        startScrollTop: scroller?.scrollTop ?? 0,
        scroller,
        editable: event.target,
        dragging: false,
      };
    }, { signal, capture: true, passive: false });

    document.addEventListener('touchmove', (event) => {
      const drag = this.editableScrollDrag;
      if (!drag) return;
      const touch = [...event.touches].find(candidate => candidate.identifier === drag.identifier);
      if (!touch) return;
      const deltaX = touch.clientX - drag.startX;
      const deltaY = touch.clientY - drag.startY;
      if (!drag.dragging) {
        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 8) {
          this.editableScrollDrag = null;
          return;
        }
        if (Math.abs(deltaY) <= 8) return;
        drag.dragging = true;
        this.userOwnsKeyboardScroll = true;
        this.keyboardSettling = false;
        this.stopKeyboardCorrection();
      }
      event.preventDefault();
      if (drag.scroller) {
        drag.scroller.scrollTop = drag.startScrollTop - deltaY;
        drag.scroller.dispatchEvent(new Event('scroll'));
      }
    }, { signal, capture: true, passive: false });

    const finishEditableScrollDrag = (event: TouchEvent) => {
      const drag = this.editableScrollDrag;
      this.editableScrollDrag = null;
      if (!drag || drag.dragging || event.type === 'touchcancel'
        || !drag.editable.isConnected) return;
      this.captureKeyboardAnchor(drag.editable);
      this.beginKeyboardSettlement();
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      drag.editable.focus({ preventScroll: true });
      if (drag.editable instanceof HTMLInputElement
        && ['text', 'search', 'tel', 'url', 'password'].includes(drag.editable.type)) {
        const end = drag.editable.value.length;
        drag.editable.setSelectionRange(end, end);
      } else if (drag.editable instanceof HTMLTextAreaElement) {
        const end = drag.editable.value.length;
        drag.editable.setSelectionRange(end, end);
      }
      if (window.scrollX !== scrollX || window.scrollY !== scrollY) {
        window.scrollTo(scrollX, scrollY);
      }
    };
    document.addEventListener('touchend', finishEditableScrollDrag, { signal, capture: true });
    document.addEventListener('touchcancel', finishEditableScrollDrag, { signal, capture: true });

    // A click is emitted for an intentional tap but suppressed after a scroll
    // gesture. Focusing here (before WebKit's default click action) prevents
    // its layout-viewport pan without making fields grab focus on touch-down.
    document.addEventListener('click', (event) => {
      if (!isEditableElement(event.target) || document.activeElement === event.target) return;
      this.captureKeyboardAnchor(event.target);
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      event.target.focus({ preventScroll: true });
      if (window.scrollX !== scrollX || window.scrollY !== scrollY) {
        window.scrollTo(scrollX, scrollY);
      }
    }, { signal, capture: true });

    document.addEventListener('focusin', (event) => {
      if (!isEditableElement(event.target)) return;
      this.focusedEditable = event.target;
      // A pointer/click guard captures the pre-focus position. WebKit may move
      // the internal scroller synchronously during focus even with
      // `preventScroll`; never replace that good anchor with the moved value.
      // Programmatic focus still gets an anchor through this fallback.
      if (!this.keyboardAnchor) this.captureKeyboardAnchor(event.target);
      this.beginKeyboardSettlement();
      this.auditFocusedElement(event.target);
      this.scheduleSettle();
    }, { signal });

    document.addEventListener('focusout', () => {
      queueMicrotask(() => {
        this.focusedEditable = isEditableElement(document.activeElement)
          ? document.activeElement
          : null;
        this.beginKeyboardSettlement();
        this.scheduleSettle();
      });
    }, { signal });

    const takeKeyboardScrollControl = (event: Event) => {
      // The opening touch is still owned by the focus guard above. A real drag
      // transfers ownership in touchmove; releasing a tap focuses manually.
      if ((event.type === 'pointerdown' || event.type === 'touchstart')
        && needsKeyboardFocusGuard(event.target)
        && document.activeElement !== event.target
        && this.snapshot.keyboard.phase === 'closed') return;
      if (!this.keyboardSettling && this.snapshot.keyboard.phase === 'closed') return;
      this.userOwnsKeyboardScroll = true;
      this.keyboardSettling = false;
      this.rememberKeyboardScroll();
      this.stopKeyboardCorrection();
    };
    document.addEventListener('pointerdown', takeKeyboardScrollControl, {
      signal,
      capture: true,
      passive: true,
    });
    document.addEventListener('touchstart', takeKeyboardScrollControl, {
      signal,
      capture: true,
      passive: true,
    });
    document.addEventListener('wheel', takeKeyboardScrollControl, {
      signal,
      capture: true,
      passive: true,
    });
    document.addEventListener('scroll', () => {
      if (this.correctingKeyboardScroll || (this.keyboardSettling && !this.userOwnsKeyboardScroll)) return;
      this.rememberKeyboardScroll();
    }, { signal, capture: true, passive: true });

    document.addEventListener('click', (event) => {
      if (!this.options.topTapToTop || !this.isIosStandalone() || this.focusedEditable
        || !(event.target instanceof Element)) return;
      if (!event.target.closest('[data-hf-header]')) return;
      if (event.target.closest(
        'a, button, input, textarea, select, [contenteditable]:not([contenteditable="false"])',
      )) return;
      this.scrollPrimaryViewToTop();
    }, { signal, capture: true });

    for (const mode of ['standalone', 'fullscreen', 'minimal-ui'] as const) {
      window.matchMedia(`(display-mode: ${mode})`).addEventListener('change', () => {
        this.invalidateStableSize();
      }, { signal });
    }

    this.measure(true);
    this.scheduleSettle();
    return () => this.stop();
  }

  stop(): void {
    this.abortController?.abort();
    this.abortController = null;
    if (this.frameRequest) cancelAnimationFrame(this.frameRequest);
    this.frameRequest = 0;
    for (const timer of this.settleTimers) window.clearTimeout(timer);
    this.settleTimers.clear();
    this.safeAreaProbe?.remove();
    this.safeAreaProbe = null;
    this.editableScrollDrag = null;
    this.stopKeyboardCorrection();
    this.keyboardAnchor = null;
    this.keyboardSettling = false;
    this.userOwnsKeyboardScroll = false;
    this.installedFrameInset = 0;
  }

  scheduleSettle(): void {
    this.scheduleMeasure();
    for (const delay of this.options.settleDelaysMs) {
      const timer = window.setTimeout(() => {
        this.settleTimers.delete(timer);
        this.scheduleMeasure();
      }, delay);
      this.settleTimers.add(timer);
    }
  }

  private scheduleMeasure(): void {
    if (this.frameRequest) return;
    this.frameRequest = requestAnimationFrame(() => {
      this.frameRequest = 0;
      this.measure(false);
    });
  }

  private invalidateStableSize(): void {
    this.snapshot = { ...this.snapshot, stableHeight: 0, stableWidth: 0 };
    this.installedFrameInset = 0;
    this.stableSamples = 0;
    this.lastCandidate = null;
    this.scheduleSettle();
  }

  private suspendKeyboard(): void {
    this.focusedEditable?.blur();
    this.focusedEditable = null;
    this.stopKeyboardCorrection();
    this.keyboardSettling = false;
    this.userOwnsKeyboardScroll = false;
    this.keyboardAnchor = null;
    if (this.snapshot.keyboard.phase === 'closed') return;
    this.snapshot = {
      ...this.snapshot,
      keyboard: { phase: 'closed', height: 0, source: 'none' },
      revision: this.snapshot.revision + 1,
    };
    this.writeCss(this.snapshot);
    for (const listener of this.listeners) listener();
    emitRuntimeEvent('viewport-change', this.snapshot);
  }

  private createSafeAreaProbe(): void {
    const probe = document.createElement('div');
    probe.dataset.hfSafeAreaProbe = '';
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = [
      'position:fixed',
      'inset:0',
      'visibility:hidden',
      'pointer-events:none',
      'padding-top:env(safe-area-inset-top,0px)',
      'padding-right:env(safe-area-inset-right,0px)',
      'padding-bottom:env(safe-area-inset-bottom,0px)',
      'padding-left:env(safe-area-inset-left,0px)',
    ].join(';');
    document.documentElement.append(probe);
    this.safeAreaProbe = probe;
  }

  private readSafeArea(): SafeAreaInsets {
    if (!this.safeAreaProbe) return { top: 0, right: 0, bottom: 0, left: 0 };
    const styles = getComputedStyle(this.safeAreaProbe);
    return {
      top: finite(Number.parseFloat(styles.paddingTop), 0),
      right: finite(Number.parseFloat(styles.paddingRight), 0),
      bottom: finite(Number.parseFloat(styles.paddingBottom), 0),
      left: finite(Number.parseFloat(styles.paddingLeft), 0),
    };
  }

  private readVirtualKeyboardHeight(): number {
    const rect = (navigator as NavigatorWithVirtualKeyboard).virtualKeyboard?.boundingRect;
    return finite(rect?.height ?? 0, 0);
  }

  private isIosStandalone(): boolean {
    return (navigator as NavigatorWithVirtualKeyboard).standalone === true;
  }

  private layoutViewportHeight(layoutHeight: number): number {
    return Math.max(layoutHeight, finite(window.innerHeight, layoutHeight));
  }

  private detectInstalledFrameInset(layoutHeight: number, safeAreaTop: number): number {
    /*
     * `screen.height` includes native UI that may sit outside the standalone
     * WebView. With an opaque iOS status bar, for example, a 874pt screen owns
     * an 812pt layout viewport. Using the screen height makes the shell 62px
     * too tall, pushes its dock offscreen, and prevents keyboard close
     * detection from ever matching the restored visual viewport.
     *
     * A `black-translucent` Home Screen app has the inverse WebKit quirk on
     * current iOS: the app surface begins at physical y=0, but the closed
     * layout viewport can remain shorter than the scene by exactly the top
     * safe-area inset. Only that measured equality authorizes use of the
     * larger screen height. This adapts to every iPhone safe area without
     * treating an opaque native status bar as app-owned space.
     */
    if (!this.isIosStandalone() || safeAreaTop <= 0) return 0;
    const layoutFrameHeight = this.layoutViewportHeight(layoutHeight);
    const screenHeight = finite(window.screen.height, layoutFrameHeight);
    const missingHeight = screenHeight - layoutFrameHeight;
    const tolerance = Math.max(1, safeAreaTop * 0.08);
    return missingHeight > 0
      && Math.abs(missingHeight - safeAreaTop) <= tolerance
      ? missingHeight
      : 0;
  }

  private readPageTop(layoutHeight?: number): number {
    if (!this.isIosStandalone()) return 0;
    const maximum = Math.max(1, layoutHeight ?? this.snapshot.stableHeight ?? window.innerHeight);
    return bounded(window.visualViewport?.pageTop ?? 0, 0, maximum);
  }

  private primaryScroller(element: HTMLElement): HTMLElement | null {
    const direct = element.closest<HTMLElement>('[data-hf-scroll-view]');
    if (direct) return direct;
    return element.closest<HTMLElement>('[data-hf-shell]')
      ?.querySelector<HTMLElement>('[data-hf-scroll-view]') ?? null;
  }

  private captureKeyboardAnchor(element: HTMLElement): void {
    const scroller = this.primaryScroller(element);
    if (!scroller) return;
    this.keyboardAnchor = { scroller, scrollTop: scroller.scrollTop };
  }

  private rememberKeyboardScroll(): void {
    if (!this.keyboardAnchor) return;
    this.keyboardAnchor.scrollTop = this.keyboardAnchor.scroller.scrollTop;
  }

  private beginKeyboardSettlement(): void {
    if (!this.keyboardAnchor && this.focusedEditable) {
      this.captureKeyboardAnchor(this.focusedEditable);
    }
    this.keyboardSettling = true;
    this.userOwnsKeyboardScroll = false;
    if (this.keyboardCorrectionTimer) window.clearTimeout(this.keyboardCorrectionTimer);
    this.keyboardCorrectionTimer = window.setTimeout(() => {
      this.keyboardCorrectionTimer = 0;
      this.keyboardSettling = false;
      if (this.keyboardCorrectionFrame) cancelAnimationFrame(this.keyboardCorrectionFrame);
      this.keyboardCorrectionFrame = 0;
      if (!this.focusedEditable && this.snapshot.keyboard.phase === 'closed') {
        this.keyboardAnchor = null;
      }
    }, this.options.keyboardStabilizationMs);
    if (!this.keyboardCorrectionFrame) {
      this.keyboardCorrectionFrame = requestAnimationFrame(() => this.correctKeyboardPan());
    }
  }

  private correctKeyboardPan(): void {
    this.keyboardCorrectionFrame = 0;
    if (!this.keyboardSettling) return;
    if (!this.userOwnsKeyboardScroll && this.keyboardAnchor) {
      this.correctingKeyboardScroll = true;
      this.keyboardAnchor.scroller.scrollTop = this.keyboardAnchor.scrollTop;
      this.correctingKeyboardScroll = false;
    }
    if ((window.visualViewport?.scale ?? 1) <= 1.01) window.scrollTo(0, 0);
    getHomeframeRootStyle().setProperty('--hf-layout-viewport-top', `${this.readPageTop()}px`);
    this.keyboardCorrectionFrame = requestAnimationFrame(() => this.correctKeyboardPan());
  }

  private stopKeyboardCorrection(): void {
    if (this.keyboardCorrectionFrame) cancelAnimationFrame(this.keyboardCorrectionFrame);
    if (this.keyboardCorrectionTimer) window.clearTimeout(this.keyboardCorrectionTimer);
    this.keyboardCorrectionFrame = 0;
    this.keyboardCorrectionTimer = 0;
  }

  private activeScrollView(): HTMLElement | null {
    return document.querySelector<HTMLElement>(
      '[data-hf-viewport]:not([data-hf-edge-preview-content]) [data-hf-scroll-view]',
    ) ?? document.querySelector<HTMLElement>('[data-hf-scroll-view]');
  }

  private scrollPrimaryViewToTop(): void {
    const scroller = this.activeScrollView();
    if (!scroller || scroller.scrollTop <= 0) return;
    if (typeof scroller.scrollTo === 'function') {
      scroller.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      scroller.scrollTop = 0;
    }
    emitRuntimeEvent('scroll-to-top', { source: 'app-header' });
  }

  private measure(force: boolean): void {
    const visual = window.visualViewport;
    const layoutWidth = document.documentElement.clientWidth || window.innerWidth;
    const layoutHeight = document.documentElement.clientHeight || window.innerHeight;
    const previousWidth = this.snapshot.width || layoutWidth;
    const previousHeight = this.snapshot.height || layoutHeight;
    const width = bounded(visual?.width ?? layoutWidth, previousWidth, Math.max(1, layoutWidth * 2));
    const height = bounded(visual?.height ?? layoutHeight, previousHeight, Math.max(1, layoutHeight * 2));
    const x = bounded(visual?.offsetLeft ?? 0, this.snapshot.x, Math.max(1, layoutWidth));
    const y = bounded(visual?.offsetTop ?? 0, this.snapshot.y, Math.max(1, layoutHeight));
    const pageTop = this.readPageTop(layoutHeight);
    const scale = bounded(visual?.scale ?? 1, this.snapshot.scale || 1, 10) || 1;
    // Keyboard shrinkage can make the visual viewport wider than it is tall in
    // portrait. Orientation belongs to the stable layout viewport, not that
    // transient visible rectangle.
    const orientation = layoutWidth > layoutHeight ? 'landscape' as const : 'portrait' as const;
    const displayMode = detectDisplayMode();
    const rawSafeArea = this.readSafeArea();

    let stableWidth = this.snapshot.stableWidth;
    let stableHeight = this.snapshot.stableHeight;
    const viewportIdentityChanged = this.snapshot.revision > 0
      && (orientation !== this.snapshot.orientation || displayMode !== this.snapshot.displayMode);
    if (viewportIdentityChanged) {
      stableWidth = 0;
      stableHeight = 0;
      this.stableSamples = 0;
      this.lastCandidate = null;
      this.installedFrameInset = 0;
    }
    this.installedFrameInset = Math.max(
      this.installedFrameInset,
      this.detectInstalledFrameInset(layoutHeight, rawSafeArea.top),
    );
    const physicalFrameHeight = this.layoutViewportHeight(layoutHeight)
      + this.installedFrameInset;
    if (!stableWidth || !stableHeight) {
      stableWidth = Math.max(layoutWidth, width);
      stableHeight = Math.max(physicalFrameHeight, height + y);
    }

    const virtualKeyboardHeight = Math.min(this.readVirtualKeyboardHeight(), stableHeight);
    const closedVisualBottom = Math.max(1, stableHeight - this.installedFrameInset);
    const visualKeyboardHeight = Math.max(0, stableHeight - (height + y));
    const visualKeyboardReduction = Math.max(0, closedVisualBottom - (height + y));
    const threshold = Math.min(
      this.options.keyboardThresholdPx,
      stableHeight * this.options.keyboardThresholdRatio,
    );
    const previousOpen = this.snapshot.keyboard.phase === 'open'
      || this.snapshot.keyboard.phase === 'opening';
    const previousActive = this.snapshot.keyboard.phase !== 'closed';
    const meaningfulVisualReduction = visualKeyboardReduction >= threshold && scale <= 1.01;
    const inferredOpen = Boolean(this.focusedEditable)
      && meaningfulVisualReduction;
    // After blur, WebKit can retain the old visual viewport for several frames.
    // Keep publishing that geometry as `closing` so an avoid dock follows the
    // keyboard instead of falling to the physical bottom prematurely.
    const inferredClosing = !this.focusedEditable
      && previousActive
      && meaningfulVisualReduction;
    const hasVirtualKeyboard = virtualKeyboardHeight > 0
      && (Boolean(this.focusedEditable) || previousActive);
    const keyboardHeight = hasVirtualKeyboard
      ? virtualKeyboardHeight
      : inferredOpen || inferredClosing ? visualKeyboardHeight : 0;
    const keyboardSource = hasVirtualKeyboard
      ? 'virtual-keyboard' as const
      : inferredOpen || inferredClosing ? 'visual-viewport' as const : 'none' as const;

    let keyboardPhase: KeyboardPhase;
    if (keyboardHeight > 0) {
      if (!this.focusedEditable) keyboardPhase = 'closing';
      else keyboardPhase = previousOpen && closeEnough(keyboardHeight, this.snapshot.keyboard.height)
          ? 'open'
          : 'opening';
    } else {
      keyboardPhase = previousOpen || this.snapshot.keyboard.phase === 'closing'
        ? 'closing'
        : 'closed';
      if (keyboardPhase === 'closing' && closeEnough(height + y, closedVisualBottom)) {
        keyboardPhase = 'closed';
      }
    }

    if (keyboardPhase === 'closed' && scale <= 1.01) {
      stableWidth = Math.max(width + x, layoutWidth);
      stableHeight = Math.max(height + y + this.installedFrameInset, physicalFrameHeight);
    }

    const candidate = {
      width,
      height,
      x,
      y,
      pageTop,
      stableWidth,
      stableHeight,
      scale,
      orientation,
      safeArea: {
        top: Math.min(rawSafeArea.top, stableHeight / 2),
        right: Math.min(rawSafeArea.right, stableWidth / 2),
        bottom: Math.min(rawSafeArea.bottom, stableHeight / 2),
        left: Math.min(rawSafeArea.left, stableWidth / 2),
      },
      keyboard: {
        phase: keyboardPhase,
        height: keyboardHeight,
        source: keyboardSource,
      },
      displayMode,
    };

    if (this.lastCandidate
      && closeEnough(this.lastCandidate.width, candidate.width)
      && closeEnough(this.lastCandidate.height, candidate.height)
      && closeEnough(this.lastCandidate.y, candidate.y)
      && closeEnough(this.lastCandidate.pageTop, candidate.pageTop)
      && closeEnough(this.lastCandidate.keyboard.height, candidate.keyboard.height)) {
      this.stableSamples += 1;
    } else {
      this.stableSamples = 0;
    }
    this.lastCandidate = candidate;

    if (keyboardPhase === 'opening' && this.stableSamples >= 1) {
      candidate.keyboard.phase = 'open';
    } else if (keyboardPhase === 'closing'
      && keyboardHeight === 0
      && closeEnough(height + y, stableHeight - this.installedFrameInset)
      && this.stableSamples >= 1) {
      candidate.keyboard.phase = 'closed';
    }

    const serializedPrevious = JSON.stringify({ ...this.snapshot, revision: 0 });
    const serializedNext = JSON.stringify({ ...candidate, revision: 0 });
    if (!force && serializedPrevious === serializedNext) return;

    this.snapshot = { ...candidate, revision: this.snapshot.revision + 1 };
    this.writeCss(this.snapshot);
    for (const listener of this.listeners) listener();
    emitRuntimeEvent('viewport-change', this.snapshot);
  }

  private writeCss(snapshot: HomeframeViewportSnapshot): void {
    const root = document.documentElement;
    const style = getHomeframeRootStyle();
    const px = (value: number) => `${Math.max(0, value)}px`;
    style.setProperty('--hf-viewport-width', px(snapshot.width));
    style.setProperty('--hf-viewport-height', px(snapshot.height));
    style.setProperty('--hf-viewport-x', px(snapshot.x));
    style.setProperty('--hf-viewport-y', px(snapshot.y));
    style.setProperty('--hf-layout-viewport-top', px(this.isIosStandalone() ? snapshot.pageTop : 0));
    const visualRight = snapshot.x + snapshot.width;
    const visualBottom = snapshot.y + snapshot.height;
    // Installed apps keep one immutable shell rectangle for their entire
    // lifetime. Only ViewportDock tracks keyboard height; resizing the shell
    // itself makes WebKit composite transient copies of the header during the
    // keyboard animation.
    const useStableInstalledGeometry = snapshot.displayMode !== 'browser'
      && snapshot.displayMode !== 'unknown';
    style.setProperty(
      '--hf-shell-width',
      px(useStableInstalledGeometry ? Math.max(snapshot.stableWidth, visualRight) : visualRight),
    );
    style.setProperty(
      '--hf-shell-height',
      px(useStableInstalledGeometry ? Math.max(snapshot.stableHeight, visualBottom) : visualBottom),
    );
    style.setProperty('--hf-stable-width', px(snapshot.stableWidth));
    style.setProperty('--hf-stable-height', px(snapshot.stableHeight));
    style.setProperty('--hf-safe-top', px(snapshot.safeArea.top));
    style.setProperty('--hf-safe-right', px(snapshot.safeArea.right));
    style.setProperty('--hf-safe-bottom', px(snapshot.safeArea.bottom));
    style.setProperty('--hf-safe-left', px(snapshot.safeArea.left));
    style.setProperty(
      '--hf-effective-safe-bottom',
      snapshot.keyboard.phase === 'closed' ? px(snapshot.safeArea.bottom) : '0px',
    );
    style.setProperty('--hf-keyboard-height', px(snapshot.keyboard.height));
    style.setProperty(
      '--hf-input-min-font-size',
      px(this.options.inputZoomMinimumPx / Math.min(Math.max(snapshot.scale, 0.1), 1)),
    );
    style.setProperty(
      '--hf-keyboard-open',
      snapshot.keyboard.phase === 'closed' ? '0' : '1',
    );
    root.dataset.hfKeyboard = snapshot.keyboard.phase;
    root.dataset.hfDisplayMode = snapshot.displayMode;
    root.dataset.hfOrientation = snapshot.orientation;
    root.dataset.hfIosStandalone = this.isIosStandalone() ? 'true' : 'false';
  }

  private auditFocusedElement(element: HTMLElement): void {
    const computedSize = Number.parseFloat(getComputedStyle(element).fontSize);
    const effectiveMinimum = this.options.inputZoomMinimumPx
      / Math.min(Math.max(this.snapshot.scale, 0.1), 1);
    if (computedSize >= effectiveMinimum) return;
    const detail = {
      element,
      computedSize,
      minimumSize: effectiveMinimum,
      selector: describeElement(element),
    };
    emitRuntimeEvent('input-zoom-risk', detail);
    const message = `[Homeframe HF_INPUT_ZOOM] ${detail.selector} has ${computedSize}px focused text; `
      + `use at least ${effectiveMinimum.toFixed(2)}px at the current viewport scale to prevent iOS focus zoom.`;
    if (this.options.strictInputZoom) throw new Error(message);
    console.error(message, element);
  }
}

function describeElement(element: HTMLElement): string {
  const id = element.id ? `#${CSS.escape(element.id)}` : '';
  const classes = [...element.classList].slice(0, 3).map((name) => `.${CSS.escape(name)}`).join('');
  return `${element.tagName.toLowerCase()}${id}${classes}`;
}

let defaultController: ViewportController | null = null;

export function getViewportController(options?: ViewportRuntimeOptions): ViewportController {
  defaultController ??= new ViewportController(options);
  return defaultController;
}
