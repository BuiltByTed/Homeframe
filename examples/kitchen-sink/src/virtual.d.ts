declare module 'virtual:homeframe/config' {
  import type { HomeframeAppConfig } from '@homeframe/vite';
  import type { ServiceWorkerClientConfig } from '@homeframe/sw';
  import type { HomeframeReactConfig } from '@homeframe/react';
  import type { HomeframeRouterOptions } from '@homeframe/router';

  const config: {
    app: HomeframeAppConfig;
    buildId: string;
    react: HomeframeReactConfig;
    router: HomeframeRouterOptions;
    serviceWorker: ServiceWorkerClientConfig | false;
  };
  export default config;
}
