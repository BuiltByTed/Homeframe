declare module 'virtual:homeframe/config' {
  import type { HomeframeAppConfig } from '@homeframe/vite';
  import type { ServiceWorkerClientConfig } from '@homeframe/sw';

  const config: {
    app: HomeframeAppConfig;
    buildId: string;
    serviceWorker: ServiceWorkerClientConfig | false;
  };
  export default config;
}
