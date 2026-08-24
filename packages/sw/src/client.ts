import type {
  ServiceWorkerClientConfig,
  ServiceWorkerSnapshot,
  UpdateGuard,
} from './types.js';

const serverSnapshot: ServiceWorkerSnapshot = {
  state: 'unsupported',
  currentBuild: null,
  availableBuild: null,
  error: null,
  registration: null,
  revision: 0,
};

export class HomeframeServiceWorkerClient {
  private config: Required<ServiceWorkerClientConfig>;
  private snapshot: ServiceWorkerSnapshot = serverSnapshot;
  private listeners = new Set<() => void>();
  private guards = new Set<UpdateGuard>();
  private registration: ServiceWorkerRegistration | null = null;
  private abortController: AbortController | null = null;
  private intervalId: number | null = null;
  private lastCheckAt = 0;
  private didReload = false;
  private hadControllerAtStart = false;
  private safePointTimer: number | null = null;
  private rootObserver: MutationObserver | null = null;

  constructor(config: ServiceWorkerClientConfig = {}) {
    this.config = {
      url: config.url ?? '/sw.js',
      scope: config.scope ?? '/',
      mode: config.mode ?? 'automatic',
      reload: config.reload ?? 'safe-point',
      checkOnLaunch: config.checkOnLaunch ?? true,
      checkOnForeground: config.checkOnForeground ?? true,
      foregroundMinimumAgeMs: config.foregroundMinimumAgeMs ?? 60 * 60 * 1000,
      intervalMinutes: config.intervalMinutes ?? 0,
      reloadOnActivate: config.reloadOnActivate ?? true,
    };
  }

  getSnapshot = (): ServiceWorkerSnapshot => this.snapshot;
  getServerSnapshot = (): ServiceWorkerSnapshot => serverSnapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async start(): Promise<() => void> {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      this.publish({ state: 'unsupported' });
      return () => undefined;
    }
    if (this.abortController) return () => this.stop();
    this.abortController = new AbortController();
    const { signal } = this.abortController;
    this.hadControllerAtStart = Boolean(navigator.serviceWorker.controller);
    this.publish({ state: 'registering', error: null });
    try {
      this.registration = await navigator.serviceWorker.register(this.config.url, {
        scope: this.config.scope,
        updateViaCache: 'none',
      });
      this.publish({
        state: 'current',
        registration: this.registration,
        currentBuild: await this.queryBuild(navigator.serviceWorker.controller),
      });
      this.observeRegistration(this.registration);
      navigator.serviceWorker.addEventListener('controllerchange', () => this.onControllerChange(), {
        signal,
      });
      navigator.serviceWorker.addEventListener('message', (event) => this.onMessage(event), {
        signal,
      });
      window.addEventListener('online', () => void this.check(), { signal });
      const retrySafePoint = () => this.scheduleSafePointRetry();
      window.addEventListener('homeframe:viewport-change', retrySafePoint, { signal });
      window.addEventListener('homeframe:route-change', retrySafePoint, { signal });
      window.addEventListener('transitionend', retrySafePoint, { signal });
      window.addEventListener('focusout', retrySafePoint, { signal });
      window.addEventListener('homeframe:update-safe-point', retrySafePoint, { signal });
      this.rootObserver = new MutationObserver(retrySafePoint);
      this.rootObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-hf-keyboard', 'data-hf-modal', 'data-hf-prompt'],
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible'
          && this.config.checkOnForeground
          && Date.now() - this.lastCheckAt >= this.config.foregroundMinimumAgeMs) {
          void this.check();
        }
        if (document.visibilityState === 'visible' && this.snapshot.state === 'deferred') {
          void this.maybeActivate();
        }
      }, { signal });

      if (this.registration.waiting) this.onWaiting(this.registration.waiting);
      if (this.config.checkOnLaunch) void this.check();
      if (this.config.intervalMinutes > 0) {
        this.intervalId = window.setInterval(() => {
          if (document.visibilityState === 'visible') void this.check();
        }, this.config.intervalMinutes * 60_000);
      }
    } catch (error) {
      this.publish({ state: 'failed', error: errorMessage(error) });
    }
    return () => this.stop();
  }

  stop(): void {
    this.abortController?.abort();
    this.abortController = null;
    if (this.intervalId !== null) window.clearInterval(this.intervalId);
    this.intervalId = null;
    if (this.safePointTimer !== null) window.clearTimeout(this.safePointTimer);
    this.safePointTimer = null;
    this.rootObserver?.disconnect();
    this.rootObserver = null;
  }

  registerGuard(guard: UpdateGuard): () => void {
    this.guards.add(guard);
    return () => {
      this.guards.delete(guard);
      this.scheduleSafePointRetry();
    };
  }

  async check(): Promise<void> {
    if (!this.registration) return;
    this.lastCheckAt = Date.now();
    this.publish({ state: 'checking', error: null });
    try {
      await this.registration.update();
      if (!this.registration.installing && !this.registration.waiting) {
        this.publish({ state: 'current' });
      }
    } catch (error) {
      this.publish({ state: 'failed', error: errorMessage(error) });
    }
  }

  async activate(): Promise<void> {
    const waiting = this.registration?.waiting;
    if (!waiting) return;
    this.publish({ state: 'activating' });
    waiting.postMessage({ type: 'HF_SKIP_WAITING' });
  }

  defer(): void {
    if (this.snapshot.state === 'ready') this.publish({ state: 'deferred' });
  }

  async purgeRuntimeCache(cacheName: string): Promise<void> {
    const worker = this.registration?.active ?? navigator.serviceWorker.controller;
    worker?.postMessage({ type: 'HF_PURGE_RUNTIME', cacheName });
  }

  private observeRegistration(registration: ServiceWorkerRegistration): void {
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      this.publish({ state: 'downloading' });
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          this.onWaiting(registration.waiting ?? installing);
        } else if (installing.state === 'redundant') {
          this.publish({ state: 'failed', error: 'The new service worker became redundant.' });
        }
      });
    });
  }

  private onWaiting(worker: ServiceWorker): void {
    void this.queryBuild(worker).then((buildId) => {
      this.publish({ state: 'ready', availableBuild: buildId });
      void this.maybeActivate();
    });
  }

  private async maybeActivate(): Promise<void> {
    if (this.config.mode !== 'automatic') return;
    if (this.config.reload === 'immediate') {
      await this.activate();
      return;
    }
    const safe = await this.isSafePoint();
    if (safe) await this.activate();
    else this.publish({ state: 'deferred' });
  }

  private scheduleSafePointRetry(): void {
    if (this.snapshot.state !== 'deferred' || this.config.mode !== 'automatic') return;
    if (this.safePointTimer !== null) window.clearTimeout(this.safePointTimer);
    this.safePointTimer = window.setTimeout(() => {
      this.safePointTimer = null;
      void this.maybeActivate();
    }, 120);
  }

  private async isSafePoint(): Promise<boolean> {
    if (document.visibilityState !== 'visible') return false;
    if (document.documentElement.dataset.hfKeyboard !== 'closed') return false;
    if (document.documentElement.dataset.hfModal === 'open') return false;
    if (document.documentElement.dataset.hfPrompt === 'open') return false;
    for (const guard of this.guards) {
      try {
        if (!await guard()) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  private onControllerChange(): void {
    if (!this.hadControllerAtStart && this.snapshot.state !== 'activating') {
      this.hadControllerAtStart = true;
      void this.queryBuild(navigator.serviceWorker.controller).then((buildId) => {
        this.publish({ state: 'current', currentBuild: buildId, availableBuild: null });
      });
      return;
    }
    if (this.didReload || !this.config.reloadOnActivate) return;
    this.didReload = true;
    this.publish({ state: 'reloading' });
    window.location.reload();
  }

  private onMessage(event: MessageEvent): void {
    const message = event.data ?? {};
    if (message.type === 'HF_UPDATE_READY') {
      this.publish({ state: 'ready', availableBuild: message.buildId ?? null });
      void this.maybeActivate();
    } else if (message.type === 'HF_ACTIVATED') {
      this.publish({ state: 'current', currentBuild: message.buildId ?? null });
    } else if (message.type === 'HF_NOTIFICATION_ROUTE' && typeof message.route === 'string') {
      window.dispatchEvent(new CustomEvent('homeframe:notification-route', {
        detail: { route: message.route },
      }));
    } else if (message.type === 'HF_PUSH_SUBSCRIPTION_CHANGE') {
      window.dispatchEvent(new Event('homeframe:push-subscription-change'));
    } else if (message.type === 'HF_NOTIFICATION_CLOSE') {
      window.dispatchEvent(new CustomEvent('homeframe:notification-close', {
        detail: { tag: typeof message.tag === 'string' ? message.tag : null },
      }));
    }
  }

  private queryBuild(worker: ServiceWorker | null): Promise<string | null> {
    if (!worker) return Promise.resolve(null);
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      const timeout = window.setTimeout(() => resolve(null), 800);
      channel.port1.onmessage = (event) => {
        window.clearTimeout(timeout);
        resolve(event.data?.buildId ?? null);
      };
      worker.postMessage({ type: 'HF_GET_VERSION' }, [channel.port2]);
    });
  }

  private publish(patch: Partial<ServiceWorkerSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch, revision: this.snapshot.revision + 1 };
    for (const listener of this.listeners) listener();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('homeframe:update-change', { detail: this.snapshot }));
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
