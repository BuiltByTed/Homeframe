export type HomeframeEventName =
  | 'viewport-change'
  | 'input-zoom-risk'
  | 'lifecycle-change'
  | 'install-capability-change'
  | 'notification-capability-change'
  | 'service-worker-change'
  | 'update-change'
  | 'diagnostic';

export interface HomeframeRuntimeEvent<T = unknown> {
  name: HomeframeEventName;
  at: number;
  detail: T;
}

type RuntimeListener = (event: HomeframeRuntimeEvent) => void;

const listeners = new Set<RuntimeListener>();
const recentEvents: HomeframeRuntimeEvent[] = [];
const MAX_RECENT_EVENTS = 200;

export function emitRuntimeEvent<T>(name: HomeframeEventName, detail: T): void {
  const event: HomeframeRuntimeEvent<T> = { name, at: Date.now(), detail };
  recentEvents.push(event);
  if (recentEvents.length > MAX_RECENT_EVENTS) recentEvents.shift();
  for (const listener of listeners) listener(event);
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
