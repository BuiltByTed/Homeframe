import {
  Component,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { getBuildInfo, getRecentRuntimeEvents } from '@builtbyted/runtime';
import { useOnlineStatus } from './hooks.js';
import { useServiceWorker } from './hooks.js';

interface ReadinessValue {
  pending: readonly string[];
  timedOut: readonly ReadinessTimeout[];
  hold(name: string): () => void;
}

export interface ReadinessTimeout {
  name: string;
  startedAt: number;
  ownerStack: string | null;
}

interface ReadinessHold extends ReadinessTimeout {
  token: string;
}

const ReadinessContext = createContext<ReadinessValue | null>(null);

export function HomeframeReadinessProvider({ children }: { children: ReactNode }) {
  const [holds, setHolds] = useState<readonly ReadinessHold[]>([]);
  const [timedOut, setTimedOut] = useState<readonly ReadinessTimeout[]>([]);
  const hold = useCallback((name: string) => {
    const token = `${name}:${crypto.randomUUID?.() ?? Math.random().toString(36)}`;
    const startedAt = Date.now();
    const ownerStack = new Error(`Readiness hold created: ${name}`).stack ?? null;
    const entry = { token, name, startedAt, ownerStack };
    setHolds((current) => [...current, entry]);
    let released = false;
    const timer = window.setTimeout(() => {
      if (released) return;
      console.error(`[Homeframe HF_READINESS_TIMEOUT] Readiness hold “${name}” exceeded 15s.`, ownerStack);
      setTimedOut((current) => current.some((item) => item.name === name && item.startedAt === startedAt)
        ? current
        : [...current, { name, startedAt, ownerStack }]);
    }, 15_000);
    return () => {
      if (released) return;
      released = true;
      window.clearTimeout(timer);
      setHolds((current) => current.filter((item) => item.token !== token));
      setTimedOut((current) => current.filter((item) => item.name !== name || item.startedAt !== startedAt));
    };
  }, []);
  const pending = useMemo(() => holds.map((entry) => entry.name), [holds]);
  const value = useMemo(() => ({ pending, timedOut, hold }), [hold, pending, timedOut]);
  return (
    <ReadinessContext.Provider value={value}>
      {children}
      {timedOut.length > 0 && <ReadinessFailure timeouts={timedOut} />}
    </ReadinessContext.Provider>
  );
}

export function useHomeframeReadiness(): ReadinessValue {
  const context = useContext(ReadinessContext);
  if (!context) {
    return { pending: [], timedOut: [], hold: () => () => undefined };
  }
  return context;
}

function ReadinessFailure({ timeouts }: { timeouts: readonly ReadinessTimeout[] }) {
  useEffect(() => {
    document.documentElement.dataset.hfReadinessError = 'true';
    return () => {
      delete document.documentElement.dataset.hfReadinessError;
    };
  }, []);
  return (
    <div data-hf-readiness-failure="" role="alert" aria-live="assertive">
      <strong>The app could not finish restoring.</strong>
      <span>{timeouts.map((item) => item.name).join(', ')}</span>
      <button type="button" onClick={() => location.reload()}>Retry</button>
    </div>
  );
}

export function HomeframeSplash({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={className} data-hf-react-splash="" aria-hidden="true">{children}</div>;
}

export function HomeframeSnapshotContent({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null;
  const splash = document.getElementById('homeframe-boot-splash');
  if (!splash) return null;
  return createPortal(<div data-hf-snapshot-content="">{children}</div>, splash);
}

export function HomeframeOfflineBoundary({
  offline,
  children,
}: {
  offline: ReactNode;
  children: ReactNode;
}) {
  return useOnlineStatus() ? children : offline;
}

export interface HomeframeErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode | ((error: Error, retry: () => void) => ReactNode);
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
  resetKey: number;
}

export class HomeframeErrorBoundary extends Component<HomeframeErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    document.documentElement.dataset.hfError = 'true';
    this.props.onError?.(error, info);
  }

  componentWillUnmount(): void {
    delete document.documentElement.dataset.hfError;
  }

  render() {
    if (this.state.error) {
      const retry = () => {
        delete document.documentElement.dataset.hfError;
        this.setState(({ resetKey }) => ({ error: null, resetKey: resetKey + 1 }));
      };
      return typeof this.props.fallback === 'function'
        ? this.props.fallback(this.state.error, retry)
        : this.props.fallback;
    }
    return <div key={this.state.resetKey}>{this.props.children}</div>;
  }
}

export interface HomeframeRecoverySnapshot {
  online: boolean;
  secureContext: boolean;
  appId: string | null;
  currentBuild: string | null;
  availableBuild: string | null;
  workerState: string;
  workerError: string | null;
  controllerScript: string | null;
  registrationScope: string | null;
  appOwnedCaches: readonly string[];
  storageUsage: number | null;
  storageQuota: number | null;
  storagePersisted: boolean | null;
  checkedAt: number;
}

export function useHomeframeRecovery(): HomeframeRecoverySnapshot {
  const worker = useServiceWorker();
  const online = useOnlineStatus();
  const [details, setDetails] = useState<Omit<
    HomeframeRecoverySnapshot,
    'online' | 'currentBuild' | 'availableBuild' | 'workerState' | 'workerError'
  >>(() => ({
    secureContext: typeof window === 'undefined' || window.isSecureContext,
    appId: getBuildInfo()?.appId ?? null,
    controllerScript: null,
    registrationScope: null,
    appOwnedCaches: [],
    storageUsage: null,
    storageQuota: null,
    storagePersisted: null,
    checkedAt: Date.now(),
  }));
  useEffect(() => {
    let active = true;
    void (async () => {
      const build = getBuildInfo();
      const safeAppId = build?.appId.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'app';
      const registration = 'serviceWorker' in navigator
        ? await navigator.serviceWorker.getRegistration(build?.serviceWorkerScope ?? '/').catch(() => undefined)
        : undefined;
      const cacheNames = 'caches' in window ? await caches.keys().catch(() => []) : [];
      const estimate: StorageEstimate = await navigator.storage?.estimate?.().catch(() => ({})) ?? {};
      const persisted = await navigator.storage?.persisted?.().catch(() => null) ?? null;
      if (!active) return;
      setDetails({
        secureContext: window.isSecureContext,
        appId: build?.appId ?? null,
        controllerScript: navigator.serviceWorker?.controller?.scriptURL ?? null,
        registrationScope: registration?.scope ?? null,
        appOwnedCaches: cacheNames.filter((name) => name.startsWith(`hf-${safeAppId}-`)).sort(),
        storageUsage: typeof estimate?.usage === 'number' ? estimate.usage : null,
        storageQuota: typeof estimate?.quota === 'number' ? estimate.quota : null,
        storagePersisted: persisted,
        checkedAt: Date.now(),
      });
    })();
    return () => { active = false; };
  }, [worker.revision]);
  const lastFailure = [...getRecentRuntimeEvents()].reverse()
    .find((event) => event.name === 'worker-failure')?.detail as { error?: string | null } | undefined;
  return {
    ...details,
    online,
    currentBuild: worker.currentBuild,
    availableBuild: worker.availableBuild,
    workerState: worker.state,
    workerError: worker.error ?? lastFailure?.error ?? null,
  };
}

/** A safe, unstyled recovery view suitable for the app's network-first route. */
export function HomeframeRecovery({
  title = 'App recovery',
}: {
  title?: string;
}) {
  const recovery = useHomeframeRecovery();
  const worker = useServiceWorker();
  return (
    <section data-hf-recovery="" aria-labelledby="homeframe-recovery-title">
      <h1 id="homeframe-recovery-title">{title}</h1>
      <p>{recovery.online ? 'The network appears available.' : 'The device appears offline.'}</p>
      <dl>
        <dt>Worker</dt><dd>{recovery.workerState}</dd>
        <dt>Current build</dt><dd>{recovery.currentBuild ?? 'unknown'}</dd>
        <dt>Available build</dt><dd>{recovery.availableBuild ?? 'none'}</dd>
        <dt>Controller</dt><dd>{recovery.controllerScript ?? 'none'}</dd>
        <dt>Scope</dt><dd>{recovery.registrationScope ?? 'none'}</dd>
        <dt>App-owned caches</dt><dd>{recovery.appOwnedCaches.length}</dd>
        <dt>Persistent storage</dt><dd>{recovery.storagePersisted == null ? 'unknown' : recovery.storagePersisted ? 'yes' : 'no'}</dd>
        {recovery.workerError && <><dt>Last worker error</dt><dd>{recovery.workerError}</dd></>}
      </dl>
      <button type="button" onClick={() => void worker.client?.check()}>Check for a repaired version</button>
    </section>
  );
}
