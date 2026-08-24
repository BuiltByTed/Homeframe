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
import { useOnlineStatus } from './hooks.js';

interface ReadinessValue {
  pending: readonly string[];
  hold(name: string): () => void;
}

const ReadinessContext = createContext<ReadinessValue | null>(null);

export function HomeframeReadinessProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<readonly string[]>([]);
  const hold = useCallback((name: string) => {
    const token = `${name}:${crypto.randomUUID?.() ?? Math.random().toString(36)}`;
    setPending((current) => [...current, token]);
    let released = false;
    const timer = window.setTimeout(() => {
      if (!released) console.error(`[Homeframe HF_READINESS_TIMEOUT] Readiness hold “${name}” exceeded 15s.`);
    }, 15_000);
    return () => {
      if (released) return;
      released = true;
      window.clearTimeout(timer);
      setPending((current) => current.filter((item) => item !== token));
    };
  }, []);
  const value = useMemo(() => ({ pending, hold }), [hold, pending]);
  return <ReadinessContext.Provider value={value}>{children}</ReadinessContext.Provider>;
}

export function useHomeframeReadiness(): ReadinessValue {
  const context = useContext(ReadinessContext);
  if (!context) {
    return { pending: [], hold: () => () => undefined };
  }
  return context;
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
    this.props.onError?.(error, info);
  }

  render() {
    if (this.state.error) {
      const retry = () => this.setState(({ resetKey }) => ({ error: null, resetKey: resetKey + 1 }));
      return typeof this.props.fallback === 'function'
        ? this.props.fallback(this.state.error, retry)
        : this.props.fallback;
    }
    return <div key={this.state.resetKey}>{this.props.children}</div>;
  }
}
