import type {
  ServiceWorkerClientConfig,
  ServiceWorkerSnapshot,
  UpdateGuard,
} from './types.js';

interface UpdateCoordinationMessage {
  type: 'ready' | 'safe-state' | 'activating' | 'current';
  sender: string;
  buildId: string | null;
  safe?: boolean;
  at: number;
}

interface PeerSafeState {
  buildId: string | null;
  safe: boolean;
  at: number;
}

const serverSnapshot: ServiceWorkerSnapshot = {
  state: 'unsupported',
  currentBuild: null,
  availableBuild: null,
  error: null,
  registration: null,
  guardCount: 0,
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
  private checkPromise: Promise<void> | null = null;
  private updateGeneration = 0;
  private redundantWorkerTimer: number | null = null;
  private readonly clientId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  private coordinationChannel: BroadcastChannel | null = null;
  private coordinationStorageKey = '';
  private activationLeaseKey = '';
  private peerSafeStates = new Map<string, PeerSafeState>();

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
    this.startCoordination(signal);
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
        attributeFilter: [
          'data-hf-keyboard',
          'data-hf-modal',
          'data-hf-prompt',
          'data-hf-critical-task',
          'data-hf-router-ready',
          'data-hf-ready',
        ],
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
    if (this.redundantWorkerTimer !== null) window.clearTimeout(this.redundantWorkerTimer);
    this.redundantWorkerTimer = null;
    this.rootObserver?.disconnect();
    this.rootObserver = null;
    this.coordinationChannel?.close();
    this.coordinationChannel = null;
    this.peerSafeStates.clear();
    this.releaseActivationLease();
  }

  registerGuard(guard: UpdateGuard): () => void {
    this.guards.add(guard);
    this.publish({ guardCount: this.guards.size });
    return () => {
      this.guards.delete(guard);
      this.publish({ guardCount: this.guards.size });
      this.scheduleSafePointRetry();
    };
  }

  check(): Promise<void> {
    if (this.checkPromise) return this.checkPromise;
    const promise = this.performCheck();
    this.checkPromise = promise;
    const clearCheck = () => {
      if (this.checkPromise === promise) this.checkPromise = null;
    };
    void promise.then(clearCheck, clearCheck);
    return promise;
  }

  private async performCheck(): Promise<void> {
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
    if (this.snapshot.state === 'activating') return;
    const waiting = this.registration?.waiting;
    if (!waiting) return;
    this.publish({ state: 'activating' });
    this.broadcastCoordination('activating', this.snapshot.availableBuild);
    waiting.postMessage({ type: 'HF_SKIP_WAITING' });
  }

  defer(): void {
    if (this.snapshot.state === 'ready') this.publish({ state: 'deferred' });
  }

  async purgeRuntimeCache(cacheName: string): Promise<void> {
    const worker = this.registration?.active ?? navigator.serviceWorker.controller;
    if (!worker) return;
    await this.postMessageWithAck(worker, { type: 'HF_PURGE_RUNTIME', cacheName });
  }

  async purgePrivateCaches(): Promise<void> {
    const worker = this.registration?.active ?? navigator.serviceWorker.controller;
    if (!worker) return;
    await this.postMessageWithAck(worker, { type: 'HF_PURGE_PRIVATE' });
  }

  private observeRegistration(registration: ServiceWorkerRegistration): void {
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      const generation = ++this.updateGeneration;
      const activeAtStart = registration.active;
      if (this.redundantWorkerTimer !== null) {
        window.clearTimeout(this.redundantWorkerTimer);
        this.redundantWorkerTimer = null;
      }
      this.publish({ state: 'downloading', error: null });
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          this.onWaiting(registration.waiting ?? installing);
        } else if (installing.state === 'redundant') {
          this.followReplacementWorker(registration, installing, activeAtStart, generation);
        }
      });
    });
  }

  private followReplacementWorker(
    registration: ServiceWorkerRegistration,
    redundant: ServiceWorker,
    activeAtStart: ServiceWorker | null,
    generation: number,
  ): void {
    if (this.redundantWorkerTimer !== null) window.clearTimeout(this.redundantWorkerTimer);
    // Browsers make a losing candidate redundant during overlapping update
    // checks and cross-tab races. Give the registration one task window to
    // expose the winning worker before treating redundancy as an install error.
    this.redundantWorkerTimer = window.setTimeout(() => {
      this.redundantWorkerTimer = null;
      if (generation !== this.updateGeneration) return;
      const waiting = registration.waiting;
      if (waiting && waiting !== redundant) {
        this.onWaiting(waiting);
        return;
      }
      const replacement = registration.installing;
      if (replacement && replacement !== redundant) {
        if (replacement.state === 'installed' && navigator.serviceWorker.controller) {
          this.onWaiting(registration.waiting ?? replacement);
        } else {
          this.publish({ state: 'downloading', error: null });
        }
        return;
      }
      if (registration.active && registration.active !== activeAtStart) {
        void this.queryBuild(registration.active).then((buildId) => {
          this.publish({ state: 'current', currentBuild: buildId, availableBuild: null, error: null });
          this.broadcastCoordination('current', buildId);
        });
        return;
      }
      this.publish({ state: 'failed', error: 'The new service worker became redundant.' });
    }, 200);
  }

  private onWaiting(worker: ServiceWorker): void {
    void this.queryBuild(worker).then((buildId) => {
      this.publish({ state: 'ready', availableBuild: buildId });
      this.broadcastCoordination('ready', buildId);
      void this.maybeActivate();
    });
  }

  private async maybeActivate(): Promise<void> {
    if (this.config.mode !== 'automatic') return;
    if (this.config.reload === 'immediate') {
      await this.activateAsLeader();
      return;
    }
    const safe = await this.isSafePoint();
    this.broadcastCoordination('safe-state', this.snapshot.availableBuild, safe);
    if (!safe) {
      this.publish({ state: 'deferred' });
      return;
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 90));
    const stillSafe = await this.isSafePoint();
    this.broadcastCoordination('safe-state', this.snapshot.availableBuild, stillSafe);
    if (!stillSafe || this.hasUnsafePeer(this.snapshot.availableBuild)) {
      this.publish({ state: 'deferred' });
      return;
    }
    await this.activateAsLeader();
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
    if (document.documentElement.dataset.hfCriticalTask) return false;
    if (document.documentElement.dataset.hfRouterReady === 'false') return false;
    if (document.documentElement.dataset.hfReady !== 'true') return false;
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
        this.broadcastCoordination('current', buildId);
      });
      return;
    }
    if (this.didReload || !this.config.reloadOnActivate) return;
    this.didReload = true;
    this.broadcastCoordination('current', this.snapshot.availableBuild);
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
      this.broadcastCoordination('current', message.buildId ?? null);
    } else if (message.type === 'HF_NOTIFICATION_ROUTE' && typeof message.route === 'string') {
      window.dispatchEvent(new CustomEvent('homeframe:notification-route', {
        detail: { route: message.route },
      }));
    } else if (message.type === 'HF_PUSH_SUBSCRIPTION_CHANGE') {
      window.dispatchEvent(new CustomEvent('homeframe:push-subscription-change', {
        detail: {
          oldEndpoint: typeof message.oldEndpoint === 'string' ? message.oldEndpoint : null,
          subscription: message.subscription ?? null,
        },
      }));
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

  private postMessageWithAck(worker: ServiceWorker, message: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timeout = window.setTimeout(() => reject(new Error('The service worker did not acknowledge the purge request.')), 2_000);
      channel.port1.onmessage = (event) => {
        window.clearTimeout(timeout);
        channel.port1.close();
        if (event.data?.ok) resolve();
        else reject(new Error(event.data?.error ?? 'The service worker rejected the purge request.'));
      };
      worker.postMessage(message, [channel.port2]);
    });
  }

  private startCoordination(signal: AbortSignal): void {
    const channelSuffix = this.config.scope.replace(/[^a-zA-Z0-9_-]+/g, '-') || 'app';
    this.coordinationStorageKey = `hf:update:${channelSuffix}:message`;
    this.activationLeaseKey = `hf:update:${channelSuffix}:leader`;
    if ('BroadcastChannel' in globalThis) {
      this.coordinationChannel = new BroadcastChannel(`homeframe-update-${channelSuffix}`);
      this.coordinationChannel.addEventListener('message', (event) => {
        this.receiveCoordination(event.data);
      }, { signal });
    }
    window.addEventListener('storage', (event) => {
      if (event.key !== this.coordinationStorageKey || !event.newValue) return;
      try {
        this.receiveCoordination(JSON.parse(event.newValue));
      } catch {
        // Ignore malformed values from unrelated app code sharing the origin.
      }
    }, { signal });
  }

  private broadcastCoordination(
    type: UpdateCoordinationMessage['type'],
    buildId: string | null,
    safe?: boolean,
  ): void {
    const message: UpdateCoordinationMessage = {
      type,
      sender: this.clientId,
      buildId,
      ...(safe === undefined ? {} : { safe }),
      at: Date.now(),
    };
    this.coordinationChannel?.postMessage(message);
    try {
      localStorage.setItem(this.coordinationStorageKey, JSON.stringify(message));
    } catch {
      // BroadcastChannel remains available in storage-restricted contexts.
    }
  }

  private receiveCoordination(value: unknown): void {
    if (!isCoordinationMessage(value) || value.sender === this.clientId) return;
    if (value.type === 'safe-state' && typeof value.safe === 'boolean') {
      this.peerSafeStates.set(value.sender, {
        buildId: value.buildId,
        safe: value.safe,
        at: value.at,
      });
      if (value.safe) this.scheduleSafePointRetry();
    } else if (value.type === 'ready') {
      if (this.snapshot.state === 'current') {
        this.publish({ state: 'ready', availableBuild: value.buildId });
      }
      void this.maybeActivate();
    } else if (value.type === 'activating') {
      this.publish({ state: 'activating', availableBuild: value.buildId });
    } else if (value.type === 'current') {
      this.publish({ state: 'current', currentBuild: value.buildId, availableBuild: null });
    }
  }

  private hasUnsafePeer(buildId: string | null): boolean {
    const cutoff = Date.now() - 30_000;
    for (const [id, peer] of this.peerSafeStates) {
      if (peer.at < cutoff) {
        this.peerSafeStates.delete(id);
        continue;
      }
      if (peer.buildId === buildId && !peer.safe) return true;
    }
    return false;
  }

  private async activateAsLeader(): Promise<void> {
    const locks = (navigator as Navigator & {
      locks?: {
        request<T>(
          name: string,
          options: { ifAvailable: true; mode: 'exclusive' },
          callback: (lock: unknown | null) => Promise<T>,
        ): Promise<T>;
      };
    }).locks;
    if (locks) {
      await locks.request(this.activationLeaseKey, { ifAvailable: true, mode: 'exclusive' }, async (lock) => {
        if (lock) await this.activate();
      });
      return;
    }
    if (!this.claimActivationLease()) return;
    await this.activate();
  }

  private claimActivationLease(): boolean {
    const now = Date.now();
    try {
      const current = JSON.parse(localStorage.getItem(this.activationLeaseKey) ?? 'null') as {
        owner?: string;
        expires?: number;
      } | null;
      if (current?.owner && current.owner !== this.clientId && (current.expires ?? 0) > now) return false;
      const lease = { owner: this.clientId, expires: now + 15_000 };
      localStorage.setItem(this.activationLeaseKey, JSON.stringify(lease));
      const confirmed = JSON.parse(localStorage.getItem(this.activationLeaseKey) ?? 'null') as { owner?: string } | null;
      return confirmed?.owner === this.clientId;
    } catch {
      return true;
    }
  }

  private releaseActivationLease(): void {
    if (!this.activationLeaseKey) return;
    try {
      const current = JSON.parse(localStorage.getItem(this.activationLeaseKey) ?? 'null') as { owner?: string } | null;
      if (current?.owner === this.clientId) localStorage.removeItem(this.activationLeaseKey);
    } catch {
      // Storage is an optional fallback.
    }
  }

  private publish(patch: Partial<ServiceWorkerSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch, revision: this.snapshot.revision + 1 };
    for (const listener of this.listeners) listener();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('homeframe:update-change', { detail: this.snapshot }));
    }
  }
}

function isCoordinationMessage(value: unknown): value is UpdateCoordinationMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<UpdateCoordinationMessage>;
  return ['ready', 'safe-state', 'activating', 'current'].includes(message.type ?? '')
    && typeof message.sender === 'string'
    && (message.buildId === null || typeof message.buildId === 'string')
    && typeof message.at === 'number'
    && Number.isFinite(message.at);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
