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
  emitRuntimeEvent,
  getBuildInfo,
  getInstallController,
  getLifecycleController,
  getViewportController,
  type ViewportRuntimeOptions,
} from '@builtbyted/runtime';
import {
  HomeframeServiceWorkerClient,
  type HttpPushSubscriptionTransportOptions,
  type ServiceWorkerClientConfig,
  type PushSubscriptionTransport,
} from '@builtbyted/sw';
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
  bottomDock?: 'avoid' | 'hide' | 'overlay' | 'manual';
  diagnostics?: { enabled?: boolean; queryParameter?: string };
}

interface HomeframeContextValue {
  config: Required<Pick<HomeframeReactConfig, 'selection' | 'snapshot'>> & HomeframeReactConfig;
  serviceWorker: HomeframeServiceWorkerClient | null;
}

const HomeframeContext = createContext<HomeframeContextValue | null>(null);
const emptyReactConfig: HomeframeReactConfig = {};

export function HomeframeProvider({
  config = {},
  children,
}: PropsWithChildren<{ config?: HomeframeReactConfig }>) {
  const embeddedConfig = (getBuildInfo()?.reactConfig ?? emptyReactConfig) as HomeframeReactConfig;
  const resolvedConfig = useMemo(() => ({
    ...embeddedConfig,
    ...config,
    viewport: { ...embeddedConfig.viewport, ...config.viewport },
    nudges: { ...embeddedConfig.nudges, ...config.nudges },
    selection: config.selection ?? embeddedConfig.selection ?? 'controls-only' as const,
    snapshot: config.snapshot ?? embeddedConfig.snapshot ?? 'brand' as const,
  }), [config, embeddedConfig]);
  const viewport = useMemo(() => getViewportController(resolvedConfig.viewport), [resolvedConfig.viewport]);
  const lifecycle = useMemo(() => getLifecycleController(), []);
  const install = useMemo(() => getInstallController(), []);
  const serviceWorkerRef = useRef<HomeframeServiceWorkerClient | null>(null);
  const lastWorkerState = useRef<string | null>(null);
  const build = typeof window === 'undefined' ? null : window.__HOMEFRAME_BUILD__;
  if (serviceWorkerRef.current === null
    && resolvedConfig.serviceWorker !== false
    && build?.serviceWorkerConfig !== false) {
    const embeddedWorker = build?.serviceWorkerConfig && typeof build.serviceWorkerConfig === 'object'
      ? build.serviceWorkerConfig as ServiceWorkerClientConfig
      : {};
    serviceWorkerRef.current = new HomeframeServiceWorkerClient({
      ...embeddedWorker,
      ...resolvedConfig.serviceWorker,
      ...(build?.serviceWorkerUrl ? { url: build.serviceWorkerUrl } : {}),
      ...(build?.serviceWorkerScope ? { scope: build.serviceWorkerScope } : {}),
    });
  }

  useEffect(() => {
    const stops = [viewport.start(), lifecycle.start(), install.start()];
    const serviceWorker = serviceWorkerRef.current;
    if (serviceWorker) {
      stops.push(serviceWorker.subscribe(() => {
        const snapshot = serviceWorker.getSnapshot();
        emitRuntimeEvent('update-change', snapshot);
        if (snapshot.state !== lastWorkerState.current) {
          if (snapshot.state === 'deferred') {
            emitRuntimeEvent('update-deferral', {
              availableBuild: snapshot.availableBuild,
              guardCount: snapshot.guardCount,
            });
          } else if (snapshot.state === 'failed') {
            emitRuntimeEvent('worker-failure', {
              state: snapshot.state,
              error: snapshot.error,
            });
          }
          lastWorkerState.current = snapshot.state;
        }
      }));
    }
    void serviceWorker?.start();
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
        <LifecyclePresentation
          snapshot={resolvedConfig.snapshot}
          viewport={viewport}
          serviceWorker={serviceWorkerRef.current}
        >
          <HomeframeNudgeProvider {...(resolvedConfig.nudges ? { config: resolvedConfig.nudges } : {})}>
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
  serviceWorker,
  children,
}: {
  snapshot: SnapshotPolicy;
  viewport: ReturnType<typeof getViewportController>;
  serviceWorker: HomeframeServiceWorkerClient | null;
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
  const workerRevision = useSyncExternalStore(
    serviceWorker?.subscribe ?? subscribeToNothing,
    serviceWorker ? () => serviceWorker.getSnapshot().revision : noWorkerRevision,
    noWorkerRevision,
  );
  const workerBlocksInitialPresentation = serviceWorker?.shouldHoldInitialPresentation() ?? false;
  useEffect(() => {
    const root = document.documentElement;
    if (snapshot !== 'preserve' && lifecycle.phase === 'hidden') {
      root.dataset.hfSplashVisible = snapshot;
      return;
    }
    if (lifecycle.phase === 'restoring') {
      if (snapshot === 'preserve') {
        delete root.dataset.hfSplashVisible;
      } else {
        root.dataset.hfSplashVisible = snapshot;
      }
      return;
    }
    if (lifecycle.phase === 'visible'
      && readiness.pending.length === 0
      && viewportSnapshot.revision > 0
      && routerReady
      && !workerBlocksInitialPresentation) {
      const updateReload = serviceWorker?.shouldStabilizeUpdateReloadPresentation() ?? false;
      if (updateReload) {
        root.dataset.hfUpdateReload = 'restoring';
        const startedAt = performance.now();
        let frame = 0;
        let previousGeometry = '';
        let stableFrames = 0;
        const revealStableUpdate = () => {
          const visual = window.visualViewport;
          const values = [
            visual?.width ?? window.innerWidth,
            visual?.height ?? window.innerHeight,
            visual?.offsetTop ?? 0,
            visual?.pageTop ?? 0,
            visual?.scale ?? 1,
            window.innerWidth,
            window.innerHeight,
          ];
          const geometry = values.map((value) => Math.round(value * 10) / 10).join(':');
          const visualBottom = values[1]! + values[2]!;
          const screenGap = window.screen.height - window.innerHeight;
          const closed = root.dataset.hfKeyboard === 'closed'
            && values[4]! <= 1.01
            && Math.abs(visualBottom - window.innerHeight) <= 2
            && values[3]! <= 1
            && window.scrollY === 0
            && (window.screen.height <= 0 || screenGap <= Math.max(96, viewportSnapshot.safeArea.top * 2));
          stableFrames = closed && geometry === previousGeometry ? stableFrames + 1 : closed ? 1 : 0;
          previousGeometry = geometry;
          if (performance.now() - startedAt < 160 || stableFrames < 3) {
            frame = requestAnimationFrame(revealStableUpdate);
            return;
          }
          serviceWorker?.completeUpdateReloadPresentation();
          delete root.dataset.hfUpdateReload;
          root.dataset.hfReady = 'true';
          delete root.dataset.hfSplashVisible;
        };
        frame = requestAnimationFrame(revealStableUpdate);
        return () => cancelAnimationFrame(frame);
      }
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
  }, [
    lifecycle.phase,
    readiness.pending.length,
    routerReady,
    serviceWorker,
    snapshot,
    viewportSnapshot.revision,
    workerBlocksInitialPresentation,
    workerRevision,
  ]);
  return children;
}

function subscribeToNothing(): () => void {
  return () => undefined;
}

function noWorkerRevision(): number {
  return 0;
}

export function useHomeframe(): HomeframeContextValue {
  const value = useContext(HomeframeContext);
  if (!value) throw new Error('Homeframe hooks must be used inside <HomeframeProvider>.');
  return value;
}
