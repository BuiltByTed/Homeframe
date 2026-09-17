import type { HomeframeSplashConfig } from './types.js';

interface SplashPolicy {
  enabled: boolean;
  browserTabs: boolean;
  desktopApps: boolean;
  translucent: boolean;
}

/** Runs in the generated head bootstrap, before either splash can paint. */
function initializeSplash(policy: SplashPolicy, style: CSSStyleDeclaration): void {
  const root = document.documentElement;
  const nav = navigator as Navigator & { standalone?: boolean; userAgentData?: { mobile?: boolean } };
  const mobile = nav.standalone === true
    || /Android|iPhone|iPad|iPod/i.test(nav.userAgent)
    || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
    || nav.userAgentData?.mobile === true;
  const modes = ['standalone', 'minimal-ui', 'fullscreen', 'window-controls-overlay']
    .map((mode) => window.matchMedia?.(`(display-mode: ${mode})`));
  function updatePolicy(): void {
    const installed = nav.standalone === true || modes.some((mode) => mode?.matches);
    root.dataset.hfSplashEnabled = String(policy.enabled
      && (installed ? mobile || policy.desktopApps : policy.browserTabs));
  }
  let geometryKey = '';
  function updateGeometry(): void {
    if (nav.standalone !== true || policy.translucent) return;
    // iOS exposes physical orientation independently of a keyboard-reduced
    // viewport, which must not be mistaken for rotating the device.
    const angle = (window as Window & { orientation?: number }).orientation;
    const landscape = typeof angle === 'number'
      ? Math.abs(angle) % 180 === 90
      : window.matchMedia?.('(orientation: landscape)').matches;
    const shortEdge = Math.min(screen.width, screen.height);
    const longEdge = Math.max(screen.width, screen.height);
    const width = landscape ? longEdge : shortEdge;
    const height = landscape ? shortEdge : longEdge;
    const key = `${width}:${height}:${window.innerWidth}`;
    if (key === geometryKey) return;
    geometryKey = key;
    // A full-screen opaque iOS window starts below the native status bar.
    // Keep only physical-screen geometry here: CSS handles the changing content
    // origin synchronously, and keyboard/viewport settlement cannot recenter it.
    // Windowed iPad apps use their own canvas instead of the whole display.
    if (width > 0 && Math.abs(window.innerWidth - width) <= 1
      && window.innerHeight >= height * 0.75) {
      style.setProperty('--hf-splash-offset-y', `calc((100vh - ${height}px) / 2)`);
      style.setProperty('--hf-splash-logo-size', `${shortEdge * 0.22}px`);
    } else {
      style.removeProperty('--hf-splash-offset-y');
      style.removeProperty('--hf-splash-logo-size');
    }
  }
  updatePolicy();
  updateGeometry();
  for (const mode of modes) mode?.addEventListener?.('change', updatePolicy);
  window.addEventListener('resize', updateGeometry, { passive: true });
}

export function splashBootstrap(config: HomeframeSplashConfig | undefined): string {
  const policy: SplashPolicy = {
    enabled: config?.enabled !== false,
    browserTabs: config?.showInBrowserTabs === true,
    desktopApps: config?.showInDesktopApps === true,
    translucent: config?.appleStatusBarStyle === 'black-translucent',
  };
  return `(${initializeSplash.toString()})(${JSON.stringify(policy)},s);`;
}

export interface BootSplashMarkupOptions {
  inlineLogo: string;
  title: string | undefined;
  appName: string;
}

export function bootSplashMarkup({
  inlineLogo,
  title,
  appName,
}: BootSplashMarkupOptions): string {
  const resolvedTitle = title ?? appName;
  const label = resolvedTitle === '' ? '' : `<span>${escapeHtml(resolvedTitle)}</span>`;
  return `<div id="homeframe-boot-splash" aria-hidden="true"><img src="${escapeHtml(inlineLogo)}" alt="">${label}</div>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
