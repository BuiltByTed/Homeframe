import type { ReactNode } from 'react';
import { emitRuntimeEvent, getBuildInfo, getHomeframeRootStyle } from '@builtbyted/runtime';

export type NavigationDirection = 'back' | 'forward' | 'replace' | 'push' | 'reload' | 'unknown';
export type RouteScrollAction = 'reset' | 'restore' | 'preserve';

export type PermalinkViewInput = string | number | boolean;
export type PermalinkViewValue = string | readonly string[];

export type PermalinkScrollTarget =
  | { readonly type: 'position'; readonly top: number }
  | { readonly type: 'anchor'; readonly anchor: string; readonly offset: number };

export type PermalinkScrollInput =
  | 'current'
  | number
  | { top: number }
  | { anchor: string; offset?: number }
  | null;

export interface CreatePermalinkOptions {
  /** Defaults to the current route, query, and fragment. */
  to?: string | URL;
  /** URL query-state patch. `null` deletes a key; arrays create repeated keys. */
  view?: Record<
    string,
    PermalinkViewInput | readonly PermalinkViewInput[] | null | undefined
  >;
  /** Omit to preserve the destination's scroll target; `null` clears it. */
  scroll?: PermalinkScrollInput;
  /** Absolute URLs are share-ready. Set false for an in-app href. */
  absolute?: boolean;
}

export interface PermalinkSnapshot {
  readonly view: Readonly<Record<string, PermalinkViewValue>>;
  readonly scroll: PermalinkScrollTarget | null;
}

export interface NavigationGestureSnapshot {
  readonly phase: 'idle' | 'tracking' | 'committing' | 'cancelling';
  readonly direction: 'back' | 'forward' | null;
  /** Normalized against the commit distance and clamped to 0…1. */
  readonly progress: number;
  readonly delta: number;
  readonly commitDistance: number;
  readonly canCommit: boolean;
  readonly revision: number;
}

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
  permalink: PermalinkSnapshot;
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
  pendingOffset: number;
  frameRequest: number | null;
  claimed: boolean;
  targetPosition: number;
  live: HTMLElement;
  preview: HTMLElement;
  previewContent: HTMLElement;
  indicator: HTMLElement | null;
  originalLiveTransform: string;
  originalPreviewTransform: string;
  originalIndicatorOpacity: string;
  originalIndicatorTransform: string;
}

const PERMALINK_SCROLL_PARAMETER = '__hf_scroll';
const PERMALINK_OFFSET_PARAMETER = '__hf_offset';
const RESERVED_PERMALINK_PARAMETERS = new Set([
  PERMALINK_SCROLL_PARAMETER,
  PERMALINK_OFFSET_PARAMETER,
]);
const MAX_PERMALINK_SCROLL = 10_000_000;
const MAX_PERMALINK_OFFSET = 10_000;
const MAX_PERMALINK_ANCHOR_LENGTH = 512;
const MAX_ROUTE_CACHE_ENTRIES = 100;
const ROUTE_CACHE_MAX_AGE_MS = 60_000;
const PREFETCH_MAX_AGE_MS = 30_000;
const MAX_MANAGED_SNAPSHOTS = 6;

interface RouteCacheEntry {
  data: unknown;
  cachedAt: number;
  prefetched: boolean;
}

function boundedNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function parseFiniteParameter(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function decodeFragment(hash: string): string {
  if (!hash || hash === '#') return '';
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return hash.slice(1);
  }
}

/** Parses only durable URL state; `history.state` is deliberately not portable. */
export function parsePermalink(url: string | URL): PermalinkSnapshot {
  const parsed = url instanceof URL
    ? url
    : new URL(url, typeof location === 'undefined' ? 'http://homeframe.invalid/' : location.href);
  const view = Object.create(null) as Record<string, PermalinkViewValue>;
  for (const key of new Set(parsed.searchParams.keys())) {
    if (RESERVED_PERMALINK_PARAMETERS.has(key)) continue;
    const values = parsed.searchParams.getAll(key);
    view[key] = values.length > 1 ? Object.freeze(values) : values[0] ?? '';
  }

  const anchor = decodeFragment(parsed.hash).slice(0, MAX_PERMALINK_ANCHOR_LENGTH);
  const offset = parseFiniteParameter(parsed.searchParams.get(PERMALINK_OFFSET_PARAMETER));
  if (anchor) {
    return {
      view: Object.freeze(view),
      scroll: Object.freeze({
        type: 'anchor' as const,
        anchor,
        offset: boundedNumber(offset ?? 0, -MAX_PERMALINK_OFFSET, MAX_PERMALINK_OFFSET),
      }),
    };
  }

  const top = parseFiniteParameter(parsed.searchParams.get(PERMALINK_SCROLL_PARAMETER));
  return {
    view: Object.freeze(view),
    scroll: top === null
      ? null
      : Object.freeze({
          type: 'position' as const,
          top: boundedNumber(top, 0, MAX_PERMALINK_SCROLL),
        }),
  };
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
  private navigationGestureListeners = new Set<() => void>();
  private abortController: AbortController | null = null;
  private loaderAbort: AbortController | null = null;
  private navigationId = 0;
  private dataCache = new Map<string, RouteCacheEntry>();
  private cacheGeneration = 0;
  private prefetchControllers = new Map<string, AbortController>();
  private scope: string;
  private historyMode: 'auto' | 'browser' | 'managed';
  private managedHistory = false;
  private managedEntries: ManagedHistoryEntry[] = [];
  private managedPosition = 0;
  private captureSnapshotAllowed = true;
  private edgeNavigation: false | { edgeWidth: number; commitDistance: number };
  private edgeGesture: EdgeGesture | null = null;
  private edgeNavigationElement: HTMLElement | null = null;
  private snapshot: RouterSnapshot;
  private readonly serverSnapshot: RouterSnapshot;
  private navigationGesture: NavigationGestureSnapshot = {
    phase: 'idle',
    direction: null,
    progress: 0,
    delta: 0,
    commitDistance: 0,
    canCommit: false,
    revision: 0,
  };
  private readonly serverNavigationGesture: NavigationGestureSnapshot = this.navigationGesture;

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
      permalink: parsePermalink(url),
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
  getNavigationGestureSnapshot = (): NavigationGestureSnapshot => this.navigationGesture;
  getServerNavigationGestureSnapshot = (): NavigationGestureSnapshot => this.serverNavigationGesture;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  subscribeNavigationGesture = (listener: () => void): (() => void) => {
    this.navigationGestureListeners.add(listener);
    return () => this.navigationGestureListeners.delete(listener);
  };

  canHandle(to: string | URL): boolean {
    if (typeof window === 'undefined') return false;
    const url = new URL(to, window.location.href);
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && url.origin === window.location.origin
      && isWithinScope(url.pathname, this.scope);
  }

  /** Builds a cold-launch-safe URL for a route, query-backed view, and scroll target. */
  createPermalink(options: CreatePermalinkOptions = {}): string {
    const base = this.snapshot.url;
    const url = new URL(options.to ?? base, base);
    if (url.origin !== base.origin || !isWithinScope(url.pathname, this.scope)) {
      throw new TypeError('Homeframe permalinks must be same-origin URLs inside the router scope.');
    }

    for (const [key, value] of Object.entries(options.view ?? {})) {
      if (RESERVED_PERMALINK_PARAMETERS.has(key)) {
        throw new TypeError(`Homeframe reserves the permalink query parameter: ${key}`);
      }
      if (value === undefined) continue;
      url.searchParams.delete(key);
      if (value === null) continue;
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) url.searchParams.append(key, String(item));
    }

    if (options.scroll !== undefined) {
      url.searchParams.delete(PERMALINK_SCROLL_PARAMETER);
      url.searchParams.delete(PERMALINK_OFFSET_PARAMETER);
      url.hash = '';
      if (options.scroll !== null) {
        let scroll = options.scroll;
        if (scroll === 'current') {
          const scroller = typeof document === 'undefined'
            ? null
            : document.querySelector<HTMLElement>(
                '[data-hf-viewport]:not([data-hf-edge-preview-content]) [data-hf-scroll-view]',
              ) ?? document.querySelector<HTMLElement>('[data-hf-scroll-view]');
          scroll = { top: scroller?.scrollTop ?? 0 };
        } else if (typeof scroll === 'number') {
          scroll = { top: scroll };
        }
        if ('anchor' in scroll) {
          const anchor = scroll.anchor.trim();
          if (!anchor) throw new TypeError('A permalink scroll anchor cannot be empty.');
          url.hash = encodeURIComponent(anchor.slice(0, MAX_PERMALINK_ANCHOR_LENGTH));
          const offset = boundedNumber(
            Number.isFinite(scroll.offset) ? scroll.offset ?? 0 : 0,
            -MAX_PERMALINK_OFFSET,
            MAX_PERMALINK_OFFSET,
          );
          if (offset !== 0) url.searchParams.set(PERMALINK_OFFSET_PARAMETER, String(offset));
        } else {
          const top = boundedNumber(
            Number.isFinite(scroll.top) ? scroll.top : 0,
            0,
            MAX_PERMALINK_SCROLL,
          );
          url.searchParams.set(PERMALINK_SCROLL_PARAMETER, String(Math.round(top)));
        }
      }
    }

    return options.absolute === false
      ? `${url.pathname}${url.search}${url.hash}`
      : url.href;
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

    window.addEventListener('homeframe:logout', () => this.invalidate(), { signal });

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
    this.invalidate();
    this.resetEdgeGesture();
    this.edgeNavigationElement?.remove();
    this.edgeNavigationElement = null;
    this.managedEntries = [];
    this.managedPosition = 0;
    if (typeof document !== 'undefined') {
      delete document.documentElement.dataset.hfHistoryMode;
      delete document.documentElement.dataset.hfEdgeNavigation;
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
    const cached = this.cachedRoute(url.href);
    if (!match?.route.loader || (cached?.prefetched && Date.now() - cached.cachedAt < PREFETCH_MAX_AGE_MS)
      || this.prefetchControllers.has(url.href)) return;
    const controller = new AbortController();
    const generation = this.cacheGeneration;
    const navigationId = this.navigationId;
    this.prefetchControllers.set(url.href, controller);
    try {
      const data = await match.route.loader({
        url,
        params: match.params,
        signal: controller.signal,
        navigationType: 'unknown',
      });
      if (!controller.signal.aborted && generation === this.cacheGeneration && navigationId === this.navigationId) {
        this.cacheRoute(url.href, data, true);
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      if (this.prefetchControllers.get(url.href) === controller) this.prefetchControllers.delete(url.href);
    }
  }

  /** Clear retained data/scenes and cancel matching work before an identity change or navigation. */
  invalidate(to?: string | URL): void {
    const url = to === undefined ? null : new URL(to, this.snapshot.url).href;
    this.cacheGeneration += 1;
    for (const controller of this.prefetchControllers.values()) controller.abort();
    this.prefetchControllers.clear();
    if (url === null) this.dataCache.clear();
    else this.dataCache.delete(url);
    for (const entry of this.managedEntries) {
      if (url === null || entry.url.href === url) delete entry.snapshot;
    }
    this.resetEdgeGesture();
    if (url === null || url === this.snapshot.url.href) {
      this.captureSnapshotAllowed = false;
      this.navigationId += 1;
      this.loaderAbort?.abort();
      this.loaderAbort = null;
    }
  }

  /** Fetch the current route again while preserving its history entry and scroll. */
  async revalidate(): Promise<void> {
    const { url, key, index, state } = this.snapshot;
    this.invalidate(url);
    await this.resolve(url, key, index, 'reload', state, 'preserve');
  }

  private cachedRoute(url: string): RouteCacheEntry | undefined {
    const entry = this.dataCache.get(url);
    if (entry && Date.now() - entry.cachedAt < ROUTE_CACHE_MAX_AGE_MS) return entry;
    this.dataCache.delete(url);
    return undefined;
  }

  private cacheRoute(url: string, data: unknown, prefetched: boolean): void {
    this.dataCache.delete(url);
    this.dataCache.set(url, { data, cachedAt: Date.now(), prefetched });
    while (this.dataCache.size > MAX_ROUTE_CACHE_ENTRIES) {
      this.dataCache.delete(this.dataCache.keys().next().value!);
    }
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
    if (!this.managedHistory || !this.captureSnapshotAllowed || typeof document === 'undefined') return;
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
      // A detached clone has no scrollable layout, so assigning scrollTop here
      // is clamped to zero. Preserve the values as data and restore them after
      // the destination snapshot is attached for an edge preview.
      copy.dataset.hfSnapshotScrollTop = String(scrollView.scrollTop);
      copy.dataset.hfSnapshotScrollLeft = String(scrollView.scrollLeft);
    });
    entry.snapshot = clone;
    const retained = this.managedEntries
      .map((item, position) => ({ item, distance: Math.abs(position - this.managedPosition) }))
      .filter(({ item }) => item.snapshot)
      .sort((a, b) => a.distance - b.distance);
    for (const { item } of retained.slice(MAX_MANAGED_SNAPSHOTS)) delete item.snapshot;
  }

  private prepareEdgeGesture(
    direction: 'back' | 'forward',
    startX: number,
    startY: number,
    commitDistance: number,
  ): EdgeGesture | null {
    const targetPosition = direction === 'back'
      ? this.managedPosition - 1
      : this.managedPosition + 1;
    const target = this.managedEntries[targetPosition];
    if (!target || typeof document === 'undefined') return null;

    this.captureManagedSnapshot();
    // Evicted destinations still support gestures. Use the app canvas until
    // their route has mounted instead of retaining an unbounded DOM history.
    const snapshot = target.snapshot ?? document.createElement('div');
    if (!target.snapshot) {
      snapshot.dataset.hfViewport = '';
      snapshot.dataset.hfEdgePreviewContent = '';
      snapshot.setAttribute('aria-hidden', 'true');
      snapshot.inert = true;
    }
    const live = document.querySelector<HTMLElement>('[data-hf-viewport]:not([data-hf-edge-preview-content])');
    if (!snapshot || !live) return null;

    const preview = document.createElement('div');
    preview.dataset.hfEdgePreview = direction;
    preview.setAttribute('aria-hidden', 'true');
    preview.inert = true;
    // The destination is already a detached snapshot. Moving that node into
    // the preview avoids a second deep clone and the associated style/image
    // work at the start of every edge gesture.
    preview.append(snapshot);
    (document.body ?? document.documentElement).append(preview);
    for (const scrollView of snapshot.querySelectorAll<HTMLElement>('[data-hf-scroll-view]')) {
      scrollView.scrollTop = Number(scrollView.dataset.hfSnapshotScrollTop ?? 0);
      scrollView.scrollLeft = Number(scrollView.dataset.hfSnapshotScrollLeft ?? 0);
    }
    live.dataset.hfEdgeLive = '';

    const root = document.documentElement;
    root.dataset.hfEdgeNavigation = direction;
    const indicator = this.edgeNavigationElement?.querySelector<HTMLElement>('[data-hf-edge-indicator]') ?? null;
    const gesture: EdgeGesture = {
      direction,
      startX,
      startY,
      delta: 0,
      pendingOffset: 0,
      frameRequest: null,
      claimed: false,
      targetPosition,
      live,
      preview,
      previewContent: snapshot,
      indicator,
      originalLiveTransform: live.style.transform,
      originalPreviewTransform: snapshot.style.transform,
      originalIndicatorOpacity: indicator?.style.opacity ?? '',
      originalIndicatorTransform: indicator?.style.transform ?? '',
    };
    this.applyEdgeOffset(gesture, 0, commitDistance);
    this.publishNavigationGesture('tracking', gesture, commitDistance, 0);
    return gesture;
  }

  private applyEdgeOffset(gesture: EdgeGesture, offset: number, commitDistance: number): void {
    const width = Math.max(1, window.innerWidth);
    const clamped = Math.min(width, Math.max(0, offset));
    const progress = Math.min(1, clamped / commitDistance);
    let liveOffset: number;
    let previewOffset: number;
    if (gesture.direction === 'back') {
      liveOffset = clamped;
      previewOffset = -0.18 * (width - clamped);
    } else {
      liveOffset = clamped * -0.08;
      previewOffset = width - clamped;
    }
    gesture.live.style.transform = `translate3d(${liveOffset}px, 0, 0)`;
    gesture.previewContent.style.transform = `translate3d(${previewOffset}px, 0, 0)`;
    if (gesture.indicator) {
      gesture.indicator.style.opacity = String(progress);
      gesture.indicator.style.transform = `translate3d(0, -50%, 0) scale(${0.78 + progress * 0.22})`;
    }
  }

  private scheduleEdgeOffset(gesture: EdgeGesture, offset: number, commitDistance: number): void {
    gesture.pendingOffset = offset;
    if (gesture.frameRequest !== null) return;
    gesture.frameRequest = window.requestAnimationFrame(() => {
      gesture.frameRequest = null;
      if (this.edgeGesture !== gesture) return;
      this.applyEdgeOffset(gesture, gesture.pendingOffset, commitDistance);
      this.publishNavigationGesture('tracking', gesture, commitDistance, gesture.pendingOffset);
    });
  }

  private cancelEdgeFrame(gesture: EdgeGesture): void {
    if (gesture.frameRequest === null) return;
    window.cancelAnimationFrame(gesture.frameRequest);
    gesture.frameRequest = null;
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

    this.cancelEdgeFrame(gesture);
    this.applyEdgeOffset(gesture, gesture.pendingOffset, commitDistance);
    this.publishNavigationGesture(
      shouldCommit ? 'committing' : 'cancelling',
      gesture,
      commitDistance,
      gesture.pendingOffset,
    );
    document.documentElement.dataset.hfEdgeSettling = shouldCommit ? 'commit' : 'cancel';
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    if (this.edgeGesture !== gesture) return;
    this.applyEdgeOffset(gesture, shouldCommit ? window.innerWidth : 0, commitDistance);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 190));

    if (this.edgeGesture !== gesture) return;
    if (shouldCommit) {
      await this.traverseManagedHistory(gesture.targetPosition, gesture.direction);
      // `resolve` publishes synchronously, but UI frameworks still need a paint
      // to mount the live destination. Keep the already-visible destination
      // snapshot in place through that handoff so decoded media/layout cannot
      // flash back to their initial state when the gesture completes.
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    }
    if (this.edgeGesture !== gesture) return;
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
      this.edgeGesture = this.prepareEdgeGesture(
        direction,
        touch.clientX,
        touch.clientY,
        edgeNavigation.commitDistance,
      );
    }, { capture: true, passive: true, signal });

    surface.addEventListener('touchmove', (event) => {
      const gesture = this.edgeGesture;
      const touch = event.touches[0];
      if (!gesture || !touch) return;
      const horizontal = touch.clientX - gesture.startX;
      const vertical = touch.clientY - gesture.startY;
      const directionalDelta = gesture.direction === 'back' ? horizontal : -horizontal;
      if (!gesture.claimed && Math.abs(vertical) > Math.max(10, directionalDelta)) {
        this.publishNavigationGesture(
          'cancelling',
          gesture,
          edgeNavigation.commitDistance,
          gesture.pendingOffset,
        );
        this.resetEdgeGesture();
        return;
      }
      if (directionalDelta <= 0) return;
      gesture.claimed = true;
      gesture.delta = directionalDelta;
      this.scheduleEdgeOffset(gesture, directionalDelta, edgeNavigation.commitDistance);
    }, { capture: true, passive: true, signal });

    const finish = (cancelled: boolean) => {
      const gesture = this.edgeGesture;
      if (!gesture) return;
      void this.finishEdgeGesture(cancelled, edgeNavigation.commitDistance);
    };
    surface.addEventListener('touchend', () => finish(false), {
      capture: true,
      passive: true,
      signal,
    });
    surface.addEventListener('touchcancel', () => finish(true), {
      capture: true,
      passive: true,
      signal,
    });
  }

  private resetEdgeGesture(): void {
    const gesture = this.edgeGesture;
    this.edgeGesture = null;
    if (typeof document === 'undefined') return;
    if (gesture) {
      this.cancelEdgeFrame(gesture);
      gesture.live.style.transform = gesture.originalLiveTransform;
      gesture.previewContent.style.transform = gesture.originalPreviewTransform;
      if (gesture.indicator) {
        gesture.indicator.style.opacity = gesture.originalIndicatorOpacity;
        gesture.indicator.style.transform = gesture.originalIndicatorTransform;
      }
      gesture.live.removeAttribute('data-hf-edge-live');
      gesture.preview.remove();
    }
    delete document.documentElement.dataset.hfEdgeNavigation;
    delete document.documentElement.dataset.hfEdgeSettling;
    this.publishNavigationGesture('idle', null, 0, 0);
  }

  private publishNavigationGesture(
    phase: NavigationGestureSnapshot['phase'],
    gesture: EdgeGesture | null,
    commitDistance: number,
    delta: number,
  ): void {
    if (phase === 'idle' && this.navigationGesture.phase === 'idle') return;
    const phaseChanged = phase !== this.navigationGesture.phase;
    const normalizedDelta = Math.max(0, delta);
    const next: NavigationGestureSnapshot = {
      phase,
      direction: gesture?.direction ?? null,
      progress: commitDistance > 0
        ? Math.min(1, normalizedDelta / commitDistance)
        : 0,
      delta: normalizedDelta,
      commitDistance,
      canCommit: phase !== 'idle' && commitDistance > 0 && normalizedDelta >= commitDistance,
      revision: this.navigationGesture.revision + 1,
    };
    this.navigationGesture = next;
    for (const listener of this.navigationGestureListeners) listener();
    // Progress belongs to the dedicated external store and may update every
    // frame. The shared telemetry/event stream receives phase boundaries only.
    if (phaseChanged) emitRuntimeEvent('navigation-gesture-change', next);
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
    const controller = new AbortController();
    this.loaderAbort = controller;
    const match = matchRoute(this.routes, url.pathname);
    if (!match) {
      this.publish({ url, state, key, index, direction, scroll, status: 'not-found', match: null, error: null });
      return;
    }
    const cached = this.cachedRoute(url.href);
    const traversal = direction === 'back' || direction === 'forward';
    const hasCached = Boolean(cached && (traversal
      || (cached.prefetched && Date.now() - cached.cachedAt < PREFETCH_MAX_AGE_MS)));
    if (hasCached && cached) {
      match.data = cached.data;
      cached.prefetched = false;
      this.dataCache.delete(url.href);
      this.dataCache.set(url.href, cached);
    }
    if (!match.route.loader || hasCached) {
      this.publish({ url, state, key, index, direction, scroll, status: 'idle', match, error: null });
      return;
    }
    this.publish({ url, state, key, index, direction, scroll, status: 'loading', match, error: null });
    try {
      const data = await match.route.loader({
        url,
        params: match.params,
        signal: controller.signal,
        navigationType: direction,
      });
      if (id !== this.navigationId || controller.signal.aborted) return;
      this.cacheRoute(url.href, data, false);
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
      if (id !== this.navigationId || controller.signal.aborted) return;
      this.publish({ url, state, key, index, direction, scroll, status: 'error', match, error });
    }
  }

  private publish(patch: Omit<Partial<RouterSnapshot>, 'revision'>): void {
    if (patch.status && patch.status !== 'loading') this.captureSnapshotAllowed = true;
    const nextUrl = patch.url ?? this.snapshot.url;
    const permalink = nextUrl.href === this.snapshot.url.href
      ? this.snapshot.permalink
      : parsePermalink(nextUrl);
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      permalink,
      revision: this.snapshot.revision + 1,
    };
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
