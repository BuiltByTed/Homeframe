import { emitRuntimeEvent } from './events.js';

export type AppLifecyclePhase = 'booting' | 'visible' | 'hidden' | 'restoring';

export interface LifecycleSnapshot {
  phase: AppLifecyclePhase;
  pageShowPersisted: boolean;
  lastHiddenAt: number | null;
  lastVisibleAt: number | null;
  revision: number;
}

const serverSnapshot: LifecycleSnapshot = {
  phase: 'booting',
  pageShowPersisted: false,
  lastHiddenAt: null,
  lastVisibleAt: null,
  revision: 0,
};

export class LifecycleController {
  private snapshot: LifecycleSnapshot = serverSnapshot;
  private listeners = new Set<() => void>();
  private abortController: AbortController | null = null;

  getSnapshot = (): LifecycleSnapshot => this.snapshot;
  getServerSnapshot = (): LifecycleSnapshot => serverSnapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(): () => void {
    if (typeof window === 'undefined') return () => undefined;
    if (this.abortController) return () => this.stop();
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    window.addEventListener('pageshow', (event) => {
      this.publish({
        phase: event.persisted ? 'restoring' : 'visible',
        pageShowPersisted: event.persisted,
        lastVisibleAt: Date.now(),
      });
      if (event.persisted) requestAnimationFrame(() => this.publish({ phase: 'visible' }));
    }, { signal });
    window.addEventListener('pagehide', () => {
      this.publish({ phase: 'hidden', lastHiddenAt: Date.now() });
    }, { signal });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.publish({ phase: 'hidden', lastHiddenAt: Date.now() });
      } else {
        this.publish({ phase: 'restoring', lastVisibleAt: Date.now() });
        requestAnimationFrame(() => this.publish({ phase: 'visible' }));
      }
    }, { signal });

    this.publish({
      phase: document.visibilityState === 'hidden' ? 'hidden' : 'visible',
      lastVisibleAt: document.visibilityState === 'visible' ? Date.now() : null,
    });
    return () => this.stop();
  }

  stop(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  private publish(patch: Partial<LifecycleSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch, revision: this.snapshot.revision + 1 };
    for (const listener of this.listeners) listener();
    emitRuntimeEvent('lifecycle-change', this.snapshot);
  }
}

let defaultLifecycleController: LifecycleController | null = null;

export function getLifecycleController(): LifecycleController {
  defaultLifecycleController ??= new LifecycleController();
  return defaultLifecycleController;
}
