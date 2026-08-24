import { defineHomeframe } from '@builtbyted/vite';

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
    themeColor: '#dbeafe',
    themeColorDark: '#0f172a',
    backgroundColor: '#dbeafe',
    backgroundColorDark: '#0f172a',
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
