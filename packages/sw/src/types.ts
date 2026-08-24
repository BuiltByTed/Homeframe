export type UpdateMode = 'automatic' | 'prompt' | 'on-restart' | 'manual';
export type RuntimeStrategy =
  | 'network-only'
  | 'cache-only'
  | 'cache-first'
  | 'network-first'
  | 'stale-while-revalidate';

export interface PrecacheEntry {
  url: string;
  revision: string;
}

export interface SerializableRuntimeCacheRule {
  match: string;
  matchType?: 'prefix' | 'regex' | 'exact';
  strategy: RuntimeStrategy;
  cacheName: string;
  networkTimeoutSeconds?: number;
  maxEntries: number;
  maxAgeSeconds: number;
  statuses?: number[];
  responseTypes?: Response['type'][];
  /** Serve a cached full response as a single-range 206 response when requested. */
  rangeRequests?: boolean;
}

export interface NotificationWorkerConfig {
  defaultTitle?: string;
  defaultBody?: string;
  defaultIcon?: string;
  defaultBadge?: string;
  routeAllowlist?: string[];
}

export interface GeneratedWorkerConfig {
  appId: string;
  buildId: string;
  scope: string;
  documentFallback: string;
  navigationAllow?: string[];
  navigationDeny?: string[];
  navigationTimeoutSeconds?: number;
  precache: PrecacheEntry[];
  runtimeCaching?: SerializableRuntimeCacheRule[];
  cleanupOutdated?: boolean;
  legacyNamesToDelete?: string[];
  notifications?: NotificationWorkerConfig | false;
}

export type UpdateState =
  | 'unsupported'
  | 'idle'
  | 'registering'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'deferred'
  | 'activating'
  | 'reloading'
  | 'current'
  | 'failed';

export interface ServiceWorkerSnapshot {
  state: UpdateState;
  currentBuild: string | null;
  availableBuild: string | null;
  error: string | null;
  registration: ServiceWorkerRegistration | null;
  revision: number;
}

export interface ServiceWorkerClientConfig {
  url?: string;
  scope?: string;
  mode?: UpdateMode;
  reload?: 'safe-point' | 'immediate';
  checkOnLaunch?: boolean;
  checkOnForeground?: boolean;
  foregroundMinimumAgeMs?: number;
  intervalMinutes?: number;
  reloadOnActivate?: boolean;
}

export type UpdateGuard = () => boolean | Promise<boolean>;
