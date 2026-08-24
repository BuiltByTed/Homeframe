import { defineHomeframe } from '@homeframe/vite';

const configuredBase = process.env.HOMEFRAME_BASE_PATH ?? '/';
const scope = `/${configuredBase.replace(/^\/+|\/+$/g, '')}${configuredBase === '/' ? '' : '/'}`;
const appPath = (path = '/') => path === '/'
  ? scope
  : `${scope}${path.replace(/^\/+/, '')}`;
const staticDemo = process.env.VITE_HOMEFRAME_STATIC_DEMO === 'true';

export default defineHomeframe({
  app: {
    id: scope,
    name: 'Homeframe Kitchen Sink',
    shortName: 'Homeframe',
    description: 'A hands-on test app for safe areas, keyboards, routing, offline use, updates, installation, and notifications.',
    startUrl: scope,
    scope,
    display: 'standalone',
    themeColor: '#dbeafe',
    themeColorDark: '#020617',
    // iOS 26 paints a native standalone scene inset below the WebKit document.
    // Match the dock surface so it continues behind the Home indicator.
    backgroundColor: '#e8f0ff',
    backgroundColorDark: '#0b1429',
    colorScheme: 'system',
    icon: './brand/icon.svg',
    maskableIcon: './brand/icon.svg',
    lang: 'en-US',
    categories: ['productivity', 'utilities'],
    shortcuts: [
      { name: 'Keyboard Lab', shortName: 'Keyboard', url: appPath('/keyboard') },
      { name: 'PWA Controls', shortName: 'PWA', url: appPath('/pwa') },
    ],
  },
  splash: {
    title: 'Homeframe',
    logo: './brand/icon.svg',
    generateAppleStartupImages: true,
    appleStatusBarStyle: 'black',
  },
  viewport: {
    selection: 'controls-only',
    snapshot: 'brand',
    bottomDock: 'avoid',
    strictInputZoom: true,
  },
  router: {
    historyMode: 'auto',
    edgeNavigation: { edgeWidth: 24, commitDistance: 88 },
  },
  nudges: {
    policyVersion: 1,
    install: { minSessions: 1, minEngagedMs: 0, cooldownDays: 1, maxImpressions: 10 },
    notifications: { minSessions: 1, minEngagedMs: 0, cooldownDays: 1, maxImpressions: 10 },
  },
  diagnostics: { queryParameter: 'homeframe-debug' },
  security: {
    // The example server replaces this token per HTML response and sends the
    // matching CSP header. Production adapters should do the same at the edge.
    cspNonce: '__HOMEFRAME_CSP_NONCE__',
  },
  serviceWorker: {
    documentFallback: scope,
    navigationDeny: [appPath('/api/')],
    navigationTimeoutSeconds: 2,
    cacheRevisionSalt: process.env.HOMEFRAME_CACHE_SALT ?? '',
    cleanupOutdated: true,
    update: { mode: 'automatic', reload: 'safe-point' },
    runtimeCaching: [
      {
        match: appPath('/demo-images/'),
        matchType: 'prefix',
        strategy: 'stale-while-revalidate',
        cacheName: 'demo-images',
        maxEntries: 24,
        maxAgeSeconds: 7 * 24 * 60 * 60,
        statuses: [200],
        responseTypes: ['basic'],
        sensitiveData: 'none',
      },
    ],
    notifications: {
      ...(process.env.VITE_VAPID_PUBLIC_KEY ? {
        applicationServerKey: process.env.VITE_VAPID_PUBLIC_KEY,
      } : {}),
      ...(!staticDemo ? { subscriptionTransport: appPath('/api/push/subscriptions') } : {}),
      defaultTitle: 'Homeframe',
      defaultBody: 'The example app sent a notification.',
      defaultIcon: appPath('/generated/notification-icon.png'),
      defaultBadge: appPath('/generated/notification-badge.png'),
      routeAllowlist: [scope, appPath('/pwa'), appPath('/keyboard'), appPath('/history')],
    },
  },
});
