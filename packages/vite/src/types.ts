import type { Plugin } from 'vite';
import type {
  NotificationWorkerConfig,
  SerializableRuntimeCacheRule,
  UpdateMode,
} from '@homeframe/sw';

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
  lang?: string;
  categories?: string[];
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
  runtimeCaching?: SerializableRuntimeCacheRule[];
  cacheRevisionSalt?: string;
  cleanupOutdated?: boolean;
  legacyNamesToDelete?: string[];
  update?: {
    mode?: UpdateMode;
    reload?: 'safe-point' | 'immediate';
  };
  notifications?: NotificationWorkerConfig | false;
}

export interface HomeframeSecurityConfig {
  cspNonce?: string;
}

export interface HomeframeConfig {
  app: HomeframeAppConfig;
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
