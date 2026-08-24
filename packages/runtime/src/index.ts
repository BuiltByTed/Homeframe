export * from './events.js';
export * from './install.js';
export * from './lifecycle.js';
export * from './style-store.js';
export * from './viewport.js';

export interface HomeframeBuildInfo {
  appId: string;
  buildId: string;
  backgroundColor: string;
  serviceWorkerUrl: string | null;
  serviceWorkerScope: string;
  serviceWorkerConfig?: Record<string, unknown> | false;
  reactConfig?: Record<string, unknown>;
  routerConfig?: Record<string, unknown>;
}

declare global {
  interface Window {
    __HOMEFRAME_BUILD__?: HomeframeBuildInfo;
  }
}

export function getBuildInfo(): HomeframeBuildInfo | null {
  return typeof window === 'undefined' ? null : window.__HOMEFRAME_BUILD__ ?? null;
}
