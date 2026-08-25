import {
  createContext,
  createElement,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ElementType,
  type HTMLAttributes,
  type MutableRefObject,
  type ReactNode,
  type Ref,
  type UIEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { getHomeframeRootStyle } from '@builtbyted/runtime';
import { useHomeframe } from './context.js';

type PolymorphicProps<T extends ElementType> = {
  as?: T;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'children'>;

export function AppViewport<T extends ElementType = 'div'>({
  as,
  children,
  ...props
}: PolymorphicProps<T>) {
  const { config } = useHomeframe();
  return createElement(as ?? 'div', {
    ...props,
    'data-hf-viewport': '',
    'data-hf-selection': config.selection,
  }, children, createElement('div', { 'data-hf-portals': '', key: 'homeframe-portals' }));
}

export interface AppShellProps extends HTMLAttributes<HTMLDivElement> {
  as?: ElementType;
  contentAs?: ElementType;
  header?: ReactNode;
  /** Viewport-attached content below the measured header; route content scrolls behind it. */
  headerAttachment?: ReactNode;
  bottom?: ReactNode;
  /** Viewport-attached content above the measured bottom dock; route content scrolls behind it. */
  bottomAttachment?: ReactNode;
  /** Keyboard behavior for the bottom attachment. */
  bottomAttachmentKeyboard?: DockKeyboardPolicy;
  headerSafeArea?: boolean;
  bottomKeyboard?: DockKeyboardPolicy;
  /** Controls whether the bottom dock reserves a shell row or overlays content. */
  bottomPlacement?: DockPlacement;
  /** Enables the responsive desktop grid when provided. */
  sidebar?: ReactNode;
  /** Pinned action/account region at the bottom of the desktop sidebar. */
  sidebarFooter?: ReactNode;
  sidebarLabel?: string;
  sidebarMode?: AppSidebarMode;
  defaultSidebarMode?: AppSidebarMode;
  onSidebarModeChange?: (mode: AppSidebarMode) => void;
  /** Optional localStorage key for an uncontrolled sidebar mode. */
  sidebarStorageKey?: string;
  headerPlacement?: AppHeaderPlacement;
  /** Replaces the default menu button shown when the sidebar is fully hidden. */
  sidebarReveal?: ReactNode;
}

export type AppSidebarMode = 'expanded' | 'rail' | 'hidden';
export type AppHeaderPlacement = 'sidebar' | 'content' | 'full';

export interface AppSidebarController {
  mode: AppSidebarMode;
  setMode(mode: AppSidebarMode): void;
  cycleMode(): void;
}

const AppSidebarContext = createContext<AppSidebarController | null>(null);

export function useAppSidebar(): AppSidebarController {
  return useContext(AppSidebarContext) ?? {
    mode: 'hidden',
    setMode: () => undefined,
    cycleMode: () => undefined,
  };
}

export function AppSidebarLabel<T extends ElementType = 'span'>({
  as,
  ...props
}: PolymorphicProps<T>) {
  return createElement(as ?? 'span', { ...props, 'data-hf-sidebar-label': '' });
}

function readStoredSidebarMode(
  storageKey: string | undefined,
  fallback: AppSidebarMode,
): AppSidebarMode {
  if (!storageKey || typeof window === 'undefined') return fallback;
  try {
    const stored = localStorage.getItem(storageKey);
    return stored === 'expanded' || stored === 'rail' || stored === 'hidden'
      ? stored
      : fallback;
  } catch {
    return fallback;
  }
}

export function AppShell({
  as = 'div',
  contentAs = 'main',
  header,
  headerAttachment,
  bottom,
  bottomAttachment,
  bottomAttachmentKeyboard = 'avoid',
  headerSafeArea = true,
  bottomKeyboard,
  bottomPlacement = 'flow',
  sidebar,
  sidebarFooter,
  sidebarLabel = 'Primary navigation',
  sidebarMode,
  defaultSidebarMode = 'expanded',
  onSidebarModeChange,
  sidebarStorageKey,
  headerPlacement = 'full',
  sidebarReveal,
  children,
  ...props
}: AppShellProps) {
  const { config } = useHomeframe();
  const dockPolicy = bottomKeyboard ?? config.bottomDock ?? 'avoid';
  const [uncontrolledMode, setUncontrolledMode] = useState(() =>
    readStoredSidebarMode(sidebarStorageKey, defaultSidebarMode));
  const mode = sidebarMode ?? uncontrolledMode;
  const setMode = useCallback((next: AppSidebarMode) => {
    if (sidebarMode === undefined) setUncontrolledMode(next);
    if (sidebarStorageKey) {
      try { localStorage.setItem(sidebarStorageKey, next); }
      catch { /* Storage is optional; the live state remains usable. */ }
    }
    onSidebarModeChange?.(next);
  }, [onSidebarModeChange, sidebarMode, sidebarStorageKey]);
  const sidebarController = useMemo<AppSidebarController>(() => ({
    mode,
    setMode,
    cycleMode: () => setMode(mode === 'expanded' ? 'rail' : mode === 'rail' ? 'hidden' : 'expanded'),
  }), [mode, setMode]);
  const desktopLayout = sidebar != null;
  const shell = createElement(
    as,
    {
      ...props,
      'data-hf-shell': '',
      'data-hf-desktop-layout': desktopLayout || undefined,
      'data-hf-sidebar-mode': desktopLayout ? mode : undefined,
      'data-hf-header-placement': desktopLayout ? headerPlacement : undefined,
      'data-hf-has-dock': bottom == null ? 'false' : 'true',
      'data-hf-bottom-keyboard-policy': bottom == null ? undefined : dockPolicy,
    },
    header == null && !desktopLayout
      ? <div />
      : <AppHeader safeArea={headerSafeArea}>{header}</AppHeader>,
    headerAttachment == null
      ? null
      : <ViewportAttachment anchor="header">{headerAttachment}</ViewportAttachment>,
    desktopLayout ? (
      <aside
        data-hf-sidebar=""
        aria-label={sidebarLabel}
        aria-hidden={mode === 'hidden' || undefined}
        inert={mode === 'hidden' || undefined}
      >
        <div data-hf-sidebar-content="">{sidebar}</div>
        {sidebarFooter == null ? null : <div data-hf-sidebar-footer="">{sidebarFooter}</div>}
      </aside>
    ) : null,
    createElement(contentAs, { 'data-hf-content': '' }, children),
    bottomAttachment == null
      ? null
      : <ViewportAttachment anchor="dock" keyboard={bottomAttachmentKeyboard}>
          {bottomAttachment}
        </ViewportAttachment>,
    bottom == null
      ? desktopLayout ? null : <div />
      : <ViewportDock keyboard={dockPolicy} placement={bottomPlacement}>{bottom}</ViewportDock>,
    desktopLayout && mode === 'hidden'
      ? <div data-hf-sidebar-reveal="">{sidebarReveal ?? (
          <button type="button" onClick={() => setMode('expanded')} aria-label="Show navigation">☰</button>
        )}</div>
      : null,
  );
  return <AppSidebarContext.Provider value={sidebarController}>{shell}</AppSidebarContext.Provider>;
}

function useMeasuredCssVariable(variable: string): MutableRefObject<HTMLElement | null> {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => getHomeframeRootStyle().setProperty(variable, `${element.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      observer.disconnect();
      getHomeframeRootStyle().setProperty(variable, '0px');
    };
  }, [variable]);
  return ref;
}

export interface AppHeaderProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  safeArea?: boolean;
  windowControlsOverlay?: boolean;
}

export const AppHeader = forwardRef<HTMLElement, AppHeaderProps>(function AppHeader({
  as = 'div',
  safeArea = true,
  windowControlsOverlay = false,
  ...props
}, forwardedRef) {
  const measuredRef = useMeasuredCssVariable('--hf-header-height');
  return createElement(as, {
      ...props,
      ref: (element: HTMLElement | null) => {
        measuredRef.current = element;
        assignRef(forwardedRef, element);
      },
      'data-hf-header': '',
      'data-safe-area': safeArea ? undefined : 'false',
      'data-window-controls-overlay': windowControlsOverlay || undefined,
    });
});

export function HomeframeWindowDragRegion<T extends ElementType = 'div'>({
  as,
  ...props
}: PolymorphicProps<T>) {
  return createElement(as ?? 'div', { ...props, 'data-hf-window-drag': '' });
}

/** `overlay` is retained as the legacy combined placement/policy value. */
export type DockKeyboardPolicy = 'avoid' | 'hide' | 'overlay' | 'manual';
export type DockPlacement = 'flow' | 'overlay';

export interface ViewportDockProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  keyboard?: DockKeyboardPolicy;
  /** Layout placement is independent from keyboard behavior. */
  placement?: DockPlacement;
}

export const ViewportDock = forwardRef<HTMLElement, ViewportDockProps>(function ViewportDock({
  as = 'div',
  keyboard = 'avoid',
  placement = 'flow',
  ...props
}, forwardedRef) {
  const measuredRef = useMeasuredCssVariable('--hf-bottom-height');
  return createElement(as, {
      ...props,
      ref: (element: HTMLElement | null) => {
        measuredRef.current = element;
        assignRef(forwardedRef, element);
      },
      'data-hf-dock': '',
      'data-hf-dock-placement': placement,
      'data-keyboard-policy': keyboard,
    });
});

export const KeyboardDock = ViewportDock;

export type ViewportAttachmentAnchor = 'header' | 'dock';

export interface ViewportAttachmentProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  /** The measured shell region this overlay follows. */
  anchor: ViewportAttachmentAnchor;
  /** Bottom attachments normally avoid the keyboard; header attachments remain stationary. */
  keyboard?: DockKeyboardPolicy;
}

/**
 * A measured, viewport-bound region that overlays route content immediately
 * below the header or above the bottom dock. Put one attachment at each edge
 * and compose multiple app-owned controls inside it as a stack.
 */
export const ViewportAttachment = forwardRef<HTMLElement, ViewportAttachmentProps>(
  function ViewportAttachment({
    as = 'div',
    anchor,
    keyboard = anchor === 'dock' ? 'avoid' : 'manual',
    ...props
  }, forwardedRef) {
    const measuredRef = useMeasuredCssVariable(
      anchor === 'header' ? '--hf-top-attachment-height' : '--hf-bottom-attachment-height',
    );
    return createElement(as, {
      ...props,
      ref: (element: HTMLElement | null) => {
        measuredRef.current = element;
        assignRef(forwardedRef, element);
      },
      'data-hf-viewport-attachment': '',
      'data-hf-attachment-anchor': anchor,
      'data-keyboard-policy': keyboard,
    });
  },
);

export interface AppScrollViewHandle {
  element: HTMLElement | null;
  scrollTo(options?: ScrollToOptions): void;
  reveal(element: Element): void;
}

export type AppScrollTarget =
  | { readonly type: 'position'; readonly top: number }
  | { readonly type: 'anchor'; readonly anchor: string; readonly offset: number };

export interface AppScrollViewProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  scrollKey?: string;
  navigationType?: 'back' | 'forward' | 'replace' | 'push' | 'reload' | 'unknown';
  scrollBehavior?: 'reset' | 'restore' | 'preserve';
  /** A URL-backed cold-launch target supplied by `useRouteScrollRestoration()`. */
  permalinkScroll?: AppScrollTarget | null;
  revealFocusedControl?: boolean;
}

const scrollPositions = new Map<string, number>();

export const AppScrollView = forwardRef<AppScrollViewHandle, AppScrollViewProps>(
  function AppScrollView({
    as = 'div',
    scrollKey,
    navigationType = 'unknown',
    scrollBehavior,
    permalinkScroll,
    revealFocusedControl = true,
    onScroll,
    ...props
  }, forwardedRef) {
    const ref = useRef<HTMLElement>(null);
    const activeScrollKey = useRef(scrollKey);

    useImperativeHandle(forwardedRef, () => ({
      element: ref.current,
      scrollTo: (options = {}) => ref.current?.scrollTo(options),
      reveal: (element) => revealInside(ref.current, element),
    }), []);

    useLayoutEffect(() => {
      // The scroll listener records the outgoing entry before React replaces its
      // contents. Reading scrollTop here is too late: a shorter destination may
      // already have clamped the shared scroller and would corrupt restoration.
      activeScrollKey.current = scrollKey;
      if ((!scrollKey && !permalinkScroll) || !ref.current) return;
      const action = scrollBehavior ?? (navigationType === 'back'
        || navigationType === 'forward'
        || navigationType === 'reload' ? 'restore' : 'reset');
      if (action === 'preserve' && !permalinkScroll) return;
      const node = ref.current;
      const restoredTop = action === 'restore' && scrollKey
        ? scrollPositions.get(scrollKey) ?? 0
        : 0;
      const applyTarget = () => {
        const target = permalinkScroll
          ? permalinkTargetTop(node, permalinkScroll)
          : restoredTop;
        if (target === null) return false;
        node.scrollTop = target;
        return Math.abs(node.scrollTop - target) < 1;
      };
      if (applyTarget()) return;
      if (!permalinkScroll && (action !== 'restore' || restoredTop <= 0)) return;

      // Route data frequently arrives after the destination scroller mounts.
      // A one-shot assignment is clamped against the short loading state and
      // permanently loses the saved position. Retry until the content can hold
      // the target, while yielding immediately to any real user interaction.
      let frame = 0;
      let cancelled = false;
      const deadline = performance.now() + 10_000;
      const cancel = () => {
        cancelled = true;
        if (frame) cancelAnimationFrame(frame);
      };
      const retry = () => {
        if (cancelled || ref.current !== node || performance.now() >= deadline) return;
        if (applyTarget()) return;
        frame = requestAnimationFrame(retry);
      };
      for (const eventName of ['pointerdown', 'touchstart', 'wheel', 'keydown']) {
        node.addEventListener(eventName, cancel, { capture: true, once: true });
      }
      frame = requestAnimationFrame(retry);
      return () => {
        cancel();
        for (const eventName of ['pointerdown', 'touchstart', 'wheel', 'keydown']) {
          node.removeEventListener(eventName, cancel, { capture: true });
        }
      };
    }, [navigationType, permalinkScroll, scrollBehavior, scrollKey]);

    // Keep the mounted node in the cleanup closure. React detaches object refs
    // during the mutation phase before layout cleanup runs in a real browser,
    // so reading ref.current here loses route-scoped scroll positions even
    // though jsdom leaves the ref populated long enough to mask the defect.
    useLayoutEffect(() => {
      const mountedNode = ref.current;
      return () => {
        const key = activeScrollKey.current;
        if (key && mountedNode) scrollPositions.set(key, mountedNode.scrollTop);
      };
    }, []);

    useEffect(() => {
      if (!revealFocusedControl) return;
      const listener = () => {
        const active = document.activeElement;
        if (active instanceof Element) requestAnimationFrame(() => revealInside(ref.current, active));
      };
      window.addEventListener('homeframe:viewport-change', listener);
      return () => window.removeEventListener('homeframe:viewport-change', listener);
    }, [revealFocusedControl]);

    return createElement(as, {
        ...props,
        ref,
        'data-hf-scroll-view': '',
        'data-hf-scroll-key': scrollKey,
        onScroll: (event: UIEvent<HTMLElement>) => {
          if (scrollKey) scrollPositions.set(scrollKey, event.currentTarget.scrollTop);
          onScroll?.(event);
        },
      });
  },
);

function permalinkTargetTop(scroller: HTMLElement, target: AppScrollTarget): number | null {
  if (target.type === 'position') return Math.max(0, target.top);
  const byId = document.getElementById(target.anchor);
  const anchor = byId && scroller.contains(byId)
    ? byId
    : [...scroller.querySelectorAll<HTMLElement>('[data-hf-permalink-anchor]')]
        .find(element => element.dataset.hfPermalinkAnchor === target.anchor) ?? null;
  if (!anchor) return null;
  return Math.max(
    0,
    scroller.scrollTop
      + anchor.getBoundingClientRect().top
      - scroller.getBoundingClientRect().top
      - target.offset,
  );
}

function revealInside(scroller: HTMLElement | null, element: Element): void {
  if (!scroller || !scroller.contains(element)) return;
  const bounds = element.getBoundingClientRect();
  const scrollerBounds = scroller.getBoundingClientRect();
  const viewport = element.closest<HTMLElement>('[data-hf-viewport]');
  const viewportBottom = viewport?.getBoundingClientRect().bottom ?? scrollerBounds.bottom;
  const keyboardHeight = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--hf-keyboard-height'),
  ) || 0;
  const visibleBottom = Math.min(scrollerBounds.bottom, viewportBottom - keyboardHeight);
  const margin = 12;
  if (bounds.bottom > visibleBottom - margin) {
    scroller.scrollBy({ top: bounds.bottom - visibleBottom + margin, behavior: 'smooth' });
  } else if (bounds.top < scrollerBounds.top + margin) {
    scroller.scrollBy({ top: bounds.top - scrollerBounds.top - margin, behavior: 'smooth' });
  }
}

export function HomeframePortal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null;
  const portal = document.querySelector<HTMLElement>('[data-hf-portals]');
  return portal ? createPortal(children, portal) : null;
}

export function HomeframePortalRoot(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} data-hf-portals="" />;
}

export function SelectableText<T extends ElementType = 'span'>({
  as,
  ...props
}: PolymorphicProps<T>) {
  return createElement(as ?? 'span', { ...props, 'data-hf-selectable': '' });
}

export function NoCallout<T extends ElementType = 'span'>({
  as,
  ...props
}: PolymorphicProps<T>) {
  return createElement(as ?? 'span', { ...props, 'data-hf-no-callout': '' });
}

function assignRef<T>(ref: React.ForwardedRef<T>, value: T | null): void {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}
