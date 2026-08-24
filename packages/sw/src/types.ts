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
  matchType?: 'prefix' | 'regex' | 'exact' | 'function';
  matchFlags?: string;
  /** Build-generated source for a trusted configuration matcher. */
  matchFunctionSource?: string;
  strategy: RuntimeStrategy;
  cacheName: string;
  networkTimeoutSeconds?: number;
  maxEntries: number;
  maxAgeSeconds: number;
  maxResponseBytes?: number;
  statuses?: number[];
  responseTypes?: Response['type'][];
  /** Serve a cached full response as a single-range 206 response when requested. */
  rangeRequests?: boolean;
  sensitiveData?: 'none' | SerializablePrivateCacheConfig;
}

export interface SerializablePrivateCacheConfig {
  /** Build-generated source for the app's trusted partition function. */
  partitionKeySource: string;
  purgeOnLogout: true;
  /** A non-empty review reference is retained in build output for auditability. */
  threatReview: string;
}

export interface NotificationWorkerConfig {
  /** Public VAPID application-server key. Never configure the private key here. */
  applicationServerKey?: string;
  /** Same-origin idempotent PUT/DELETE endpoint used for rotation recovery. */
  subscriptionTransport?: string;
  defaultTitle?: string;
  defaultBody?: string;
  defaultIcon?: string;
  defaultBadge?: string;
  routeAllowlist?: string[];
  maximumPayloadBytes?: number;
}

export interface HomeframeNotificationPayloadV1 {
  version: 1;
  title?: string;
  body?: string;
  route?: string;
  icon?: string;
  badge?: string;
  image?: string;
  tag?: string;
  renotify?: boolean;
  silent?: boolean;
  requireInteraction?: boolean;
  badgeCount?: number;
  actions?: Array<{ action: string; title: string; icon?: string }>;
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
  revisionSalt?: string;
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
  guardCount: number;
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
