import {
  createElement,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type ElementType,
  type HTMLAttributes,
  type MutableRefObject,
  type ReactNode,
  type Ref,
  type UIEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { getHomeframeRootStyle } from '@homeframe/runtime';
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
  bottom?: ReactNode;
  headerSafeArea?: boolean;
  bottomKeyboard?: DockKeyboardPolicy;
}

export function AppShell({
  as = 'div',
  contentAs = 'main',
  header,
  bottom,
  headerSafeArea = true,
  bottomKeyboard,
  children,
  ...props
}: AppShellProps) {
  const { config } = useHomeframe();
  const dockPolicy = bottomKeyboard ?? config.bottomDock ?? 'avoid';
  return createElement(
    as,
    { ...props, 'data-hf-shell': '' },
    header == null ? <div /> : <AppHeader safeArea={headerSafeArea}>{header}</AppHeader>,
    createElement(contentAs, { 'data-hf-content': '' }, children),
    bottom == null ? <div /> : <ViewportDock keyboard={dockPolicy}>{bottom}</ViewportDock>,
  );
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
    return () => observer.disconnect();
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

export type DockKeyboardPolicy = 'avoid' | 'hide' | 'overlay' | 'manual';

export interface ViewportDockProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  keyboard?: DockKeyboardPolicy;
}

export const ViewportDock = forwardRef<HTMLElement, ViewportDockProps>(function ViewportDock({
  as = 'div',
  keyboard = 'avoid',
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
      'data-keyboard-policy': keyboard,
    });
});

export const KeyboardDock = ViewportDock;

export interface AppScrollViewHandle {
  element: HTMLElement | null;
  scrollTo(options?: ScrollToOptions): void;
  reveal(element: Element): void;
}

export interface AppScrollViewProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  scrollKey?: string;
  navigationType?: 'back' | 'forward' | 'replace' | 'push' | 'reload' | 'unknown';
  scrollBehavior?: 'reset' | 'restore' | 'preserve';
  revealFocusedControl?: boolean;
}

const scrollPositions = new Map<string, number>();

export const AppScrollView = forwardRef<AppScrollViewHandle, AppScrollViewProps>(
  function AppScrollView({
    as = 'div',
    scrollKey,
    navigationType = 'unknown',
    scrollBehavior,
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
      if (!scrollKey || !ref.current) return;
      const action = scrollBehavior ?? (navigationType === 'back'
        || navigationType === 'forward'
        || navigationType === 'reload' ? 'restore' : 'reset');
      if (action === 'preserve') return;
      ref.current.scrollTop = action === 'restore' ? scrollPositions.get(scrollKey) ?? 0 : 0;
    }, [navigationType, scrollBehavior, scrollKey]);

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

function revealInside(scroller: HTMLElement | null, element: Element): void {
  if (!scroller || !scroller.contains(element)) return;
  const bounds = element.getBoundingClientRect();
  const scrollerBounds = scroller.getBoundingClientRect();
  const margin = 12;
  if (bounds.bottom > scrollerBounds.bottom - margin) {
    scroller.scrollBy({ top: bounds.bottom - scrollerBounds.bottom + margin, behavior: 'smooth' });
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
