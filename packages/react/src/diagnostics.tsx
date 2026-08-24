import { useEffect, useState } from 'react';
import { getRecentRuntimeEvents, subscribeRuntimeEvents } from '@homeframe/runtime';
import { useAppLifecycle, useHomeframeUpdate, useKeyboard, useViewport } from './hooks.js';

export function HomeframeDiagnostics({ visible: visibleProp }: { visible?: boolean }) {
  const queryVisible = typeof location !== 'undefined'
    && new URLSearchParams(location.search).has('homeframe-debug');
  const visible = visibleProp ?? queryVisible;
  const viewport = useViewport();
  const keyboard = useKeyboard();
  const lifecycle = useAppLifecycle();
  const update = useHomeframeUpdate();
  const [, rerender] = useState(0);
  useEffect(() => subscribeRuntimeEvents(() => rerender((value) => value + 1)), []);
  if (!visible) return null;
  const active = document.activeElement instanceof HTMLElement
    ? `${document.activeElement.tagName.toLowerCase()} ${getComputedStyle(document.activeElement).fontSize}`
    : 'none';
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
        <dt>worker</dt><dd>{update.state} {update.currentBuild ?? '—'} → {update.availableBuild ?? '—'}</dd>
        <dt>events</dt><dd>{getRecentRuntimeEvents().length}</dd>
      </dl>
    </aside>
  );
}
