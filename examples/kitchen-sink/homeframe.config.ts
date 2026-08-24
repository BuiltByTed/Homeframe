import { defineHomeframe } from '@homeframe/vite';

export default defineHomeframe({
  app: {
    id: '/',
    name: 'Homeframe Kitchen Sink',
    shortName: 'Homeframe',
    description: 'A hands-on test app for safe areas, keyboards, routing, offline use, updates, installation, and notifications.',
    startUrl: '/',
    scope: '/',
    display: 'standalone',
    themeColor: '#172554',
    themeColorDark: '#020617',
    // iOS 26 paints a native standalone scene inset below the WebKit document.
    // Match the dock surface so it continues behind the Home indicator.
    backgroundColor: '#0b1429',
    backgroundColorDark: '#0b1429',
    colorScheme: 'dark',
    icon: './brand/icon.svg',
    maskableIcon: './brand/icon.svg',
    lang: 'en-US',
    categories: ['productivity', 'utilities'],
    shortcuts: [
      { name: 'Keyboard Lab', shortName: 'Keyboard', url: '/keyboard' },
      { name: 'PWA Controls', shortName: 'PWA', url: '/pwa' },
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
    documentFallback: '/',
    navigationDeny: ['/api/'],
    navigationTimeoutSeconds: 2,
    cacheRevisionSalt: process.env.HOMEFRAME_CACHE_SALT ?? '',
    cleanupOutdated: true,
    update: { mode: 'automatic', reload: 'safe-point' },
    runtimeCaching: [
      {
        match: '/demo-images/',
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
      subscriptionTransport: '/api/push/subscriptions',
      defaultTitle: 'Homeframe',
      defaultBody: 'The example app sent a notification.',
      defaultIcon: '/generated/notification-icon.png',
      defaultBadge: '/generated/notification-badge.png',
      routeAllowlist: ['/', '/pwa', '/keyboard', '/history'],
    },
  },
});
