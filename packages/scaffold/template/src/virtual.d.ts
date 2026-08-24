declare module 'virtual:homeframe/config' {
  import type { HomeframeAppConfig } from '@builtbyted/homeframe/vite';
  import type { ServiceWorkerClientConfig } from '@builtbyted/homeframe/sw';
  import type { HomeframeReactConfig } from '@builtbyted/homeframe/react';
  import type { HomeframeRouterOptions } from '@builtbyted/homeframe/router';

  const config: {
    app: HomeframeAppConfig;
    buildId: string;
    react: HomeframeReactConfig;
    router: HomeframeRouterOptions;
    serviceWorker: ServiceWorkerClientConfig | false;
  };
  export default config;
}
