export type HomeframeEventName =
  | 'viewport-change'
  | 'input-zoom-risk'
  | 'lifecycle-change'
  | 'install-capability-change'
  | 'notification-capability-change'
  | 'service-worker-change'
  | 'update-change'
  | 'route-change'
  | 'resume-duration'
  | 'update-deferral'
  | 'worker-failure'
  | 'route-recovery'
  | 'install-outcome'
  | 'notification-outcome'
  | 'scroll-to-top'
  | 'diagnostic';

export interface HomeframeRuntimeEvent<T = unknown> {
  name: HomeframeEventName;
  at: number;
  detail: T;
}

type RuntimeListener = (event: HomeframeRuntimeEvent) => void;
export type HomeframeTelemetryAdapter = (event: HomeframeRuntimeEvent) => void | Promise<void>;

const listeners = new Set<RuntimeListener>();
const recentEvents: HomeframeRuntimeEvent[] = [];
const MAX_RECENT_EVENTS = 200;
let telemetryAdapter: HomeframeTelemetryAdapter | null = null;

export function emitRuntimeEvent<T>(name: HomeframeEventName, detail: T): void {
  const event: HomeframeRuntimeEvent<T> = { name, at: Date.now(), detail };
  recentEvents.push(event);
  if (recentEvents.length > MAX_RECENT_EVENTS) recentEvents.shift();
  for (const listener of listeners) listener(event);
  if (telemetryAdapter) {
    try {
      void Promise.resolve(telemetryAdapter(event)).catch((reason) => {
        console.error('[Homeframe HF_TELEMETRY_ADAPTER] Telemetry adapter rejected an event.', reason);
      });
    } catch (reason) {
      console.error('[Homeframe HF_TELEMETRY_ADAPTER] Telemetry adapter threw while handling an event.', reason);
    }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(`homeframe:${name}`, { detail }));
  }
}

export function subscribeRuntimeEvents(listener: RuntimeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRecentRuntimeEvents(): readonly HomeframeRuntimeEvent[] {
  return recentEvents;
}

/**
 * Explicitly opts local runtime events into an app-owned transport. Homeframe
 * never installs an adapter or performs network I/O by default.
 */
export function registerHomeframeTelemetryAdapter(
  adapter: HomeframeTelemetryAdapter,
): () => void {
  telemetryAdapter = adapter;
  return () => {
    if (telemetryAdapter === adapter) telemetryAdapter = null;
  };
}
