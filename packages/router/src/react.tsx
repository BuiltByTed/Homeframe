import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react';
import type { HomeframeRouter, NavigateOptions, RouterSnapshot } from './router.js';

const RouterContext = createContext<HomeframeRouter | null>(null);

export function HomeframeRouterProvider({
  router,
  children,
}: {
  router: HomeframeRouter;
  children: ReactNode;
}) {
  useEffect(() => {
    document.documentElement.dataset.hfRouterReady = 'false';
    const stop = router.start();
    return () => {
      stop();
      delete document.documentElement.dataset.hfRouterReady;
    };
  }, [router]);
  return <RouterContext.Provider value={router}>{children}</RouterContext.Provider>;
}

export function useHomeframeRouter(): HomeframeRouter {
  const router = useContext(RouterContext);
  if (!router) throw new Error('Router hooks must be used inside <HomeframeRouterProvider>.');
  return router;
}

export function useRouterSnapshot(): RouterSnapshot {
  const router = useHomeframeRouter();
  return useSyncExternalStore(router.subscribe, router.getSnapshot, router.getServerSnapshot);
}

export function useNavigationDirection() {
  return useRouterSnapshot().direction;
}

export function useRouteScrollRestoration() {
  const snapshot = useRouterSnapshot();
  return {
    scrollKey: snapshot.key,
    direction: snapshot.direction,
    scrollBehavior: snapshot.scroll,
  };
}

export function useNavigate() {
  const router = useHomeframeRouter();
  return (to: string | URL, options?: NavigateOptions) => router.navigate(to, options);
}

export function RouterOutlet({ notFound }: { notFound?: ReactNode }) {
  const snapshot = useRouterSnapshot();
  if (!snapshot.match) return notFound ?? null;
  const { route } = snapshot.match;
  if (snapshot.status === 'loading' && route.pendingElement != null) return route.pendingElement;
  if (snapshot.status === 'error') {
    return typeof route.errorElement === 'function'
      ? route.errorElement(snapshot.error)
      : route.errorElement ?? null;
  }
  return typeof route.element === 'function'
    ? route.element(snapshot.match)
    : route.element;
}

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string;
  replace?: boolean;
  state?: unknown;
  prefetch?: 'intent' | 'none';
}

export function Link({
  to,
  replace,
  state,
  prefetch = 'intent',
  onClick,
  onPointerEnter,
  onFocus,
  ...props
}: LinkProps) {
  const router = useHomeframeRouter();
  const href = new URL(to, typeof location === 'undefined' ? 'http://homeframe.invalid' : location.href);
  const maybePrefetch = () => {
    if (prefetch === 'intent' && href.origin === location.origin) void router.prefetch(href);
  };
  return (
    <a
      {...props}
      href={typeof location === 'undefined' || href.origin === location.origin
        ? href.pathname + href.search + href.hash
        : href.href}
      onPointerEnter={(event) => {
        onPointerEnter?.(event);
        if (!event.defaultPrevented) maybePrefetch();
      }}
      onFocus={(event) => {
        onFocus?.(event);
        if (!event.defaultPrevented) maybePrefetch();
      }}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented && eligibleClick(event, props) && router.canHandle(href)) {
          event.preventDefault();
          void router.navigate(href, {
            ...(replace === undefined ? {} : { replace }),
            ...(state === undefined ? {} : { state }),
          });
        }
      }}
    />
  );
}

function eligibleClick(
  event: MouseEvent<HTMLAnchorElement>,
  props: AnchorHTMLAttributes<HTMLAnchorElement>,
): boolean {
  return event.button === 0
    && !event.metaKey
    && !event.ctrlKey
    && !event.shiftKey
    && !event.altKey
    && !props.download
    && (!props.target || props.target === '_self');
}

export function NavLink({ activeClassName = 'active', className, ...props }: LinkProps & {
  activeClassName?: string;
}) {
  const snapshot = useRouterSnapshot();
  const target = new URL(props.to, snapshot.url);
  const active = target.pathname === snapshot.url.pathname;
  return <Link {...props} className={[className, active ? activeClassName : ''].filter(Boolean).join(' ')} aria-current={active ? 'page' : undefined} />;
}
