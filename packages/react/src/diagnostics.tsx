import { useEffect, useState } from 'react';
import { getRecentRuntimeEvents, subscribeRuntimeEvents } from '@homeframe/runtime';
import { useAppLifecycle, useHomeframeUpdate, useKeyboard, useViewport } from './hooks.js';
import { useHomeframe } from './context.js';

export function HomeframeDiagnostics({
  visible: visibleProp,
  queryParameter,
}: {
  visible?: boolean;
  queryParameter?: string;
}) {
  const { config } = useHomeframe();
  const resolvedQueryParameter = queryParameter ?? config.diagnostics?.queryParameter ?? 'homeframe-debug';
  const queryVisible = typeof location !== 'undefined'
    && new URLSearchParams(location.search).has(resolvedQueryParameter);
  const visible = visibleProp ?? (queryVisible || config.diagnostics?.enabled === true);
  const viewport = useViewport();
  const keyboard = useKeyboard();
  const lifecycle = useAppLifecycle();
  const update = useHomeframeUpdate();
  const [, rerender] = useState(0);
  useEffect(() => subscribeRuntimeEvents(() => rerender((value) => value + 1)), []);
  if (!visible) return null;
  const events = getRecentRuntimeEvents();
  const lastRoute = [...events].reverse().find((event) => event.name === 'route-change')?.detail as {
    url?: URL;
    key?: string;
    index?: number;
    direction?: string;
  } | undefined;
  const install = [...events].reverse().find((event) => event.name === 'install-capability-change')?.detail as {
    state?: string;
  } | undefined;
  const notification = [...events].reverse().find((event) => event.name === 'notification-capability-change')?.detail as {
    state?: string;
  } | undefined;
  const active = document.activeElement instanceof HTMLElement
    ? `${document.activeElement.tagName.toLowerCase()} ${getComputedStyle(document.activeElement).fontSize}`
    : 'none';
  const scrollRoots = [...document.querySelectorAll<HTMLElement>('[data-hf-scroll-view]')]
    .map((element, index) => `${index}:${element.scrollLeft.toFixed(0)},${element.scrollTop.toFixed(0)}`)
    .join(' · ') || 'none';
  return (
    <aside data-hf-diagnostics="" aria-label="Homeframe diagnostics">
      <strong>Homeframe diagnostics</strong>
      <dl>
        <dt>viewport</dt><dd>{viewport.width.toFixed(0)}×{viewport.height.toFixed(0)} at {viewport.x.toFixed(0)},{viewport.y.toFixed(0)}</dd>
        <dt>stable</dt><dd>{viewport.stableWidth.toFixed(0)}×{viewport.stableHeight.toFixed(0)}</dd>
        <dt>safe</dt><dd>{Object.values(viewport.safeArea).map((value) => value.toFixed(0)).join(' / ')}</dd>
        <dt>keyboard</dt><dd>{keyboard.phase} {keyboard.height.toFixed(0)}px ({keyboard.source})</dd>
        <dt>display</dt><dd>{viewport.displayMode}</dd>
        <dt>lifecycle</dt><dd>{lifecycle.phase}</dd>
        <dt>active</dt><dd>{active}</dd>
        <dt>scroll roots</dt><dd>{scrollRoots}</dd>
        <dt>route</dt><dd>{lastRoute ? `${lastRoute.url?.pathname ?? '—'} · ${lastRoute.key ?? '—'} #${lastRoute.index ?? '—'} ${lastRoute.direction ?? '—'}` : '—'}</dd>
        <dt>worker</dt><dd>{update.state} {update.currentBuild ?? '—'} → {update.availableBuild ?? '—'} · guards {update.guardCount}</dd>
        <dt>install</dt><dd>{install?.state ?? '—'}</dd>
        <dt>notifications</dt><dd>{notification?.state ?? '—'}</dd>
        <dt>events</dt><dd>{events.length}</dd>
      </dl>
    </aside>
  );
}
