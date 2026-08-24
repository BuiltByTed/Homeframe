import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import {
  getInstallController,
  getLifecycleController,
  getViewportController,
  type ViewportRuntimeOptions,
} from '@homeframe/runtime';
import {
  HomeframeServiceWorkerClient,
  type HttpPushSubscriptionTransportOptions,
  type ServiceWorkerClientConfig,
  type PushSubscriptionTransport,
} from '@homeframe/sw';
import { HomeframeNudgeProvider, type HomeframeNudgeConfig } from './nudges.js';
import { HomeframeReadinessProvider, useHomeframeReadiness } from './lifecycle.js';
import { useAppLifecycle } from './hooks.js';

export type SnapshotPolicy = 'preserve' | 'brand' | 'privacy';

export interface HomeframeNotificationConfig {
  applicationServerKey?: string;
  transport?: PushSubscriptionTransport | HttpPushSubscriptionTransportOptions;
}

export interface HomeframeReactConfig {
  selection?: 'controls-only' | 'allow';
  snapshot?: SnapshotPolicy;
  viewport?: ViewportRuntimeOptions;
  serviceWorker?: ServiceWorkerClientConfig | false;
  notifications?: HomeframeNotificationConfig | false;
  nudges?: HomeframeNudgeConfig;
}

interface HomeframeContextValue {
  config: Required<Pick<HomeframeReactConfig, 'selection' | 'snapshot'>> & HomeframeReactConfig;
  serviceWorker: HomeframeServiceWorkerClient | null;
}

const HomeframeContext = createContext<HomeframeContextValue | null>(null);

export function HomeframeProvider({
  config = {},
  children,
}: PropsWithChildren<{ config?: HomeframeReactConfig }>) {
  const resolvedConfig = useMemo(() => ({
    ...config,
    selection: config.selection ?? 'controls-only' as const,
    snapshot: config.snapshot ?? 'brand' as const,
  }), [config]);
  const viewport = useMemo(() => getViewportController(config.viewport), [config.viewport]);
  const lifecycle = useMemo(() => getLifecycleController(), []);
  const install = useMemo(() => getInstallController(), []);
  const serviceWorkerRef = useRef<HomeframeServiceWorkerClient | null>(null);
  if (serviceWorkerRef.current === null && config.serviceWorker !== false) {
    const build = typeof window === 'undefined' ? null : window.__HOMEFRAME_BUILD__;
    serviceWorkerRef.current = new HomeframeServiceWorkerClient({
      ...config.serviceWorker,
      ...(build?.serviceWorkerUrl ? { url: build.serviceWorkerUrl } : {}),
      ...(build?.serviceWorkerScope ? { scope: build.serviceWorkerScope } : {}),
    });
  }

  useEffect(() => {
    const stops = [viewport.start(), lifecycle.start(), install.start()];
    void serviceWorkerRef.current?.start();
    return () => {
      for (const stop of stops) stop();
      serviceWorkerRef.current?.stop();
    };
  }, [install, lifecycle, viewport]);

  const value = useMemo<HomeframeContextValue>(() => ({
    config: resolvedConfig,
    serviceWorker: serviceWorkerRef.current,
  }), [resolvedConfig]);

  return (
    <HomeframeContext.Provider value={value}>
      <HomeframeReadinessProvider>
        <LifecyclePresentation snapshot={resolvedConfig.snapshot} viewport={viewport}>
          <HomeframeNudgeProvider {...(config.nudges ? { config: config.nudges } : {})}>
            {children}
          </HomeframeNudgeProvider>
        </LifecyclePresentation>
      </HomeframeReadinessProvider>
    </HomeframeContext.Provider>
  );
}

function subscribeToRouterReadiness(listener: () => void): () => void {
  window.addEventListener('homeframe:router-ready', listener);
  window.addEventListener('homeframe:route-change', listener);
  return () => {
    window.removeEventListener('homeframe:router-ready', listener);
    window.removeEventListener('homeframe:route-change', listener);
  };
}

function routerIsReady(): boolean {
  return document.documentElement.dataset.hfRouterReady !== 'false';
}

function LifecyclePresentation({
  snapshot,
  viewport,
  children,
}: {
  snapshot: SnapshotPolicy;
  viewport: ReturnType<typeof getViewportController>;
  children: ReactNode;
}) {
  const lifecycle = useAppLifecycle();
  const readiness = useHomeframeReadiness();
  const viewportSnapshot = useSyncExternalStore(
    viewport.subscribe,
    viewport.getSnapshot,
    viewport.getServerSnapshot,
  );
  const routerReady = useSyncExternalStore(subscribeToRouterReadiness, routerIsReady, () => true);
  useEffect(() => {
    const root = document.documentElement;
    if (snapshot !== 'preserve' && lifecycle.phase === 'hidden') {
      root.dataset.hfSplashVisible = snapshot;
      return;
    }
    if (lifecycle.phase === 'restoring') {
      root.dataset.hfSplashVisible = snapshot === 'preserve' ? 'brand' : snapshot;
      return;
    }
    if (lifecycle.phase === 'visible'
      && readiness.pending.length === 0
      && viewportSnapshot.revision > 0
      && routerReady) {
      let secondFrame = 0;
      const firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => {
          root.dataset.hfReady = 'true';
          delete root.dataset.hfSplashVisible;
        });
      });
      return () => {
        cancelAnimationFrame(firstFrame);
        if (secondFrame) cancelAnimationFrame(secondFrame);
      };
    }
  }, [lifecycle.phase, readiness.pending.length, routerReady, snapshot, viewportSnapshot.revision]);
  return children;
}

export function useHomeframe(): HomeframeContextValue {
  const value = useContext(HomeframeContext);
  if (!value) throw new Error('Homeframe hooks must be used inside <HomeframeProvider>.');
  return value;
}
