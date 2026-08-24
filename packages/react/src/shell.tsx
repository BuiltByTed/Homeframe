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
} from 'react';
import { createPortal } from 'react-dom';
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
  header?: ReactNode;
  bottom?: ReactNode;
  headerSafeArea?: boolean;
  bottomKeyboard?: DockKeyboardPolicy;
}

export function AppShell({
  header,
  bottom,
  headerSafeArea = true,
  bottomKeyboard = 'avoid',
  children,
  ...props
}: AppShellProps) {
  return (
    <div {...props} data-hf-shell="">
      {header == null ? <div /> : <AppHeader safeArea={headerSafeArea}>{header}</AppHeader>}
      <main data-hf-content="">{children}</main>
      {bottom == null ? <div /> : <ViewportDock keyboard={bottomKeyboard}>{bottom}</ViewportDock>}
    </div>
  );
}

function useMeasuredCssVariable(variable: string): MutableRefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => document.documentElement.style.setProperty(variable, `${element.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [variable]);
  return ref;
}

export interface AppHeaderProps extends HTMLAttributes<HTMLDivElement> {
  safeArea?: boolean;
}

export const AppHeader = forwardRef<HTMLDivElement, AppHeaderProps>(function AppHeader({
  safeArea = true,
  style,
  ...props
}, forwardedRef) {
  const measuredRef = useMeasuredCssVariable('--hf-header-height');
  return (
    <div
      {...props}
      ref={(element) => {
        measuredRef.current = element;
        assignRef(forwardedRef, element);
      }}
      data-hf-header=""
      style={{ ...style, paddingTop: safeArea ? undefined : 0 }}
    />
  );
});

export type DockKeyboardPolicy = 'avoid' | 'hide' | 'overlay' | 'manual';

export interface ViewportDockProps extends HTMLAttributes<HTMLDivElement> {
  keyboard?: DockKeyboardPolicy;
}

export const ViewportDock = forwardRef<HTMLDivElement, ViewportDockProps>(function ViewportDock({
  keyboard = 'avoid',
  ...props
}, forwardedRef) {
  const measuredRef = useMeasuredCssVariable('--hf-bottom-height');
  return (
    <div
      {...props}
      ref={(element) => {
        measuredRef.current = element;
        assignRef(forwardedRef, element);
      }}
      data-hf-dock=""
      data-keyboard-policy={keyboard}
    />
  );
});

export const KeyboardDock = ViewportDock;

export interface AppScrollViewHandle {
  element: HTMLDivElement | null;
  scrollTo(options?: ScrollToOptions): void;
  reveal(element: Element): void;
}

export interface AppScrollViewProps extends HTMLAttributes<HTMLDivElement> {
  scrollKey?: string;
  navigationType?: 'back' | 'forward' | 'replace' | 'push' | 'reload' | 'unknown';
  scrollBehavior?: 'reset' | 'restore' | 'preserve';
  revealFocusedControl?: boolean;
}

const scrollPositions = new Map<string, number>();

export const AppScrollView = forwardRef<AppScrollViewHandle, AppScrollViewProps>(
  function AppScrollView({
    scrollKey,
    navigationType = 'unknown',
    scrollBehavior,
    revealFocusedControl = true,
    onScroll,
    ...props
  }, forwardedRef) {
    const ref = useRef<HTMLDivElement>(null);
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

    useEffect(() => () => {
      const key = activeScrollKey.current;
      if (key && ref.current) scrollPositions.set(key, ref.current.scrollTop);
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

    return (
      <div
        {...props}
        ref={ref}
        data-hf-scroll-view=""
        data-hf-scroll-key={scrollKey}
        onScroll={(event) => {
          if (scrollKey) scrollPositions.set(scrollKey, event.currentTarget.scrollTop);
          onScroll?.(event);
        }}
      />
    );
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
