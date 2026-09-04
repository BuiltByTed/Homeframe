import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeframeServiceWorkerClient } from '@builtbyted/sw';

class FakeWorker extends EventTarget {
  skipWaitingMessages = 0;
  clientIds: string[] = ['live-tab'];
  state: ServiceWorkerState;

  constructor(state: ServiceWorkerState = 'installed') {
    super();
    this.state = state;
  }

  transition(state: ServiceWorkerState): void {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }

  postMessage(message: unknown, transfer?: Transferable[]): void {
    const value = message as { type?: string };
    if (value.type === 'HF_SKIP_WAITING') this.skipWaitingMessages += 1;
    if (value.type === 'HF_GET_VERSION') {
      const port = transfer?.[0] as MessagePort | undefined;
      port?.postMessage({ type: 'HF_VERSION', buildId: 'build-next' });
    }
    if (value.type === 'HF_GET_CLIENT_IDS') {
      const port = transfer?.[0] as MessagePort | undefined;
      port?.postMessage({ clientIds: this.clientIds });
    }
  }
}

class FakeRegistration extends EventTarget {
  waiting: FakeWorker | null;
  installing: FakeWorker | null = null;
  active: FakeWorker;

  constructor(worker: FakeWorker) {
    super();
    this.waiting = worker;
    this.active = worker;
  }

  async update(): Promise<void> {}
}

class FakeServiceWorkerContainer extends EventTarget {
  controller: FakeWorker;
  registration: FakeRegistration;

  constructor(worker: FakeWorker, registration: FakeRegistration) {
    super();
    this.controller = worker;
    this.registration = registration;
  }

  async register(): Promise<FakeRegistration> {
    return this.registration;
  }
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.dataset.hfReady = 'true';
  document.documentElement.dataset.hfKeyboard = 'closed';
  delete document.documentElement.dataset.hfModal;
  delete document.documentElement.dataset.hfPrompt;
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

describe('HomeframeServiceWorkerClient multi-client coordination', () => {
  it.each(['ready', 'deferred'] as const)('preserves a %s update across repeated checks', async (state) => {
    const worker = new FakeWorker();
    const registration = new FakeRegistration(worker);
    Object.defineProperty(navigator, 'serviceWorker', {
      value: new FakeServiceWorkerContainer(worker, registration), configurable: true,
    });
    const client = new HomeframeServiceWorkerClient({ mode: 'prompt', checkOnLaunch: false });
    try {
      await client.start();
      if (state === 'deferred') client.defer();
      await client.check();
      expect(client.getSnapshot()).toMatchObject({ state, availableBuild: 'build-next' });
      await client.activate();
      await client.check();
      expect(client.getSnapshot().state).toBe('activating');
      expect(worker.skipWaitingMessages).toBe(1);
    } finally { client.stop(); }
  });

  it('protects local work when another tab activates and rechecks guards after reload preparation', async () => {
    const worker = new FakeWorker();
    const registration = new FakeRegistration(worker);
    Object.defineProperty(navigator, 'serviceWorker', {
      value: new FakeServiceWorkerContainer(worker, registration), configurable: true,
    });
    const client = new HomeframeServiceWorkerClient({ mode: 'manual', reload: 'safe-point', checkOnLaunch: false });
    let safe = false;
    const guard = vi.fn(() => safe);
    client.registerGuard(guard);
    const prepare = vi.fn(async () => { safe = false; });
    client['prepareUpdateReload'] = prepare;
    try {
      await client.start();
      await client['onControllerChange']();
      expect(client.getSnapshot().state).toBe('deferred');
      expect(guard).toHaveBeenCalled();
      expect(prepare).not.toHaveBeenCalled();
      safe = true;
      window.dispatchEvent(new Event('homeframe:update-safe-point'));
      await delay(180);
      expect(prepare).toHaveBeenCalledOnce();
      expect(client.getSnapshot().state).toBe('deferred');
      expect(client['didReload']).toBe(false);
      expect(sessionStorage.getItem('hf:update-reload:-')).toBeNull();
    } finally { client.stop(); }
  });

  it('retains an old veto until the worker confirms that its client has closed', async () => {
    const worker = new FakeWorker();
    const registration = new FakeRegistration(worker);
    Object.defineProperty(navigator, 'serviceWorker', {
      value: new FakeServiceWorkerContainer(worker, registration), configurable: true,
    });
    const client = new HomeframeServiceWorkerClient({ mode: 'manual', checkOnLaunch: false });
    try {
      await client.start();
      client['receiveCoordination']({ type: 'safe-state', sender: 'peer', clientId: 'live-tab', buildId: 'build-next', safe: false, at: Date.now() - 31_000 });
      expect(await client['hasUnsafePeer']('build-next')).toBe(true);
      worker.clientIds = [];
      expect(await client['hasUnsafePeer']('build-next')).toBe(false);
      client['receiveCoordination']({ type: 'safe-state', sender: 'old-protocol', buildId: 'build-next', safe: false, at: Date.now() - 31_000 });
      expect(await client['hasUnsafePeer']('build-next')).toBe(true);
      client['receiveCoordination']({ type: 'closed', sender: 'old-protocol', buildId: 'build-next', at: Date.now() });
      expect(await client['hasUnsafePeer']('build-next')).toBe(false);
    } finally { client.stop(); }
  });

  it('carries an update-reload viewport stabilization marker into the new document', () => {
    sessionStorage.setItem('hf:update-reload:-restored-', String(Date.now()));
    const client = new HomeframeServiceWorkerClient({ scope: '/restored/' });
    expect(client.shouldStabilizeUpdateReloadPresentation()).toBe(true);
    client.completeUpdateReloadPresentation();
    expect(client.shouldStabilizeUpdateReloadPresentation()).toBe(false);
    expect(sessionStorage.getItem('hf:update-reload:-restored-')).toBeNull();
  });

  it('activates a launch-time waiting worker before the first app presentation', async () => {
    document.documentElement.dataset.hfReady = 'false';
    const worker = new FakeWorker();
    const registration = new FakeRegistration(worker);
    const container = new FakeServiceWorkerContainer(worker, registration);
    Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
    const client = new HomeframeServiceWorkerClient({ scope: '/launch-handoff/' });

    expect(client.shouldHoldInitialPresentation()).toBe(true);
    await client.start();
    expect(worker.skipWaitingMessages).toBe(1);
    expect(client.getSnapshot().state).toBe('activating');
    expect(client.shouldHoldInitialPresentation()).toBe(true);
    client.stop();
  });

  it('releases initial presentation when the launch check is current', async () => {
    const active = new FakeWorker('activated');
    const registration = new FakeRegistration(active);
    registration.waiting = null;
    const container = new FakeServiceWorkerContainer(active, registration);
    Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
    const client = new HomeframeServiceWorkerClient({ scope: '/launch-current/' });

    await client.start();
    expect(client.getSnapshot().state).toBe('current');
    expect(client.shouldHoldInitialPresentation()).toBe(false);
    client.stop();
  });

  it('follows a replacement worker when an overlapping update makes one candidate redundant', async () => {
    const active = new FakeWorker('activated');
    const registration = new FakeRegistration(active);
    registration.waiting = null;
    const container = new FakeServiceWorkerContainer(active, registration);
    Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
    const client = new HomeframeServiceWorkerClient({
      checkOnLaunch: false,
      mode: 'manual',
      scope: '/replacement-race/',
    });
    await client.start();

    const losing = new FakeWorker('installing');
    registration.installing = losing;
    registration.dispatchEvent(new Event('updatefound'));
    losing.transition('redundant');

    const winner = new FakeWorker('installing');
    registration.installing = winner;
    registration.dispatchEvent(new Event('updatefound'));
    registration.waiting = winner;
    winner.transition('installed');
    await delay(260);

    expect(client.getSnapshot().state).toBe('ready');
    expect(client.getSnapshot().error).toBeNull();
    client.stop();
  });

  it('still reports a redundant worker when no replacement wins the update', async () => {
    const active = new FakeWorker('activated');
    const registration = new FakeRegistration(active);
    registration.waiting = null;
    const container = new FakeServiceWorkerContainer(active, registration);
    Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
    const client = new HomeframeServiceWorkerClient({
      checkOnLaunch: false,
      mode: 'manual',
      scope: '/abandoned-update/',
    });
    await client.start();

    const abandoned = new FakeWorker('installing');
    registration.installing = abandoned;
    registration.dispatchEvent(new Event('updatefound'));
    registration.installing = null;
    abandoned.transition('redundant');
    await delay(260);

    expect(client.getSnapshot().state).toBe('failed');
    expect(client.getSnapshot().error).toBe('The new service worker became redundant.');
    client.stop();
  });

  it('waits for every live client safe point and elects one activation leader', async () => {
    const worker = new FakeWorker();
    const registration = new FakeRegistration(worker);
    const container = new FakeServiceWorkerContainer(worker, registration);
    Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });

    const first = new HomeframeServiceWorkerClient({ checkOnLaunch: false, scope: '/coordination/' });
    const second = new HomeframeServiceWorkerClient({ checkOnLaunch: false, scope: '/coordination/' });
    const releaseGuard = first.registerGuard(() => false);
    await Promise.all([first.start(), second.start()]);
    await delay(260);
    expect(worker.skipWaitingMessages).toBe(0);
    expect(first.getSnapshot().state).toBe('deferred');

    releaseGuard();
    window.dispatchEvent(new Event('homeframe:update-safe-point'));
    await delay(420);
    expect(worker.skipWaitingMessages).toBe(1);

    first.stop();
    second.stop();
  });

  it.each(['prompt', 'manual', 'on-restart'] as const)(
    '%s downloads a waiting worker without surprise activation',
    async (mode) => {
      const worker = new FakeWorker();
      const registration = new FakeRegistration(worker);
      const container = new FakeServiceWorkerContainer(worker, registration);
      Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
      const client = new HomeframeServiceWorkerClient({ checkOnLaunch: false, mode, scope: `/mode-${mode}/` });
      await client.start();
      await delay(80);
      expect(client.getSnapshot().state).toBe('ready');
      expect(worker.skipWaitingMessages).toBe(0);
      await client.activate();
      expect(worker.skipWaitingMessages).toBe(1);
      client.stop();
    },
  );

  it('automatic immediate activation requires no safe-point wait at runtime', async () => {
    document.documentElement.dataset.hfReady = 'false';
    document.documentElement.dataset.hfKeyboard = 'open';
    const worker = new FakeWorker();
    const registration = new FakeRegistration(worker);
    const container = new FakeServiceWorkerContainer(worker, registration);
    Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
    const client = new HomeframeServiceWorkerClient({
      checkOnLaunch: false,
      mode: 'automatic',
      reload: 'immediate',
      scope: '/mode-immediate/',
    });
    await client.start();
    await delay(80);
    expect(worker.skipWaitingMessages).toBe(1);
    client.stop();
  });

  it('rechecks local guards immediately before safe-point activation', async () => {
    const worker = new FakeWorker();
    const registration = new FakeRegistration(worker);
    const container = new FakeServiceWorkerContainer(worker, registration);
    Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
    const client = new HomeframeServiceWorkerClient({ checkOnLaunch: false, scope: '/settled-guard/' });
    let safe = true;
    client.registerGuard(() => safe);
    window.setTimeout(() => { safe = false; }, 40);
    await client.start();
    await delay(220);
    expect(worker.skipWaitingMessages).toBe(0);
    expect(client.getSnapshot().state).toBe('deferred');

    safe = true;
    window.dispatchEvent(new Event('homeframe:update-safe-point'));
    await delay(320);
    expect(worker.skipWaitingMessages).toBe(1);
    client.stop();
  });
});

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
