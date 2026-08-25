declare module 'virtual:homeframe/config' {
  import type { HomeframeAppConfig } from '@builtbyted/vite';
  import type { ServiceWorkerClientConfig } from '@builtbyted/sw';
  import type { HomeframeReactConfig } from '@builtbyted/react';
  import type { HomeframeRouterOptions } from '@builtbyted/router';

  const config: {
    app: HomeframeAppConfig;
    buildId: string;
    react: HomeframeReactConfig;
    router: HomeframeRouterOptions;
    serviceWorker: ServiceWorkerClientConfig | false;
  };
  export default config;
}

declare const __HOMEFRAME_VERSION__: string;
