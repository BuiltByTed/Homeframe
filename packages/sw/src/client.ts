import type {
  ServiceWorkerClientConfig,
  ServiceWorkerSnapshot,
  UpdateGuard,
} from './types.js';

interface UpdateCoordinationMessage {
  type: 'ready' | 'safe-state' | 'activating' | 'current' | 'closed';
  sender: string;
  clientId?: string;
  buildId: string | null;
  safe?: boolean;
  at: number;
}

interface PeerSafeState {
  clientId: string | null;
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

const initialSnapshot: ServiceWorkerSnapshot = {
  ...serverSnapshot,
  state: 'idle',
};

const UPDATE_RELOAD_MARKER_MAX_AGE_MS = 15_000;

function updateReloadMarkerKey(scope: string): string {
  return `hf:update-reload:${scope.replace(/[^a-zA-Z0-9_-]+/g, '-') || 'app'}`;
}

function readRecentUpdateReload(scope: string): boolean {
  try {
    const value = Number(sessionStorage.getItem(updateReloadMarkerKey(scope)));
    return Number.isFinite(value) && value > 0
      && Date.now() - value <= UPDATE_RELOAD_MARKER_MAX_AGE_MS;
  } catch {
    return false;
  }
}

function reloadViewportIsClosed(): boolean {
  const root = document.documentElement;
  if (root.dataset.hfKeyboard !== 'closed') return false;
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.matches(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
  )) return false;
  const visual = window.visualViewport;
  const scale = visual?.scale ?? 1;
  const visualBottom = (visual?.height ?? window.innerHeight) + (visual?.offsetTop ?? 0);
  if (scale > 1.01 || Math.abs(visualBottom - window.innerHeight) > 2) return false;
  if ((visual?.pageTop ?? 0) > 1 || window.scrollY !== 0) return false;
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const screenGap = window.screen.height - window.innerHeight;
  return !standalone || window.screen.height <= 0 || screenGap <= 96;
}

export class HomeframeServiceWorkerClient {
  private config: Required<ServiceWorkerClientConfig>;
  private snapshot: ServiceWorkerSnapshot = initialSnapshot;
  private listeners = new Set<() => void>();
  private guards = new Set<UpdateGuard>();
  private registration: ServiceWorkerRegistration | null = null;
  private abortController: AbortController | null = null;
  private intervalId: number | null = null;
  private lastCheckAt = 0;
  private didReload = false;
  private reloadPending = false;
  private reloadPromise: Promise<void> | null = null;
  private serviceWorkerClientId: string | null = null;
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
  private initialPresentationPending: boolean;
  private updateReloadRestorePending: boolean;

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
    this.initialPresentationPending = this.config.mode === 'automatic' && this.config.checkOnLaunch;
    this.updateReloadRestorePending = readRecentUpdateReload(this.config.scope);
  }

  getSnapshot = (): ServiceWorkerSnapshot => this.snapshot;
  getServerSnapshot = (): ServiceWorkerSnapshot => serverSnapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  /** True while an automatic launch update must finish behind the boot splash. */
  shouldHoldInitialPresentation = (): boolean => this.initialPresentationPending;
  /** True when the new document must prove stable viewport geometry before presentation. */
  shouldStabilizeUpdateReloadPresentation = (): boolean => this.updateReloadRestorePending;
  completeUpdateReloadPresentation = (): void => {
    this.updateReloadRestorePending = false;
    try { sessionStorage.removeItem(updateReloadMarkerKey(this.config.scope)); }
    catch { /* Session storage is optional. */ }
  };

  async start(): Promise<() => void> {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      this.releaseInitialPresentation();
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
      const registration = await navigator.serviceWorker.register(this.config.url, {
        scope: this.config.scope,
        updateViaCache: 'none',
      });
      if (signal.aborted) return () => undefined;
      this.registration = registration;
      const currentBuild = await this.queryBuild(navigator.serviceWorker.controller);
      if (signal.aborted) return () => undefined;
      this.publish({
        state: 'current',
        registration: this.registration,
        currentBuild,
      });
      this.observeRegistration(this.registration);
      navigator.serviceWorker.addEventListener('controllerchange', () => void this.onControllerChange(), {
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
          if (this.reloadPending) void this.maybeReload();
          else void this.maybeActivate();
        }
      }, { signal });

      const waitingAtLaunch = this.registration.waiting;
      if (waitingAtLaunch) await this.onWaiting(waitingAtLaunch);
      if (this.config.checkOnLaunch && !waitingAtLaunch) await this.check();
      if (signal.aborted) return () => undefined;
      if (this.config.intervalMinutes > 0) {
        this.intervalId = window.setInterval(() => {
          if (document.visibilityState === 'visible') void this.check();
        }, this.config.intervalMinutes * 60_000);
      }
    } catch (error) {
      if (!signal.aborted) this.publish({ state: 'failed', error: errorMessage(error) });
    }
    if (!['downloading', 'ready', 'activating', 'reloading'].includes(this.snapshot.state)) {
      this.releaseInitialPresentation();
    }
    return () => this.stop();
  }

  stop(): void {
    this.broadcastCoordination('closed', this.snapshot.availableBuild);
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
    if (this.snapshot.state === 'activating' || this.reloadPending || this.didReload) return;
    const registration = this.registration;
    const signal = this.abortController?.signal;
    const previousState = this.snapshot.state;
    const previousWaiting = registration.waiting;
    const preserveWaiting = Boolean(previousWaiting)
      && (previousState === 'ready' || previousState === 'deferred');
    this.lastCheckAt = Date.now();
    if (!preserveWaiting && !this.reloadPending && !this.didReload) this.publish({ state: 'checking', error: null });
    try {
      await registration.update();
      if (signal?.aborted || this.reloadPending || this.didReload || this.getSnapshot().state === 'activating') return;
      if (registration.waiting) {
        if (preserveWaiting && registration.waiting === previousWaiting) {
          this.publish({ state: previousState, error: null });
          this.scheduleSafePointRetry();
        } else {
          await this.onWaiting(registration.waiting);
        }
      } else if (registration.installing) {
        this.publish({ state: 'downloading', error: null });
      } else {
        this.publish({ state: 'current', availableBuild: null });
      }
    } catch (error) {
      if (!signal?.aborted && !this.reloadPending && !this.didReload) {
        this.publish({ state: preserveWaiting ? previousState : 'failed', error: errorMessage(error) });
      }
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
    const signal = this.abortController?.signal;
    if (!signal) return;
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
          void this.onWaiting(registration.waiting ?? installing);
        } else if (installing.state === 'redundant') {
          this.followReplacementWorker(registration, installing, activeAtStart, generation);
        }
      }, { signal });
    }, { signal });
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
        void this.onWaiting(waiting);
        return;
      }
      const replacement = registration.installing;
      if (replacement && replacement !== redundant) {
        if (replacement.state === 'installed' && navigator.serviceWorker.controller) {
          void this.onWaiting(registration.waiting ?? replacement);
        } else {
          this.publish({ state: 'downloading', error: null });
        }
        return;
      }
      if (registration.active && registration.active !== activeAtStart) {
        void this.queryBuild(registration.active).then((buildId) => {
          this.publish({ state: 'current', currentBuild: buildId, availableBuild: null, error: null });
          this.broadcastCoordination('current', buildId);
          this.releaseInitialPresentation();
        });
        return;
      }
      this.publish({ state: 'failed', error: 'The new service worker became redundant.' });
      this.releaseInitialPresentation();
    }, 200);
  }

  private async onWaiting(worker: ServiceWorker): Promise<void> {
    const signal = this.abortController?.signal;
    const buildId = await this.queryBuild(worker);
    if (signal?.aborted || this.reloadPending || this.didReload) return;
    this.publish({ state: 'ready', availableBuild: buildId });
    this.broadcastCoordination('ready', buildId);
    await this.maybeActivate();
    if (this.snapshot.state === 'deferred' || this.snapshot.state === 'failed') {
      this.releaseInitialPresentation();
    }
  }

  private async maybeActivate(): Promise<void> {
    const signal = this.abortController?.signal;
    if (this.reloadPending) return this.maybeReload();
    if (this.didReload) return;
    if (this.config.mode !== 'automatic') return;
    if (this.config.reload === 'immediate') {
      await this.activateAsLeader();
      return;
    }
    const safe = await this.isSafePoint();
    if (signal?.aborted) return;
    this.broadcastCoordination('safe-state', this.snapshot.availableBuild, safe);
    if (!safe) {
      this.publish({ state: 'deferred' });
      return;
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 90));
    const stillSafe = await this.isSafePoint();
    this.broadcastCoordination('safe-state', this.snapshot.availableBuild, stillSafe);
    if (!stillSafe || await this.hasUnsafePeer(this.snapshot.availableBuild)) {
      if (signal?.aborted) return;
      this.publish({ state: 'deferred' });
      return;
    }
    if (signal?.aborted) return;
    const finalSafe = await this.isSafePoint();
    this.broadcastCoordination('safe-state', this.snapshot.availableBuild, finalSafe);
    if (!finalSafe) {
      this.publish({ state: 'deferred' });
      return;
    }
    await this.activateAsLeader();
  }

  private scheduleSafePointRetry(): void {
    if (!this.reloadPending && (this.snapshot.state !== 'deferred' || this.config.mode !== 'automatic')) return;
    if (this.safePointTimer !== null) window.clearTimeout(this.safePointTimer);
    this.safePointTimer = window.setTimeout(() => {
      this.safePointTimer = null;
      if (this.reloadPending) void this.maybeReload();
      else void this.maybeActivate();
    }, 120);
  }

  private async isSafePoint(): Promise<boolean> {
    if (document.visibilityState !== 'visible') return false;
    if (document.documentElement.dataset.hfKeyboard !== 'closed') return false;
    if (!reloadViewportIsClosed()) return false;
    if (document.documentElement.dataset.hfModal === 'open') return false;
    if (document.documentElement.dataset.hfPrompt === 'open') return false;
    if (document.documentElement.dataset.hfCriticalTask) return false;
    if (document.documentElement.dataset.hfRouterReady === 'false') return false;
    // A launch-time update is safest before the first app frame is presented.
    // Router, keyboard, modal, task, and app guards still protect user state;
    // requiring hfReady here would force an app paint before the update reload.
    for (const guard of this.guards) {
      try {
        if (!await guard()) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  private async onControllerChange(): Promise<void> {
    if (!this.hadControllerAtStart && this.snapshot.state !== 'activating') {
      this.hadControllerAtStart = true;
      void this.queryBuild(navigator.serviceWorker.controller).then((buildId) => {
        this.publish({ state: 'current', currentBuild: buildId, availableBuild: null });
        this.broadcastCoordination('current', buildId);
        this.releaseInitialPresentation();
      });
      return;
    }
    if (!this.config.reloadOnActivate) {
      this.publish({ state: 'current', currentBuild: this.snapshot.availableBuild, availableBuild: null });
      this.releaseInitialPresentation();
      return;
    }
    if (this.didReload) return;
    this.reloadPending = true;
    await this.maybeReload();
  }

  private maybeReload(): Promise<void> {
    if (this.reloadPromise) return this.reloadPromise;
    const promise = this.performReload();
    this.reloadPromise = promise;
    const clear = () => { if (this.reloadPromise === promise) this.reloadPromise = null; };
    void promise.then(clear, clear);
    return promise;
  }

  private async performReload(): Promise<void> {
    if (!this.reloadPending || this.didReload) return;
    const signal = this.abortController?.signal;
    const defer = () => {
      delete document.documentElement.dataset.hfUpdateReload;
      this.completeUpdateReloadPresentation();
      this.publish({ state: 'deferred' });
      this.releaseInitialPresentation();
    };
    if (this.config.reload !== 'immediate' && !await this.isSafePoint()) {
      defer();
      return;
    }
    if (signal?.aborted) return;
    this.publish({ state: 'reloading' });
    await this.prepareUpdateReload();
    // Another tab may have activated while this tab was dirty. Each document
    // protects its own work, including changes made during viewport settlement.
    if (signal?.aborted) {
      delete document.documentElement.dataset.hfUpdateReload;
      this.completeUpdateReloadPresentation();
      return;
    }
    if (this.config.reload !== 'immediate' && !await this.isSafePoint()) {
      defer();
      return;
    }
    this.didReload = true;
    this.reloadPending = false;
    this.broadcastCoordination('current', this.snapshot.availableBuild);
    window.location.reload();
  }

  private async prepareUpdateReload(): Promise<void> {
    const root = document.documentElement;
    root.dataset.hfUpdateReload = 'preparing';
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.matches(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
    )) active.blur();
    if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);

    let stableFrames = 0;
    let previous = '';
    const deadline = performance.now() + 1_200;
    while (performance.now() < deadline && stableFrames < 3) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const visual = window.visualViewport;
      const signature = [
        visual?.width ?? window.innerWidth,
        visual?.height ?? window.innerHeight,
        visual?.offsetTop ?? 0,
        visual?.pageTop ?? 0,
        visual?.scale ?? 1,
        window.innerWidth,
        window.innerHeight,
      ].map((value) => Math.round(value * 10) / 10).join(':');
      if (reloadViewportIsClosed() && signature === previous) stableFrames += 1;
      else stableFrames = reloadViewportIsClosed() ? 1 : 0;
      previous = signature;
    }
    try {
      sessionStorage.setItem(updateReloadMarkerKey(this.config.scope), String(Date.now()));
    } catch {
      // The outgoing page still reloads safely when storage is unavailable.
    }
  }

  private onMessage(event: MessageEvent): void {
    const message = event.data ?? {};
    if (message.type === 'HF_UPDATE_READY') {
      this.publish({ state: 'ready', availableBuild: message.buildId ?? null });
      void this.maybeActivate();
    } else if (message.type === 'HF_ACTIVATED') {
      this.publish({ ...(this.reloadPending || this.didReload ? {} : { state: 'current' }), currentBuild: message.buildId ?? null });
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
      const timeout = window.setTimeout(() => { channel.port1.close(); resolve(null); }, 800);
      channel.port1.onmessage = (event) => {
        window.clearTimeout(timeout);
        channel.port1.close();
        if (typeof event.data?.clientId === 'string') this.serviceWorkerClientId = event.data.clientId;
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
    window.addEventListener('pagehide', (event) => {
      if (!event.persisted) this.broadcastCoordination('closed', this.snapshot.availableBuild);
    }, { signal });
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
      ...(this.serviceWorkerClientId ? { clientId: this.serviceWorkerClientId } : {}),
      buildId,
      ...(safe === undefined ? {} : { safe }),
      at: Date.now(),
    };
    this.coordinationChannel?.postMessage(message);
    try {
      if (this.coordinationStorageKey) localStorage.setItem(this.coordinationStorageKey, JSON.stringify(message));
    } catch {
      // BroadcastChannel remains available in storage-restricted contexts.
    }
  }

  private receiveCoordination(value: unknown): void {
    if (!isCoordinationMessage(value) || value.sender === this.clientId) return;
    if (value.type === 'safe-state' && typeof value.safe === 'boolean') {
      this.peerSafeStates.set(value.sender, {
        clientId: typeof value.clientId === 'string' ? value.clientId : null,
        buildId: value.buildId,
        safe: value.safe,
        at: value.at,
      });
      if (value.safe) this.scheduleSafePointRetry();
    } else if (value.type === 'closed') {
      this.peerSafeStates.delete(value.sender);
      this.scheduleSafePointRetry();
    } else if (value.type === 'ready') {
      if (this.snapshot.state === 'current') {
        this.publish({ state: 'ready', availableBuild: value.buildId });
      }
      void this.maybeActivate();
    } else if (value.type === 'activating') {
      if (!this.reloadPending && !this.didReload) this.publish({ state: 'activating', availableBuild: value.buildId });
    } else if (value.type === 'current') {
      if (!this.reloadPending && !this.didReload) this.publish({ state: 'current', currentBuild: value.buildId, availableBuild: null });
      this.releaseInitialPresentation();
    }
  }

  private async hasUnsafePeer(buildId: string | null): Promise<boolean> {
    const cutoff = Date.now() - 30_000;
    let liveClients: string[] | null | undefined;
    for (const [id, peer] of this.peerSafeStates) {
      if (peer.buildId !== buildId || peer.safe) continue;
      if (peer.at < cutoff && peer.clientId) {
        liveClients ??= await this.queryLiveClients();
        if (liveClients && !liveClients.includes(peer.clientId)) {
          this.peerSafeStates.delete(id);
          continue;
        }
      }
      // Age alone is not evidence that an unsaved tab has closed. Older
      // workers without the liveness protocol remain conservatively deferred.
      return true;
    }
    return false;
  }

  private queryLiveClients(): Promise<string[] | null> {
    const worker = this.registration?.active;
    if (!worker) return Promise.resolve(null);
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      const timeout = window.setTimeout(() => { channel.port1.close(); resolve(null); }, 800);
      channel.port1.onmessage = (event) => {
        window.clearTimeout(timeout);
        channel.port1.close();
        const ids: unknown = event.data?.clientIds;
        resolve(Array.isArray(ids) && ids.every((id) => typeof id === 'string') ? ids : null);
      };
      worker.postMessage({ type: 'HF_GET_CLIENT_IDS' }, [channel.port2]);
    });
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

  private releaseInitialPresentation(): void {
    if (!this.initialPresentationPending) return;
    this.initialPresentationPending = false;
    this.publish({});
  }
}

function isCoordinationMessage(value: unknown): value is UpdateCoordinationMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<UpdateCoordinationMessage>;
  return ['ready', 'safe-state', 'activating', 'current', 'closed'].includes(message.type ?? '')
    && typeof message.sender === 'string'
    && (message.buildId === null || typeof message.buildId === 'string')
    && typeof message.at === 'number'
    && Number.isFinite(message.at);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
