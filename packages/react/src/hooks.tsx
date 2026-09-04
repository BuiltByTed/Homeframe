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
} from '@builtbyted/runtime';
import {
  createHttpPushSubscriptionTransport,
  setAppBadge,
  type PushSubscriptionTransport,
} from '@builtbyted/sw';
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

export function useServiceWorker() {
  const { serviceWorker } = useHomeframe();
  const empty = useMemo(() => ({
    state: 'unsupported' as const,
    currentBuild: null,
    availableBuild: null,
    error: null,
    registration: null,
    guardCount: 0,
    revision: 0,
  }), []);
  const snapshot = useSyncExternalStore(
    serviceWorker?.subscribe ?? (() => () => undefined),
    serviceWorker?.getSnapshot ?? (() => empty),
    serviceWorker?.getServerSnapshot ?? (() => empty),
  );
  return { ...snapshot, client: serviceWorker };
}

export function useHomeframeUpdate() {
  const { client: serviceWorker, ...snapshot } = useServiceWorker();
  const check = useCallback(
    () => serviceWorker?.check() ?? Promise.resolve(),
    [serviceWorker],
  );
  const activate = useCallback(
    () => serviceWorker?.activate() ?? Promise.resolve(),
    [serviceWorker],
  );
  const defer = useCallback(() => serviceWorker?.defer(), [serviceWorker]);
  const registerGuard = useCallback(
    (guard: () => boolean | Promise<boolean>) =>
      serviceWorker?.registerGuard(guard) ?? (() => undefined),
    [serviceWorker],
  );
  const purgeRuntimeCache = useCallback(
    (name: string) => serviceWorker?.purgeRuntimeCache(name) ?? Promise.resolve(),
    [serviceWorker],
  );
  const purgePrivateCaches = useCallback(
    () => serviceWorker?.purgePrivateCaches() ?? Promise.resolve(),
    [serviceWorker],
  );
  return {
    ...snapshot,
    check,
    activate,
    defer,
    registerGuard,
    purgeRuntimeCache,
    purgePrivateCaches,
  };
}

export interface RevealFocusedControlOptions {
  margin?: number;
  behavior?: ScrollBehavior;
}

export function useRevealFocusedControl(options: RevealFocusedControlOptions = {}) {
  const { margin = 12, behavior = 'smooth' } = options;
  return useCallback((element: Element | null = document.activeElement) => {
    if (!(element instanceof Element)) return false;
    const scroller = element.closest<HTMLElement>('[data-hf-scroll-view]');
    if (!scroller) return false;
    const bounds = element.getBoundingClientRect();
    const scrollerBounds = scroller.getBoundingClientRect();
    const viewport = element.closest<HTMLElement>('[data-hf-viewport]');
    const viewportBottom = viewport?.getBoundingClientRect().bottom ?? scrollerBounds.bottom;
    const keyboardHeight = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--hf-keyboard-height'),
    ) || 0;
    const visibleBottom = Math.min(scrollerBounds.bottom, viewportBottom - keyboardHeight);
    if (bounds.bottom > visibleBottom - margin) {
      scroller.scrollBy({ top: bounds.bottom - visibleBottom + margin, behavior });
    } else if (bounds.top < scrollerBounds.top + margin) {
      scroller.scrollBy({ top: bounds.top - scrollerBounds.top - margin, behavior });
    }
    return true;
  }, [behavior, margin]);
}

export function useAppBadge() {
  return useCallback((count?: number) => setAppBadge(count), []);
}

export interface HomeframeLogoutOptions {
  privateCaches?: boolean;
  notificationSubscription?: boolean;
  checkpoints?: boolean;
}

/**
 * Clears only Homeframe/app-authorized state. It never clears unrelated origin
 * storage, caches, cookies, or browser data.
 */
export function useHomeframeLogout() {
  const { serviceWorker, config } = useHomeframe();
  return useCallback(async (options: HomeframeLogoutOptions = {}) => {
    const {
      privateCaches = true,
      notificationSubscription = true,
      checkpoints = true,
    } = options;
    const failures: unknown[] = [];
    if (privateCaches) {
      try { await serviceWorker?.purgePrivateCaches(); }
      catch (reason) { failures.push(reason); }
    }
    if (notificationSubscription && 'serviceWorker' in navigator) {
      try {
        // `navigator.serviceWorker.ready` intentionally never rejects and can
        // remain pending forever when an app is not currently registered.
        // Logout cleanup must be bounded, so only inspect a registration that
        // already exists for this document.
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager?.getSubscription();
        if (subscription) {
          const notificationConfig = config.notifications;
          let transport: PushSubscriptionTransport | null = null;
          if (notificationConfig && notificationConfig.transport) {
            transport = 'upsert' in notificationConfig.transport
              ? notificationConfig.transport
              : createHttpPushSubscriptionTransport(notificationConfig.transport);
          }
          try { await transport?.remove(subscription.endpoint); }
          catch (reason) { failures.push(reason); }
          try { await subscription.unsubscribe(); }
          catch (reason) { failures.push(reason); }
        }
      } catch (reason) { failures.push(reason); }
    }
    if (checkpoints) {
      try { clearHomeframeCheckpoints(); }
      catch (reason) { failures.push(reason); }
    }
    window.dispatchEvent(new Event('homeframe:logout'));
    if (failures.length) throw new AggregateError(failures, 'Homeframe logout cleanup was incomplete.');
  }, [config.notifications, serviceWorker]);
}

export function clearHomeframeCheckpoints(): void {
  if (typeof window === 'undefined') return;
  for (const storage of [localStorage, sessionStorage]) {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith('hf:checkpoint:')) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  }
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
  function HomeframeInput(props, ref) {
    return <input {...props} ref={ref} data-hf-input="" />;
  },
);

export const HomeframeTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function HomeframeTextarea(props, ref) {
    return <textarea {...props} ref={ref} data-hf-input="" />;
  },
);

export const HomeframeSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function HomeframeSelect(props, ref) {
    return <select {...props} ref={ref} data-hf-input="" />;
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
  let target: Storage | null = null;
  try {
    if (typeof window !== 'undefined') target = storage === 'local' ? localStorage : sessionStorage;
  } catch {
    // Accessing the storage property itself can throw in restricted contexts.
  }
  const read = (): T => {
    try {
      const stored = target?.getItem(storageKey);
      return stored == null ? initialValue : deserialize(stored);
    } catch {
      return initialValue;
    }
  };
  const [checkpoint, setCheckpoint] = useState(() => ({ storageKey, storage, target, value: read() }));
  const matches = checkpoint.storageKey === storageKey
    && checkpoint.storage === storage && checkpoint.target === target;
  const current = matches ? checkpoint : { storageKey, storage, target, value: read() };
  // Restore during render so neither children nor a persistence effect can
  // observe the old draft under the new identity, even for one commit.
  if (!matches) setCheckpoint(current);
  useEffect(() => {
    try {
      current.target?.setItem(current.storageKey, serialize(current.value));
    } catch {
      // Storage may be unavailable or full. The in-memory state remains valid.
    }
  }, [serialize, current]);
  const setValue = useCallback<React.Dispatch<React.SetStateAction<T>>>((update) => {
    setCheckpoint((previous) => {
      // An asynchronous callback belonging to another draft cannot edit this one.
      if (previous.storageKey !== storageKey || previous.storage !== storage || previous.target !== target) return previous;
      const value = typeof update === 'function'
        ? (update as (value: T) => T)(previous.value)
        : update;
      return Object.is(value, previous.value) ? previous : { ...previous, value };
    });
  }, [storageKey, storage, target]);
  return [current.value, setValue];
}
