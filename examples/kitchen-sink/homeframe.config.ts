import { defineHomeframe } from '@builtbyted/vite';

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
    themeColor: '#e8f0ff',
    themeColorDark: '#0b1429',
    // Match the shell surface in every native scene and launch/resume frame.
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
    // Let the shell paint the top safe area so an in-app light/dark override
    // also updates the installed iOS status-bar surface.
    appleStatusBarStyle: 'black-translucent',
  },
  viewport: {
    selection: 'controls-only',
    snapshot: 'preserve',
    bottomDock: 'avoid',
    strictInputZoom: true,
  },
  router: {
    historyMode: 'auto',
    edgeNavigation: { edgeWidth: 24, commitDistance: 88 },
  },
  nudges: {
    // The kitchen sink deliberately re-presents the install education on each
    // fresh browser visit until it is dismissed; production apps can use a
    // longer cooldown. v3 clears the earlier demo cooldown record.
    policyVersion: 3,
    install: { minSessions: 1, minEngagedMs: 0, cooldownDays: 0, maxImpressions: 50 },
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
