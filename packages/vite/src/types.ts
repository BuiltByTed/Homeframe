import type { Plugin } from 'vite';
import type {
  NotificationWorkerConfig,
  SerializableRuntimeCacheRule,
  UpdateMode,
} from '@builtbyted/sw';

export interface HomeframePrivateCacheConfig {
  partitionKey(request: Request): string | Promise<string>;
  purgeOnLogout: true;
  /** Link, ticket, or short note documenting the account-switching threat review. */
  threatReview: string;
}

export interface HomeframeRuntimeCacheRule extends Omit<
  SerializableRuntimeCacheRule,
  'match' | 'matchType' | 'matchFlags' | 'matchFunctionSource' | 'sensitiveData'
> {
  match: string | RegExp | ((request: Request, url: URL) => boolean);
  matchType?: 'prefix' | 'regex' | 'exact';
  sensitiveData?: 'none' | HomeframePrivateCacheConfig;
}

export interface HomeframeAppConfig {
  id: string;
  name: string;
  shortName: string;
  description?: string;
  startUrl: string;
  scope: string;
  display?: 'standalone' | 'fullscreen' | 'minimal-ui';
  orientation?:
    | 'any'
    | 'natural'
    | 'landscape'
    | 'portrait'
    | 'portrait-primary'
    | 'portrait-secondary'
    | 'landscape-primary'
    | 'landscape-secondary';
  themeColor: string;
  themeColorDark?: string;
  backgroundColor: string;
  backgroundColorDark?: string;
  colorScheme?: 'system' | 'light' | 'dark';
  icon: string;
  maskableIcon?: string;
  appleTouchIcon?: string;
  lang?: string;
  categories?: string[];
  displayOverride?: Array<'window-controls-overlay' | 'fullscreen' | 'standalone' | 'minimal-ui' | 'browser'>;
  screenshots?: Array<{
    src: string;
    sizes: string;
    type?: string;
    formFactor?: 'narrow' | 'wide';
    label?: string;
  }>;
  shareTarget?: {
    action: string;
    method?: 'GET' | 'POST';
    enctype?: 'application/x-www-form-urlencoded' | 'multipart/form-data';
    params: { title?: string; text?: string; url?: string; files?: Array<{ name: string; accept: string[] }> };
  };
  protocolHandlers?: Array<{ protocol: string; url: string }>;
  shortcuts?: Array<{
    name: string;
    shortName?: string;
    description?: string;
    url: string;
    icon?: string;
  }>;
}

export interface HomeframeSplashConfig {
  enabled?: boolean;
  title?: string;
  logo?: string;
  generateAppleStartupImages?: boolean;
  appleStatusBarStyle?: 'default' | 'black' | 'black-translucent';
}

export interface HomeframePrecacheConfig {
  include?: RegExp[];
  exclude?: RegExp[];
  maximumFileSizeBytes?: number;
  additionalEntries?: Array<{ url: string; revision: string }>;
}

export interface HomeframeServiceWorkerBuildConfig {
  enabled?: boolean;
  fileName?: string;
  documentFallback?: string;
  navigationAllow?: string[];
  navigationDeny?: string[];
  navigationTimeoutSeconds?: number;
  precache?: HomeframePrecacheConfig;
  runtimeCaching?: HomeframeRuntimeCacheRule[];
  cacheRevisionSalt?: string;
  cleanupOutdated?: boolean;
  legacyNamesToDelete?: string[];
  update?: {
    mode?: UpdateMode;
    reload?: 'safe-point' | 'immediate';
    checkOnLaunch?: boolean;
    checkOnForeground?: boolean;
    foregroundMinimumAgeMs?: number;
    intervalMinutes?: number;
    reloadOnActivate?: boolean;
    /** Required when reload is immediate because update guards may be bypassed. */
    acceptDataLossRisk?: boolean;
  };
  notifications?: NotificationWorkerConfig | false;
}

export interface HomeframeSecurityConfig {
  cspNonce?: string;
}

export interface HomeframeViewportConfig {
  selection?: 'controls-only' | 'allow';
  snapshot?: 'preserve' | 'brand' | 'privacy';
  bottomDock?: 'avoid' | 'hide' | 'overlay' | 'manual';
  keyboardThresholdPx?: number;
  keyboardThresholdRatio?: number;
  inputZoomMinimumPx?: number;
  strictInputZoom?: boolean;
  settleDelaysMs?: number[];
  keyboardStabilizationMs?: number;
  keyboardOcclusion?: 'opaque' | 'transparent';
  topTapToTop?: boolean;
}

export interface HomeframeNudgePolicyConfig {
  enabled?: boolean;
  minSessions?: number;
  minEngagedMs?: number;
  cooldownDays?: number;
  maxImpressions?: number;
  routes?: string[];
  requiresNetwork?: boolean;
}

export interface HomeframeNudgesConfig {
  install?: HomeframeNudgePolicyConfig;
  notifications?: HomeframeNudgePolicyConfig;
  storageKeyPrefix?: string;
  policyVersion?: string | number;
}

export interface HomeframeRouterBuildConfig {
  historyMode?: 'auto' | 'browser' | 'managed';
  edgeNavigation?: boolean | { edgeWidth?: number; commitDistance?: number };
}

export interface HomeframeDiagnosticsConfig {
  enabled?: boolean;
  queryParameter?: string;
}

export interface HomeframeConfig {
  app: HomeframeAppConfig;
  viewport?: HomeframeViewportConfig;
  router?: HomeframeRouterBuildConfig;
  nudges?: HomeframeNudgesConfig;
  diagnostics?: HomeframeDiagnosticsConfig;
  splash?: HomeframeSplashConfig;
  serviceWorker?: HomeframeServiceWorkerBuildConfig | false;
  security?: HomeframeSecurityConfig;
}

export interface GeneratedHomeframeAsset {
  fileName: string;
  source: Uint8Array | string;
  mimeType: string;
  purpose: string;
  width?: number;
  height?: number;
}

export function defineHomeframe(config: HomeframeConfig): HomeframeConfig {
  return config;
}

export type HomeframeVitePlugin = (config: HomeframeConfig) => Plugin;
