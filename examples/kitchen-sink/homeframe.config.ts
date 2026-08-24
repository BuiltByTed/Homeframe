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
    backgroundColorDark: '#020617',
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
  serviceWorker: {
    documentFallback: '/',
    navigationDeny: ['/api/', '/__homeframe/recovery'],
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
      },
    ],
    notifications: {
      defaultTitle: 'Homeframe',
      defaultBody: 'The example app sent a notification.',
      defaultIcon: '/generated/notification-icon.png',
      defaultBadge: '/generated/notification-badge.png',
      routeAllowlist: ['/', '/pwa', '/keyboard', '/history'],
    },
  },
});
