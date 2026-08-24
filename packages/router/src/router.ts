import type { ReactNode } from 'react';
import { emitRuntimeEvent, getBuildInfo, getHomeframeRootStyle } from '@homeframe/runtime';

export type NavigationDirection = 'back' | 'forward' | 'replace' | 'push' | 'reload' | 'unknown';
export type RouteScrollAction = 'reset' | 'restore' | 'preserve';

export interface RouteLoaderArgs {
  url: URL;
  params: Record<string, string>;
  signal: AbortSignal;
  navigationType: NavigationDirection;
}

export interface HomeframeRoute<T = unknown> {
  id: string;
  path: string;
  element: ReactNode | ((match: RouteMatch<T>) => ReactNode);
  loader?: (args: RouteLoaderArgs) => T | Promise<T>;
  pendingElement?: ReactNode;
  errorElement?: ReactNode | ((error: unknown) => ReactNode);
  nudgePolicy?: 'allow' | 'suppress';
}

export interface RouteMatch<T = unknown> {
  route: HomeframeRoute<T>;
  params: Record<string, string>;
  data: T | undefined;
}

export interface RouterSnapshot {
  url: URL;
  state: unknown;
  key: string;
  index: number;
  direction: NavigationDirection;
  scroll: RouteScrollAction;
  status: 'idle' | 'loading' | 'error' | 'not-found';
  match: RouteMatch | null;
  error: unknown;
  revision: number;
}

export interface NavigateOptions {
  replace?: boolean;
  state?: unknown;
  preventScrollReset?: boolean;
}

export interface HomeframeRouterOptions {
  scope?: string;
  /**
   * `auto` uses framework-managed history in installed iOS/iPadOS web apps.
   * WebKit's native same-document swipe can otherwise expose an OS-colored
   * fallback view when it cannot use a destination snapshot.
   */
  historyMode?: 'auto' | 'browser' | 'managed';
  edgeNavigation?: boolean | {
    edgeWidth?: number;
    commitDistance?: number;
  };
}

interface HomeframeHistoryState {
  version: 1;
  key: string;
  index: number;
  userState?: unknown;
}

interface MergedHistoryState {
  __homeframe?: HomeframeHistoryState;
  [key: string]: unknown;
}

interface ManagedHistoryEntry {
  url: URL;
  state: MergedHistoryState;
  entry: HomeframeHistoryState;
  snapshot?: HTMLElement;
}

interface EdgeGesture {
  direction: 'back' | 'forward';
  startX: number;
  startY: number;
  delta: number;
  claimed: boolean;
  targetPosition: number;
  live: HTMLElement;
  preview: HTMLElement;
}

function newKey(): string {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function currentUrl(): URL {
  return new URL(window.location.href);
}

function isInstalledIOSWebApp(): boolean {
  if (typeof navigator === 'undefined') return false;
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const iosDevice = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return standalone && iosDevice;
}

function isWithinScope(pathname: string, scope: string): boolean {
  const scopePath = scope.endsWith('/') ? scope : `${scope}/`;
  return pathname === scope || pathname.startsWith(scopePath);
}

function compilePath(path: string): { regex: RegExp; keys: string[] } {
  if (path === '*') return { regex: /^.*$/, keys: ['*'] };
  const keys: string[] = [];
  const parts = path.split('/').map((part) => {
    if (part === '*') {
      keys.push('*');
      return '(.*)';
    }
    if (part.startsWith(':')) {
      keys.push(part.slice(1));
      return '([^/]+)';
    }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return { regex: new RegExp(`^${parts.join('/')}/?$`), keys };
}

function matchRoute(routes: HomeframeRoute[], pathname: string): RouteMatch | null {
  for (const route of routes) {
    const { regex, keys } = compilePath(route.path);
    const result = regex.exec(pathname);
    if (!result) continue;
    const params: Record<string, string> = {};
    keys.forEach((key, index) => {
      const value = result[index + 1] ?? '';
      try {
        params[key] = decodeURIComponent(value);
      } catch {
        params[key] = value;
      }
    });
    return { route, params, data: undefined };
  }
  return null;
}

export class HomeframeRouter {
  private routes: HomeframeRoute[];
  private listeners = new Set<() => void>();
  private abortController: AbortController | null = null;
  private loaderAbort: AbortController | null = null;
  private navigationId = 0;
  private dataCache = new Map<string, unknown>();
  private scope: string;
  private historyMode: 'auto' | 'browser' | 'managed';
  private managedHistory = false;
  private managedEntries: ManagedHistoryEntry[] = [];
  private managedPosition = 0;
  private edgeNavigation: false | { edgeWidth: number; commitDistance: number };
  private edgeGesture: EdgeGesture | null = null;
  private edgeNavigationElement: HTMLElement | null = null;
  private snapshot: RouterSnapshot;
  private readonly serverSnapshot: RouterSnapshot;

  constructor(routes: HomeframeRoute[], options: HomeframeRouterOptions = {}) {
    this.routes = routes;
    const embeddedOptions = (getBuildInfo()?.routerConfig ?? {}) as HomeframeRouterOptions;
    const resolvedOptions = { ...embeddedOptions, ...options };
    this.scope = resolvedOptions.scope
      ?? getBuildInfo()?.serviceWorkerScope
      ?? '/';
    this.historyMode = resolvedOptions.historyMode ?? 'auto';
    this.edgeNavigation = resolvedOptions.edgeNavigation === false
      ? false
      : {
          edgeWidth: typeof resolvedOptions.edgeNavigation === 'object'
            ? resolvedOptions.edgeNavigation.edgeWidth ?? 24
            : 24,
          commitDistance: typeof resolvedOptions.edgeNavigation === 'object'
            ? resolvedOptions.edgeNavigation.commitDistance ?? 88
            : 88,
        };
    const url = typeof window === 'undefined' ? new URL('http://homeframe.invalid/') : currentUrl();
    this.snapshot = {
      url,
      state: undefined,
      key: 'server',
      index: 0,
      direction: 'reload',
      scroll: 'restore',
      status: 'loading',
      match: matchRoute(routes, url.pathname),
      error: null,
      revision: 0,
    };
    this.serverSnapshot = this.snapshot;
  }

  getSnapshot = (): RouterSnapshot => this.snapshot;
  getServerSnapshot = (): RouterSnapshot => this.serverSnapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  canHandle(to: string | URL): boolean {
    if (typeof window === 'undefined') return false;
    const url = new URL(to, window.location.href);
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && url.origin === window.location.origin
      && isWithinScope(url.pathname, this.scope);
  }

  start(): () => void {
    if (typeof window === 'undefined') return () => undefined;
    if (this.abortController) return () => this.stop();
    this.abortController = new AbortController();
    const { signal } = this.abortController;
    history.scrollRestoration = 'manual';
    this.managedHistory = this.historyMode === 'managed'
      || (this.historyMode === 'auto' && isInstalledIOSWebApp());

    const state = (history.state ?? {}) as MergedHistoryState;
    const existing = state.__homeframe;
    const entry: HomeframeHistoryState = existing?.version === 1
      ? existing
      : { version: 1, key: newKey(), index: 0, userState: state };
    if (!existing) history.replaceState({ ...state, __homeframe: entry }, '', window.location.href);
    const mergedState = (history.state ?? { ...state, __homeframe: entry }) as MergedHistoryState;
    if (this.managedHistory) {
      this.managedEntries = [{ url: currentUrl(), state: mergedState, entry }];
      this.managedPosition = 0;
      document.documentElement.dataset.hfHistoryMode = 'managed';
      this.installManagedEdgeNavigation(signal);
    } else {
      document.documentElement.dataset.hfHistoryMode = 'browser';
    }
    this.snapshot = {
      ...this.snapshot,
      url: currentUrl(),
      state: entry.userState,
      key: entry.key,
      index: entry.index,
      direction: 'reload',
      scroll: 'restore',
    };

    window.addEventListener('popstate', (event) => {
      const nextState = (event.state ?? {}) as MergedHistoryState;
      const next = nextState.__homeframe;
      const nextIndex = next?.index ?? this.snapshot.index;
      const direction: NavigationDirection = nextIndex < this.snapshot.index
        ? 'back'
        : nextIndex > this.snapshot.index ? 'forward' : 'unknown';
      if (this.managedHistory) {
        const fallbackEntry: HomeframeHistoryState = next?.version === 1
          ? next
          : { version: 1, key: newKey(), index: nextIndex, userState: nextState };
        this.managedEntries = [{ url: currentUrl(), state: nextState, entry: fallbackEntry }];
        this.managedPosition = 0;
      }
      void this.resolve(
        currentUrl(),
        next?.key ?? newKey(),
        nextIndex,
        direction,
        next?.userState,
        'restore',
      );
    }, { signal });

    window.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        const pageState = (history.state ?? {}) as MergedHistoryState;
        void this.resolve(
          currentUrl(),
          pageState.__homeframe?.key ?? this.snapshot.key,
          pageState.__homeframe?.index ?? this.snapshot.index,
          'reload',
          pageState.__homeframe?.userState,
          'restore',
        );
      }
    }, { signal });

    window.addEventListener('homeframe:notification-route', (event) => {
      const route = (event as CustomEvent<{ route: string }>).detail.route;
      void this.navigate(route);
    }, { signal });

    void this.resolve(
      this.snapshot.url,
      entry.key,
      entry.index,
      'reload',
      entry.userState,
      'restore',
    );
    return () => this.stop();
  }

  stop(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.loaderAbort?.abort();
    this.loaderAbort = null;
    this.resetEdgeGesture();
    this.edgeNavigationElement?.remove();
    this.edgeNavigationElement = null;
    this.managedEntries = [];
    this.managedPosition = 0;
    if (typeof document !== 'undefined') {
      delete document.documentElement.dataset.hfHistoryMode;
      delete document.documentElement.dataset.hfEdgeNavigation;
      getHomeframeRootStyle().removeProperty('--hf-edge-progress');
    }
  }

  async navigate(to: string | URL, options: NavigateOptions = {}): Promise<void> {
    const url = new URL(to, window.location.href);
    if (url.origin !== window.location.origin) {
      window.location.assign(url.href);
      return;
    }
    if (!isWithinScope(url.pathname, this.scope)) {
      window.location.assign(url.href);
      return;
    }
    const currentState = (history.state ?? {}) as MergedHistoryState;
    const currentIndex = currentState.__homeframe?.index ?? this.snapshot.index;
    const nextEntry: HomeframeHistoryState = {
      version: 1,
      key: options.replace ? this.snapshot.key : newKey(),
      index: options.replace ? currentIndex : currentIndex + 1,
      ...(options.state === undefined ? {} : { userState: options.state }),
    };
    const nextState = { ...currentState, __homeframe: nextEntry };
    if (this.managedHistory) {
      this.captureManagedSnapshot();
      history.replaceState(nextState, '', url);
      const managedEntry = { url, state: nextState, entry: nextEntry };
      if (options.replace) {
        this.managedEntries[this.managedPosition] = managedEntry;
      } else {
        this.managedEntries.splice(this.managedPosition + 1);
        this.managedEntries.push(managedEntry);
        this.managedPosition = this.managedEntries.length - 1;
      }
    } else if (options.replace) history.replaceState(nextState, '', url);
    else history.pushState(nextState, '', url);
    await this.resolve(
      url,
      nextEntry.key,
      nextEntry.index,
      options.replace ? 'replace' : 'push',
      nextEntry.userState,
      options.preventScrollReset ? 'preserve' : 'reset',
    );
  }

  async prefetch(to: string | URL): Promise<void> {
    const url = new URL(to, window.location.href);
    if (!this.canHandle(url)) return;
    const match = matchRoute(this.routes, url.pathname);
    if (!match?.route.loader || this.dataCache.has(url.href)) return;
    const controller = new AbortController();
    const data = await match.route.loader({
      url,
      params: match.params,
      signal: controller.signal,
      navigationType: 'unknown',
    });
    this.dataCache.set(url.href, data);
  }

  back(): void {
    if (this.managedHistory && this.managedPosition > 0) {
      void this.traverseManagedHistory(this.managedPosition - 1, 'back');
      return;
    }
    history.back();
  }

  forward(): void {
    if (this.managedHistory && this.managedPosition < this.managedEntries.length - 1) {
      void this.traverseManagedHistory(this.managedPosition + 1, 'forward');
      return;
    }
    history.forward();
  }

  private async traverseManagedHistory(
    position: number,
    direction: 'back' | 'forward',
  ): Promise<void> {
    const target = this.managedEntries[position];
    if (!target) return;
    if (typeof document !== 'undefined' && !document.querySelector('[data-hf-edge-live]')) {
      this.captureManagedSnapshot();
    }
    this.managedPosition = position;
    history.replaceState(target.state, '', target.url);
    await this.resolve(
      target.url,
      target.entry.key,
      target.entry.index,
      direction,
      target.entry.userState,
      'restore',
    );
  }

  private captureManagedSnapshot(): void {
    if (!this.managedHistory || typeof document === 'undefined') return;
    const entry = this.managedEntries[this.managedPosition];
    const live = document.querySelector<HTMLElement>('[data-hf-viewport]:not([data-hf-edge-preview-content])');
    if (!entry || !live) return;

    const clone = live.cloneNode(true) as HTMLElement;
    clone.removeAttribute('data-hf-edge-live');
    clone.dataset.hfEdgePreviewContent = '';
    clone.setAttribute('aria-hidden', 'true');
    clone.inert = true;

    const liveControls = live.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      'input, textarea, select',
    );
    const clonedControls = clone.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      'input, textarea, select',
    );
    liveControls.forEach((control, index) => {
      const copy = clonedControls[index];
      if (!copy) return;
      copy.value = control.value;
      if (control instanceof HTMLInputElement && copy instanceof HTMLInputElement) {
        copy.checked = control.checked;
      }
      if (control instanceof HTMLSelectElement && copy instanceof HTMLSelectElement) {
        copy.selectedIndex = control.selectedIndex;
      }
    });

    const liveScrollViews = live.querySelectorAll<HTMLElement>('[data-hf-scroll-view]');
    const clonedScrollViews = clone.querySelectorAll<HTMLElement>('[data-hf-scroll-view]');
    liveScrollViews.forEach((scrollView, index) => {
      const copy = clonedScrollViews[index];
      if (!copy) return;
      copy.scrollTop = scrollView.scrollTop;
      copy.scrollLeft = scrollView.scrollLeft;
    });
    entry.snapshot = clone;
  }

  private prepareEdgeGesture(
    direction: 'back' | 'forward',
    startX: number,
    startY: number,
  ): EdgeGesture | null {
    const targetPosition = direction === 'back'
      ? this.managedPosition - 1
      : this.managedPosition + 1;
    const target = this.managedEntries[targetPosition];
    if (!target || typeof document === 'undefined') return null;

    this.captureManagedSnapshot();
    const snapshot = target.snapshot;
    const live = document.querySelector<HTMLElement>('[data-hf-viewport]:not([data-hf-edge-preview-content])');
    if (!snapshot || !live) return null;

    const preview = document.createElement('div');
    preview.dataset.hfEdgePreview = direction;
    preview.setAttribute('aria-hidden', 'true');
    preview.inert = true;
    preview.append(snapshot.cloneNode(true));
    (document.body ?? document.documentElement).append(preview);
    live.dataset.hfEdgeLive = '';

    const root = document.documentElement;
    root.dataset.hfEdgeNavigation = direction;
    const style = getHomeframeRootStyle();
    style.setProperty('--hf-edge-progress', '0');
    style.setProperty('--hf-edge-live-offset', '0px');
    style.setProperty(
      '--hf-edge-preview-offset',
      direction === 'back' ? `${window.innerWidth * -0.18}px` : `${window.innerWidth}px`,
    );

    return {
      direction,
      startX,
      startY,
      delta: 0,
      claimed: false,
      targetPosition,
      live,
      preview,
    };
  }

  private setEdgeOffset(gesture: EdgeGesture, offset: number, commitDistance: number): void {
    const width = Math.max(1, window.innerWidth);
    const clamped = Math.min(width, Math.max(0, offset));
    const style = getHomeframeRootStyle();
    style.setProperty('--hf-edge-progress', String(Math.min(1, clamped / commitDistance)));
    if (gesture.direction === 'back') {
      style.setProperty('--hf-edge-live-offset', `${clamped}px`);
      style.setProperty('--hf-edge-preview-offset', `${-0.18 * (width - clamped)}px`);
    } else {
      style.setProperty('--hf-edge-live-offset', `${clamped * -0.08}px`);
      style.setProperty('--hf-edge-preview-offset', `${width - clamped}px`);
    }
  }

  private async finishEdgeGesture(cancelled: boolean, commitDistance: number): Promise<void> {
    const gesture = this.edgeGesture;
    if (!gesture) return;
    const canCommit = gesture.direction === 'back'
      ? gesture.targetPosition >= 0
      : gesture.targetPosition < this.managedEntries.length;
    const shouldCommit = !cancelled
      && gesture.claimed
      && gesture.delta >= commitDistance
      && canCommit;

    document.documentElement.dataset.hfEdgeSettling = shouldCommit ? 'commit' : 'cancel';
    this.setEdgeOffset(gesture, shouldCommit ? window.innerWidth : 0, commitDistance);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 190));

    if (this.edgeGesture !== gesture) return;
    if (shouldCommit) {
      await this.traverseManagedHistory(gesture.targetPosition, gesture.direction);
    }
    this.resetEdgeGesture();
  }

  private installManagedEdgeNavigation(signal: AbortSignal): void {
    const edgeNavigation = this.edgeNavigation;
    if (!edgeNavigation || typeof document === 'undefined') return;
    const surface = document.createElement('div');
    surface.dataset.hfEdgeNavigationSurface = '';
    surface.setAttribute('aria-hidden', 'true');
    surface.innerHTML = '<i data-hf-edge-guard="back"></i><i data-hf-edge-guard="forward"></i><b data-hf-edge-indicator></b>';
    getHomeframeRootStyle().setProperty('--hf-edge-width', `${edgeNavigation.edgeWidth}px`);
    (document.body ?? document.documentElement).append(surface);
    this.edgeNavigationElement = surface;

    surface.addEventListener('touchstart', (event) => {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (!touch) return;
      const guard = (event.target as Element | null)?.closest<HTMLElement>('[data-hf-edge-guard]');
      const direction = guard?.dataset.hfEdgeGuard;
      if (direction !== 'back' && direction !== 'forward') return;
      if (this.edgeGesture) return;
      this.edgeGesture = this.prepareEdgeGesture(direction, touch.clientX, touch.clientY);
    }, { capture: true, passive: true, signal });

    surface.addEventListener('touchmove', (event) => {
      const gesture = this.edgeGesture;
      const touch = event.touches[0];
      if (!gesture || !touch) return;
      const horizontal = touch.clientX - gesture.startX;
      const vertical = touch.clientY - gesture.startY;
      const directionalDelta = gesture.direction === 'back' ? horizontal : -horizontal;
      if (!gesture.claimed && Math.abs(vertical) > Math.max(10, directionalDelta)) {
        this.resetEdgeGesture();
        return;
      }
      if (directionalDelta <= 0) return;
      gesture.claimed = true;
      gesture.delta = directionalDelta;
      event.preventDefault();
      this.setEdgeOffset(gesture, directionalDelta, edgeNavigation.commitDistance);
    }, { capture: true, passive: false, signal });

    const finish = (event: TouchEvent, cancelled: boolean) => {
      const gesture = this.edgeGesture;
      if (!gesture) return;
      if (gesture.claimed) event.preventDefault();
      void this.finishEdgeGesture(cancelled, edgeNavigation.commitDistance);
    };
    surface.addEventListener('touchend', (event) => finish(event, false), {
      capture: true,
      passive: false,
      signal,
    });
    surface.addEventListener('touchcancel', (event) => finish(event, true), {
      capture: true,
      passive: false,
      signal,
    });
  }

  private resetEdgeGesture(): void {
    const gesture = this.edgeGesture;
    this.edgeGesture = null;
    if (typeof document === 'undefined') return;
    gesture?.live.removeAttribute('data-hf-edge-live');
    gesture?.preview.remove();
    delete document.documentElement.dataset.hfEdgeNavigation;
    delete document.documentElement.dataset.hfEdgeSettling;
    const style = getHomeframeRootStyle();
    style.removeProperty('--hf-edge-progress');
    style.removeProperty('--hf-edge-live-offset');
    style.removeProperty('--hf-edge-preview-offset');
  }

  private async resolve(
    url: URL,
    key: string,
    index: number,
    direction: NavigationDirection,
    state: unknown,
    scroll: RouteScrollAction,
  ): Promise<void> {
    const id = ++this.navigationId;
    this.loaderAbort?.abort();
    this.loaderAbort = new AbortController();
    const match = matchRoute(this.routes, url.pathname);
    if (!match) {
      this.publish({ url, state, key, index, direction, scroll, status: 'not-found', match: null, error: null });
      return;
    }
    const cached = this.dataCache.get(url.href);
    const hasCached = this.dataCache.has(url.href);
    if (hasCached) match.data = cached;
    if (!match.route.loader || hasCached) {
      this.publish({ url, state, key, index, direction, scroll, status: 'idle', match, error: null });
      return;
    }
    this.publish({ url, state, key, index, direction, scroll, status: 'loading', match, error: null });
    try {
      const data = await match.route.loader({
        url,
        params: match.params,
        signal: this.loaderAbort.signal,
        navigationType: direction,
      });
      if (id !== this.navigationId) return;
      this.dataCache.set(url.href, data);
      this.publish({
        url,
        state,
        key,
        index,
        direction,
        scroll,
        status: 'idle',
        match: { ...match, data },
        error: null,
      });
    } catch (error) {
      if (id !== this.navigationId || this.loaderAbort.signal.aborted) return;
      this.publish({ url, state, key, index, direction, scroll, status: 'error', match, error });
    }
  }

  private publish(patch: Omit<Partial<RouterSnapshot>, 'revision'>): void {
    this.snapshot = { ...this.snapshot, ...patch, revision: this.snapshot.revision + 1 };
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.hfNudges = this.snapshot.match?.route.nudgePolicy ?? 'allow';
      document.documentElement.dataset.hfRouterReady = this.snapshot.status === 'loading'
        ? 'false'
        : 'true';
    }
    for (const listener of this.listeners) listener();
    if (typeof window !== 'undefined') {
      emitRuntimeEvent('route-change', this.snapshot);
      if (this.snapshot.status === 'error' || this.snapshot.status === 'not-found') {
        emitRuntimeEvent('route-recovery', {
          pathname: this.snapshot.url.pathname,
          status: this.snapshot.status,
          routeId: this.snapshot.match?.route.id ?? null,
        });
      }
      if (this.snapshot.status !== 'loading') {
        window.dispatchEvent(new Event('homeframe:router-ready'));
      }
    }
  }
}

export function createHomeframeRouter(
  routes: HomeframeRoute[],
  options: HomeframeRouterOptions = {},
): HomeframeRouter {
  if (routes.length === 0) throw new Error('Homeframe router requires at least one route.');
  const ids = new Set<string>();
  for (const route of routes) {
    if (ids.has(route.id)) throw new Error(`Duplicate Homeframe route id: ${route.id}`);
    ids.add(route.id);
  }
  return new HomeframeRouter(routes, options);
}
