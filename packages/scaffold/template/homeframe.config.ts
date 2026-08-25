import { defineHomeframe } from '@builtbyted/homeframe/vite';

export default defineHomeframe({
  app: {
    id: '/',
    name: __HOMEFRAME_APP_NAME_JSON__,
    shortName: __HOMEFRAME_APP_NAME_JSON__,
    description: 'A Homeframe-powered progressive web app.',
    startUrl: '/',
    scope: '/',
    display: 'standalone',
    colorScheme: 'system',
    themeColor: '#ffffff',
    themeColorDark: '#000000',
    backgroundColor: '#ffffff',
    backgroundColorDark: '#000000',
    icon: './brand/icon.svg',
    maskableIcon: './brand/icon.svg',
  },
  splash: {
    title: __HOMEFRAME_APP_NAME_JSON__,
    logo: './brand/icon.svg',
    generateAppleStartupImages: true,
    appleStatusBarStyle: 'black-translucent',
  },
  viewport: {
    selection: 'controls-only',
    snapshot: 'brand',
    bottomDock: 'avoid',
    strictInputZoom: true,
  },
  router: {
    historyMode: 'auto',
  },
  nudges: {
    install: { minSessions: 2, minEngagedMs: 30_000 },
    notifications: { enabled: false },
  },
  serviceWorker: {
    update: { mode: 'automatic', reload: 'safe-point' },
    notifications: false,
  },
});
