import { beforeEach, describe, expect, it } from 'vitest';
import { HomeframeServiceWorkerClient } from '@homeframe/sw';

class FakeWorker extends EventTarget {
  skipWaitingMessages = 0;

  postMessage(message: unknown, transfer?: Transferable[]): void {
    const value = message as { type?: string };
    if (value.type === 'HF_SKIP_WAITING') this.skipWaitingMessages += 1;
    if (value.type === 'HF_GET_VERSION') {
      const port = transfer?.[0] as MessagePort | undefined;
      port?.postMessage({ type: 'HF_VERSION', buildId: 'build-next' });
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
  document.documentElement.dataset.hfReady = 'true';
  document.documentElement.dataset.hfKeyboard = 'closed';
  delete document.documentElement.dataset.hfModal;
  delete document.documentElement.dataset.hfPrompt;
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

describe('HomeframeServiceWorkerClient multi-client coordination', () => {
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
