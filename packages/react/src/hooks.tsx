import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import {
  getLifecycleController,
  getViewportController,
  type HomeframeViewportSnapshot,
} from '@homeframe/runtime';
import { setAppBadge } from '@homeframe/sw';
import { useHomeframe } from './context.js';

export function useViewport(): HomeframeViewportSnapshot {
  const controller = getViewportController();
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getServerSnapshot);
}

export function useKeyboard(): HomeframeViewportSnapshot['keyboard'] {
  return useViewport().keyboard;
}

export function useSafeArea(): HomeframeViewportSnapshot['safeArea'] {
  return useViewport().safeArea;
}

export function useDisplayMode(): HomeframeViewportSnapshot['displayMode'] {
  return useViewport().displayMode;
}

export function useAppLifecycle() {
  const controller = getLifecycleController();
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getServerSnapshot);
}

export function useHomeframeUpdate() {
  const { serviceWorker } = useHomeframe();
  const empty = useMemo(() => ({
    state: 'unsupported' as const,
    currentBuild: null,
    availableBuild: null,
    error: null,
    registration: null,
    revision: 0,
  }), []);
  const snapshot = useSyncExternalStore(
    serviceWorker?.subscribe ?? (() => () => undefined),
    serviceWorker?.getSnapshot ?? (() => empty),
    serviceWorker?.getServerSnapshot ?? (() => empty),
  );
  return {
    ...snapshot,
    check: () => serviceWorker?.check() ?? Promise.resolve(),
    activate: () => serviceWorker?.activate() ?? Promise.resolve(),
    defer: () => serviceWorker?.defer(),
    registerGuard: (guard: () => boolean | Promise<boolean>) =>
      serviceWorker?.registerGuard(guard) ?? (() => undefined),
    purgeRuntimeCache: (name: string) => serviceWorker?.purgeRuntimeCache(name) ?? Promise.resolve(),
  };
}

export function useAppBadge() {
  return useCallback((count?: number) => setAppBadge(count), []);
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

export const HomeframeInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function HomeframeInput({ style, ...props }, ref) {
    return <input {...props} ref={ref} style={{ fontSize: 'max(var(--hf-input-min-font-size, 16px), 1rem)', ...style }} />;
  },
);

export const HomeframeTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function HomeframeTextarea({ style, ...props }, ref) {
    return <textarea {...props} ref={ref} style={{ fontSize: 'max(var(--hf-input-min-font-size, 16px), 1rem)', ...style }} />;
  },
);

export const HomeframeSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function HomeframeSelect({ style, ...props }, ref) {
    return <select {...props} ref={ref} style={{ fontSize: 'max(var(--hf-input-min-font-size, 16px), 1rem)', ...style }} />;
  },
);

export interface StateCheckpointOptions<T> {
  key: string;
  initialValue: T;
  storage?: 'session' | 'local';
  version?: number;
  serialize?: (value: T) => string;
  deserialize?: (value: string) => T;
}

export function useStateCheckpoint<T>({
  key,
  initialValue,
  storage = 'session',
  version = 1,
  serialize = JSON.stringify,
  deserialize = JSON.parse,
}: StateCheckpointOptions<T>): [T, React.Dispatch<React.SetStateAction<T>>] {
  const storageKey = `hf:checkpoint:${version}:${key}`;
  const target = typeof window === 'undefined'
    ? null
    : storage === 'local' ? localStorage : sessionStorage;
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = target?.getItem(storageKey);
      return stored == null ? initialValue : deserialize(stored);
    } catch {
      return initialValue;
    }
  });
  useEffect(() => {
    try {
      target?.setItem(storageKey, serialize(value));
    } catch {
      // Storage may be unavailable or full. The in-memory state remains valid.
    }
  }, [serialize, storageKey, target, value]);
  return [value, setValue];
}
