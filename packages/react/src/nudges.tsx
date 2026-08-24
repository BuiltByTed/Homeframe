import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import {
  emitRuntimeEvent,
  getInstallController,
  type InstallInstructions,
  type InstallState,
} from '@homeframe/runtime';
import {
  createHttpPushSubscriptionTransport,
  decodeApplicationServerKey,
  type HttpPushSubscriptionTransportOptions,
  type PushSubscriptionTransport,
} from '@homeframe/sw';
import { useHomeframe } from './context.js';

export interface NudgePolicy {
  enabled?: boolean;
  minSessions?: number;
  minEngagedMs?: number;
  cooldownDays?: number;
  maxImpressions?: number;
  routes?: string[];
  requiresNetwork?: boolean;
}

export interface NudgeStorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface HomeframeNudgeConfig {
  install?: NudgePolicy;
  notifications?: NudgePolicy;
  storageKeyPrefix?: string;
  policyVersion?: string | number;
  storage?: NudgeStorageAdapter;
}

interface NudgeRecord {
  impressions: number;
  lastShownAt: number | null;
  snoozedUntil: number | null;
  permanent: boolean;
  success: boolean;
  policyVersion: string;
}

type NudgeKind = 'install' | 'notifications';

interface NudgeContextValue {
  config: Required<Pick<HomeframeNudgeConfig, 'storageKeyPrefix'>> & HomeframeNudgeConfig;
  sessions: number;
  engagedMs: number;
  records: Record<NudgeKind, NudgeRecord>;
  candidates: Record<NudgeKind, boolean>;
  activeImpressions: Record<NudgeKind, boolean>;
  criticalTasks: readonly string[];
  setCandidate(kind: NudgeKind, value: boolean): void;
  registerCriticalTask(name: string): () => void;
  eligible(kind: NudgeKind, policy?: NudgePolicy): boolean;
  impression(kind: NudgeKind): void;
  dismiss(kind: NudgeKind, permanent?: boolean): void;
  snooze(kind: NudgeKind, days?: number): void;
  success(kind: NudgeKind): void;
}

const emptyRecord = (policyVersion = '1'): NudgeRecord => ({
  impressions: 0,
  lastShownAt: null,
  snoozedUntil: null,
  permanent: false,
  success: false,
  policyVersion,
});

const NudgeContext = createContext<NudgeContextValue | null>(null);

export function HomeframeNudgeProvider({
  config = {},
  children,
}: PropsWithChildren<{ config?: HomeframeNudgeConfig }>) {
  const resolved = useMemo(() => ({
    storageKeyPrefix: 'hf:nudges',
    policyVersion: '1',
    ...config,
  }), [config]);
  const policyVersion = String(resolved.policyVersion);
  const [sessions, setSessions] = useState(1);
  const [engagedMs, setEngagedMs] = useState(0);
  const [records, setRecords] = useState<Record<NudgeKind, NudgeRecord>>({
    install: emptyRecord(policyVersion),
    notifications: emptyRecord(policyVersion),
  });
  const [candidates, setCandidates] = useState<Record<NudgeKind, boolean>>({
    install: false,
    notifications: false,
  });
  const [activeImpressions, setActiveImpressions] = useState<Record<NudgeKind, boolean>>({
    install: false,
    notifications: false,
  });
  const [criticalTasks, setCriticalTasks] = useState<readonly string[]>([]);
  const [, refreshPolicy] = useState(0);

  useEffect(() => {
    const refresh = () => refreshPolicy((value) => value + 1);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    window.addEventListener('homeframe:route-change', refresh);
    window.addEventListener('homeframe:viewport-change', refresh);
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [
        'data-hf-ready',
        'data-hf-keyboard',
        'data-hf-nudges',
        'data-hf-modal',
        'data-hf-prompt',
        'data-hf-error',
      ],
    });
    return () => {
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
      window.removeEventListener('homeframe:route-change', refresh);
      window.removeEventListener('homeframe:viewport-change', refresh);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (criticalTasks.length > 0) {
      document.documentElement.dataset.hfCriticalTask = String(criticalTasks.length);
    } else {
      delete document.documentElement.dataset.hfCriticalTask;
      window.dispatchEvent(new Event('homeframe:update-safe-point'));
    }
    return () => {
      delete document.documentElement.dataset.hfCriticalTask;
    };
  }, [criticalTasks.length]);

  useEffect(() => {
    const prefix = resolved.storageKeyPrefix;
    try {
      const todayKey = `${prefix}:session:${new Date().toISOString().slice(0, 10)}`;
      const storage = resolved.storage ?? localStorage;
      const count = Number(storage.getItem(`${prefix}:sessions`) ?? '0');
      const isNew = sessionStorage.getItem(todayKey) !== '1';
      const nextCount = isNew ? count + 1 : Math.max(1, count);
      if (isNew) {
        sessionStorage.setItem(todayKey, '1');
        storage.setItem(`${prefix}:sessions`, String(nextCount));
      }
      setSessions(nextCount);
      setRecords({
        install: readRecord(storage, `${prefix}:install`, policyVersion),
        notifications: readRecord(storage, `${prefix}:notifications`, policyVersion),
      });
    } catch {
      // Privacy modes may make storage unavailable.
    }
    let accumulated = 0;
    let visibleStartedAt = document.visibilityState === 'visible' ? performance.now() : null;
    const updateEngagement = () => {
      const current = visibleStartedAt === null
        ? accumulated
        : accumulated + performance.now() - visibleStartedAt;
      setEngagedMs(current);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        visibleStartedAt ??= performance.now();
      } else if (visibleStartedAt !== null) {
        accumulated += performance.now() - visibleStartedAt;
        visibleStartedAt = null;
      }
      updateEngagement();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') updateEngagement();
    }, 1000);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(timer);
    };
  }, [policyVersion, resolved.storage, resolved.storageKeyPrefix]);

  const write = useCallback((kind: NudgeKind, updater: (record: NudgeRecord) => NudgeRecord) => {
    setRecords((current) => {
      const next = { ...current, [kind]: updater(current[kind]) };
      try {
        (resolved.storage ?? localStorage).setItem(`${resolved.storageKeyPrefix}:${kind}`, JSON.stringify(next[kind]));
      } catch {
        // The record remains in memory.
      }
      return next;
    });
  }, [resolved.storage, resolved.storageKeyPrefix]);

  const setCandidate = useCallback((kind: NudgeKind, value: boolean) => {
    setCandidates((current) => current[kind] === value ? current : { ...current, [kind]: value });
    if (!value) {
      setActiveImpressions((current) => current[kind]
        ? { ...current, [kind]: false }
        : current);
    }
  }, []);

  const baseEligible = useCallback((kind: NudgeKind, policy: NudgePolicy = {}) => {
    const defaults = kind === 'install'
      ? { enabled: true, minSessions: 2, minEngagedMs: 30_000, cooldownDays: 7, maxImpressions: 3, requiresNetwork: false }
      : { enabled: true, minSessions: 2, minEngagedMs: 45_000, cooldownDays: 30, maxImpressions: 2, requiresNetwork: true };
    const resolvedPolicy = { ...defaults, ...policy };
    const record = records[kind];
    if (!resolvedPolicy.enabled || !candidates[kind] || record.permanent || record.success) return false;
    if (typeof document !== 'undefined' && (
      document.visibilityState !== 'visible'
      || document.documentElement.dataset.hfReady !== 'true'
      || document.documentElement.dataset.hfKeyboard !== 'closed'
      || document.documentElement.dataset.hfNudges === 'suppress'
      || document.documentElement.dataset.hfModal === 'open'
      || document.documentElement.dataset.hfPrompt === 'open'
      || document.documentElement.dataset.hfError === 'true'
      || criticalTasks.length > 0
      || (resolvedPolicy.requiresNetwork && !navigator.onLine)
    )) return false;
    // Recording the impression starts a live presentation. Cooldown and count
    // limits apply the next time policy is evaluated in a new presentation,
    // not one render later while the current nudge is still on screen.
    if (activeImpressions[kind]) return true;
    const pathname = typeof location === 'undefined' ? '/' : location.pathname;
    if (resolvedPolicy.routes?.length && !resolvedPolicy.routes.some((route) => routeMatches(pathname, route))) return false;
    if (sessions < resolvedPolicy.minSessions || engagedMs < resolvedPolicy.minEngagedMs) return false;
    if (record.impressions >= resolvedPolicy.maxImpressions) return false;
    if (record.snoozedUntil && record.snoozedUntil > Date.now()) return false;
    if (record.lastShownAt
      && Date.now() - record.lastShownAt < resolvedPolicy.cooldownDays * 86_400_000) return false;
    return true;
  }, [activeImpressions, candidates, criticalTasks.length, engagedMs, records, sessions]);

  const eligible = useCallback((kind: NudgeKind, policy: NudgePolicy = {}) => {
    if (!baseEligible(kind, policy)) return false;
    if (kind === 'notifications' && baseEligible('install', resolved.install)) return false;
    return true;
  }, [baseEligible, resolved.install]);

  const registerCriticalTask = useCallback((name: string) => {
    const token = `${name}:${crypto.randomUUID?.() ?? Math.random().toString(36)}`;
    setCriticalTasks((current) => [...current, token]);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      setCriticalTasks((current) => current.filter((item) => item !== token));
    };
  }, []);

  const value = useMemo<NudgeContextValue>(() => ({
    config: resolved,
    sessions,
    engagedMs,
    records,
    candidates,
    activeImpressions,
    criticalTasks,
    setCandidate,
    registerCriticalTask,
    eligible,
    impression: (kind) => {
      setActiveImpressions((current) => current[kind]
        ? current
        : { ...current, [kind]: true });
      write(kind, (record) => ({
        ...record,
        impressions: record.lastShownAt && Date.now() - record.lastShownAt < 5_000
          ? record.impressions
          : record.impressions + 1,
        lastShownAt: Date.now(),
      }));
    },
    dismiss: (kind, permanent = false) => {
      setActiveImpressions((current) => ({ ...current, [kind]: false }));
      write(kind, (record) => ({
        ...record,
        permanent,
        snoozedUntil: permanent ? null : Date.now() + 7 * 86_400_000,
      }));
    },
    snooze: (kind, days = 7) => {
      setActiveImpressions((current) => ({ ...current, [kind]: false }));
      write(kind, (record) => ({
        ...record,
        snoozedUntil: Date.now() + days * 86_400_000,
      }));
    },
    success: (kind) => {
      setActiveImpressions((current) => ({ ...current, [kind]: false }));
      write(kind, (record) => ({ ...record, success: true }));
    },
  }), [activeImpressions, candidates, criticalTasks, eligible, engagedMs, records, registerCriticalTask, resolved, sessions, setCandidate, write]);

  return <NudgeContext.Provider value={value}>{children}</NudgeContext.Provider>;
}

function readRecord(storage: NudgeStorageAdapter, key: string, policyVersion: string): NudgeRecord {
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? 'null') as Partial<NudgeRecord> | null;
    if (!parsed) return emptyRecord(policyVersion);
    if (parsed.policyVersion !== policyVersion) {
      return {
        ...emptyRecord(policyVersion),
        permanent: parsed.permanent ?? false,
        success: parsed.success ?? false,
      };
    }
    return { ...emptyRecord(policyVersion), ...parsed, policyVersion };
  } catch {
    return emptyRecord(policyVersion);
  }
}

function routeMatches(pathname: string, route: string): boolean {
  return route.endsWith('*') ? pathname.startsWith(route.slice(0, -1)) : pathname === route;
}

export function useNudgeCoordinator() {
  const context = useContext(NudgeContext);
  if (!context) throw new Error('Nudge hooks require <HomeframeNudgeProvider>.');
  return context;
}

export interface InstallCapabilityResult {
  state: InstallState;
  platformHint: 'ios' | 'chromium' | 'other';
  instructions: InstallInstructions | null;
  installed: boolean;
  eligible: boolean;
  blockers: string[];
  prompt(): Promise<'accepted' | 'dismissed' | 'instructions-required'>;
  recordImpression(): void;
  dismiss(options?: { permanent?: boolean }): void;
  snooze(days?: number): void;
}

export function useInstallCapability(): InstallCapabilityResult {
  const controller = getInstallController();
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getServerSnapshot);
  const nudges = useNudgeCoordinator();
  const candidate = snapshot.state === 'native-prompt-ready' || snapshot.state === 'manual-instructions';
  useEffect(() => nudges.setCandidate('install', candidate), [candidate, nudges]);
  const policy = nudges.config.install;
  const isEligible = nudges.eligible('install', policy);
  return {
    ...snapshot,
    eligible: isEligible,
    blockers: snapshot.installed ? ['installed'] : candidate ? [] : [snapshot.state],
    prompt: async () => {
      const result = await controller.prompt();
      if (result === 'accepted') nudges.success('install');
      else if (result === 'dismissed') nudges.snooze('install');
      return result;
    },
    recordImpression: () => nudges.impression('install'),
    dismiss: (options) => nudges.dismiss('install', options?.permanent),
    snooze: (days) => nudges.snooze('install', days),
  };
}

export type NotificationCapabilityState =
  | 'checking'
  | 'requires-install'
  | 'unsupported'
  | 'default'
  | 'requesting'
  | 'denied'
  | 'granted-unsubscribed'
  | 'subscribed'
  | 'error';

export interface NotificationCapabilityResult {
  state: NotificationCapabilityState;
  eligible: boolean;
  permission: NotificationPermission | 'unsupported';
  subscription: PushSubscription | null;
  blockers: string[];
  error: string | null;
  requestAndSubscribe(): Promise<'subscribed' | 'denied' | 'error'>;
  unsubscribe(): Promise<void>;
  recordImpression(): void;
  dismiss(options?: { permanent?: boolean }): void;
  snooze(days?: number): void;
}

export function useNotificationCapability(): NotificationCapabilityResult {
  const { config } = useHomeframe();
  const install = getInstallController();
  const installSnapshot = useSyncExternalStore(install.subscribe, install.getSnapshot, install.getServerSnapshot);
  const nudges = useNudgeCoordinator();
  const [state, setState] = useState<NotificationCapabilityState>('checking');
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notificationConfig = config.notifications;
  const supported = typeof window !== 'undefined'
    && 'Notification' in window
    && 'serviceWorker' in navigator
    && 'PushManager' in window;
  const requiresInstall = installSnapshot.platformHint === 'ios' && !installSnapshot.installed;

  const transport = useMemo(() => {
    if (!notificationConfig || !notificationConfig.transport) return null;
    return 'upsert' in notificationConfig.transport
      ? notificationConfig.transport
      : createHttpPushSubscriptionTransport(notificationConfig.transport);
  }, [notificationConfig]);

  useEffect(() => {
    let active = true;
    if (!notificationConfig || !supported) {
      setState('unsupported');
      return;
    }
    if (requiresInstall) {
      setState('requires-install');
      return;
    }
    if (Notification.permission === 'denied') {
      setState('denied');
      return;
    }
    const reconcile = () => navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then(async (existing) => {
        if (!active) return;
        if (existing) await transport?.upsert(existing.toJSON());
        if (!active) return;
        setSubscription(existing);
        setState(existing ? 'subscribed'
          : Notification.permission === 'granted' ? 'granted-unsubscribed' : 'default');
      }).catch((reason) => {
        if (!active) return;
        setError(errorMessage(reason));
        setState('error');
      });
    void reconcile();
    const onRotation = (event: Event) => {
      const oldEndpoint = (event as CustomEvent<{ oldEndpoint?: string | null }>).detail?.oldEndpoint;
      if (oldEndpoint) void transport?.remove(oldEndpoint).catch(() => undefined);
      void reconcile();
    };
    window.addEventListener('homeframe:push-subscription-change', onRotation);
    return () => {
      active = false;
      window.removeEventListener('homeframe:push-subscription-change', onRotation);
    };
  }, [notificationConfig, requiresInstall, supported, transport]);

  const candidate = state === 'default' || state === 'granted-unsubscribed';
  useEffect(() => nudges.setCandidate('notifications', candidate), [candidate, nudges]);
  useEffect(() => {
    emitRuntimeEvent('notification-capability-change', {
      state,
      permission: supported ? Notification.permission : 'unsupported',
      requiresInstall,
      hasSubscription: Boolean(subscription),
      error,
    });
  }, [error, requiresInstall, state, subscription, supported]);

  const requestAndSubscribe = useCallback(async () => {
    if (!supported || !notificationConfig || requiresInstall) return 'error' as const;
    setState('requesting');
    setError(null);
    try {
      const permissionPromise = Notification.permission === 'default'
        ? Notification.requestPermission()
        : Promise.resolve(Notification.permission);
      const permission = await permissionPromise;
      if (permission !== 'granted') {
        setState('denied');
        nudges.dismiss('notifications', true);
        emitRuntimeEvent('notification-outcome', { outcome: 'denied' });
        return 'denied' as const;
      }
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscriptionOptions: PushSubscriptionOptionsInit = {
        userVisibleOnly: true,
        ...(notificationConfig.applicationServerKey ? {
          applicationServerKey: decodeApplicationServerKey(notificationConfig.applicationServerKey),
        } : {}),
      };
      const next = existing ?? await registration.pushManager.subscribe(subscriptionOptions);
      await transport?.upsert(next.toJSON());
      setSubscription(next);
      setState('subscribed');
      nudges.success('notifications');
      emitRuntimeEvent('notification-outcome', { outcome: 'subscribed' });
      return 'subscribed' as const;
    } catch (reason) {
      setError(errorMessage(reason));
      setState('error');
      emitRuntimeEvent('notification-outcome', { outcome: 'error', error: errorMessage(reason) });
      return 'error' as const;
    }
  }, [notificationConfig, nudges, requiresInstall, supported, transport]);

  const unsubscribe = useCallback(async () => {
    if (!subscription) return;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    await transport?.remove(endpoint);
    setSubscription(null);
    setState(Notification.permission === 'granted' ? 'granted-unsubscribed' : 'default');
    emitRuntimeEvent('notification-outcome', { outcome: 'unsubscribed' });
  }, [subscription, transport]);

  const permission = supported ? Notification.permission : 'unsupported';
  return {
    state,
    permission,
    subscription,
    eligible: nudges.eligible('notifications', nudges.config.notifications),
    blockers: requiresInstall ? ['requires-install']
      : !supported ? ['unsupported']
        : state === 'denied' ? ['permission-denied'] : [],
    error,
    requestAndSubscribe,
    unsubscribe,
    recordImpression: () => nudges.impression('notifications'),
    dismiss: (options) => nudges.dismiss('notifications', options?.permanent),
    snooze: (days) => nudges.snooze('notifications', days),
  };
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
