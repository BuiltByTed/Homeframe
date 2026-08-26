import type { HomeframeConfig } from './types.js';
import { joinBase } from './assets.js';

export function createManifest(config: HomeframeConfig, base: string): Record<string, unknown> {
  const { app } = config;
  const forcedDark = app.colorScheme === 'dark';
  return {
    id: app.id,
    name: app.name,
    short_name: app.shortName,
    ...(app.description ? { description: app.description } : {}),
    start_url: app.startUrl,
    scope: app.scope,
    display: app.display ?? 'standalone',
    ...(app.displayOverride?.length ? { display_override: app.displayOverride } : {}),
    background_color: forcedDark ? app.backgroundColorDark ?? app.backgroundColor : app.backgroundColor,
    theme_color: forcedDark ? app.themeColorDark ?? app.themeColor : app.themeColor,
    ...(app.orientation ? { orientation: app.orientation } : {}),
    ...(app.lang ? { lang: app.lang } : {}),
    ...(app.categories ? { categories: app.categories } : {}),
    ...(app.screenshots?.length ? {
      screenshots: app.screenshots.map((screenshot) => ({
        src: screenshot.src,
        sizes: screenshot.sizes,
        ...(screenshot.type ? { type: screenshot.type } : {}),
        ...(screenshot.formFactor ? { form_factor: screenshot.formFactor } : {}),
        ...(screenshot.label ? { label: screenshot.label } : {}),
      })),
    } : {}),
    ...(app.shareTarget ? {
      share_target: {
        action: app.shareTarget.action,
        method: app.shareTarget.method ?? 'POST',
        enctype: app.shareTarget.enctype ?? 'multipart/form-data',
        params: app.shareTarget.params,
      },
    } : {}),
    ...(app.protocolHandlers?.length ? {
      protocol_handlers: app.protocolHandlers,
    } : {}),
    icons: [
      { src: joinBase(base, 'generated/icon-192.png'), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: joinBase(base, 'generated/icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: joinBase(base, 'generated/icon-maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    ...(app.shortcuts?.length ? {
      shortcuts: app.shortcuts.map((shortcut) => ({
        name: shortcut.name,
        ...(shortcut.shortName ? { short_name: shortcut.shortName } : {}),
        ...(shortcut.description ? { description: shortcut.description } : {}),
        url: shortcut.url,
        ...(shortcut.icon ? { icons: [{ src: shortcut.icon }] } : {}),
      })),
    } : {}),
  };
}

export function validateConfig(config: HomeframeConfig): void {
  const errors: string[] = [];
  const { app } = config;
  if (!app.id) errors.push('app.id is required and must remain stable after installation.');
  if (!app.name) errors.push('app.name is required.');
  if (!app.shortName) errors.push('app.shortName is required.');
  if (!app.scope) errors.push('app.scope is required.');
  if (!app.startUrl) errors.push('app.startUrl is required.');
  if (!app.icon) errors.push('app.icon is required.');
  if (app.maskableIconPaddingRatio !== undefined
    && (!Number.isFinite(app.maskableIconPaddingRatio)
      || app.maskableIconPaddingRatio < 0
      || app.maskableIconPaddingRatio >= 0.5)) {
    errors.push('app.maskableIconPaddingRatio must be at least zero and less than 0.5.');
  }
  if (app.colorScheme && !['system', 'light', 'dark'].includes(app.colorScheme)) {
    errors.push('app.colorScheme must be system, light, or dark.');
  }
  if (!isPathWithinScope(app.startUrl, app.scope)) {
    errors.push(`app.startUrl (${app.startUrl}) must be inside app.scope (${app.scope}).`);
  }
  if (!isPathWithinScope(app.id, app.scope)) {
    errors.push(`app.id (${app.id}) must be inside app.scope (${app.scope}).`);
  }
  for (const shortcut of app.shortcuts ?? []) {
    if (!isPathWithinScope(shortcut.url, app.scope)) {
      errors.push(`Shortcut URL (${shortcut.url}) must be inside app.scope (${app.scope}).`);
    }
  }
  if (app.shareTarget && !isPathWithinScope(app.shareTarget.action, app.scope)) {
    errors.push(`Share target action (${app.shareTarget.action}) must be inside app.scope (${app.scope}).`);
  }
  for (const handler of app.protocolHandlers ?? []) {
    if (!/^web\+[a-z]+$/.test(handler.protocol)) errors.push(`Protocol handler (${handler.protocol}) must use a valid web+ scheme.`);
    if (!handler.url.includes('%s') || !isPathWithinScope(handler.url.replace('%s', 'value'), app.scope)) {
      errors.push(`Protocol handler URL (${handler.url}) must contain %s and be inside app.scope (${app.scope}).`);
    }
  }
  for (const screenshot of app.screenshots ?? []) {
    if (!screenshot.src || !/^\d+x\d+$/.test(screenshot.sizes)) errors.push('Every screenshot requires src and sizes formatted as WIDTHxHEIGHT.');
  }
  for (const [key, color] of Object.entries({
    themeColor: app.themeColor,
    backgroundColor: app.backgroundColor,
    themeColorDark: app.themeColorDark,
    backgroundColorDark: app.backgroundColorDark,
    maskableIconBackgroundColor: app.maskableIconBackgroundColor,
  })) {
    if (color && !/^#[0-9a-f]{6}(?:ff)?$/i.test(color)) {
      errors.push(`app.${key} must be an opaque six-digit hex color.`);
    }
  }
  if (config.security?.cspNonce !== undefined
    && (!config.security.cspNonce || /["'<>\s]/.test(config.security.cspNonce))) {
    errors.push('security.cspNonce must be a non-empty attribute-safe nonce or server replacement token.');
  }
  const viewport = config.viewport;
  if (viewport?.selection && !['controls-only', 'allow'].includes(viewport.selection)) errors.push('viewport.selection must be controls-only or allow.');
  if (viewport?.snapshot && !['preserve', 'brand', 'privacy'].includes(viewport.snapshot)) errors.push('viewport.snapshot must be preserve, brand, or privacy.');
  if (viewport?.bottomDock && !['avoid', 'hide', 'overlay', 'manual'].includes(viewport.bottomDock)) errors.push('viewport.bottomDock must be avoid, hide, overlay, or manual.');
  if (viewport?.keyboardThresholdPx !== undefined && (!Number.isFinite(viewport.keyboardThresholdPx) || viewport.keyboardThresholdPx <= 0)) errors.push('viewport.keyboardThresholdPx must be greater than zero.');
  if (viewport?.keyboardThresholdRatio !== undefined && (!Number.isFinite(viewport.keyboardThresholdRatio) || viewport.keyboardThresholdRatio <= 0 || viewport.keyboardThresholdRatio >= 1)) errors.push('viewport.keyboardThresholdRatio must be between zero and one.');
  if (viewport?.inputZoomMinimumPx !== undefined && (!Number.isFinite(viewport.inputZoomMinimumPx) || viewport.inputZoomMinimumPx < 16)) errors.push('viewport.inputZoomMinimumPx must be at least 16 CSS px.');
  if (viewport?.settleDelaysMs?.some((delay) => !Number.isFinite(delay) || delay < 0 || delay > 5_000)) errors.push('viewport.settleDelaysMs must contain bounded non-negative delays up to 5000ms.');
  if (viewport?.keyboardStabilizationMs !== undefined && (!Number.isFinite(viewport.keyboardStabilizationMs) || viewport.keyboardStabilizationMs < 0 || viewport.keyboardStabilizationMs > 5_000)) errors.push('viewport.keyboardStabilizationMs must be between zero and 5000ms.');
  if (viewport?.keyboardOcclusion !== undefined && !['opaque', 'transparent'].includes(viewport.keyboardOcclusion)) errors.push('viewport.keyboardOcclusion must be opaque or transparent.');
  if (viewport?.topTapToTop !== undefined && typeof viewport.topTapToTop !== 'boolean') errors.push('viewport.topTapToTop must be a boolean.');
  for (const [kind, policy] of Object.entries(config.nudges ?? {})) {
    if (!policy || typeof policy !== 'object' || kind === 'storageKeyPrefix' || kind === 'policyVersion') continue;
    const nudge = policy as { minSessions?: number; minEngagedMs?: number; cooldownDays?: number; maxImpressions?: number };
    if (nudge.minSessions !== undefined && (!Number.isInteger(nudge.minSessions) || nudge.minSessions < 0)) errors.push(`nudges.${kind}.minSessions must be a non-negative integer.`);
    if (nudge.minEngagedMs !== undefined && (!Number.isFinite(nudge.minEngagedMs) || nudge.minEngagedMs < 0)) errors.push(`nudges.${kind}.minEngagedMs must be non-negative.`);
    if (nudge.cooldownDays !== undefined && (!Number.isFinite(nudge.cooldownDays) || nudge.cooldownDays < 0)) errors.push(`nudges.${kind}.cooldownDays must be non-negative.`);
    if (nudge.maxImpressions !== undefined && (!Number.isInteger(nudge.maxImpressions) || nudge.maxImpressions < 0)) errors.push(`nudges.${kind}.maxImpressions must be a non-negative integer.`);
  }

  const worker = config.serviceWorker;
  if (worker && worker.enabled !== false) {
    const fileName = worker.fileName ?? 'sw.js';
    if (fileName.startsWith('/') || fileName.includes('..') || /[?#]/.test(fileName)) {
      errors.push('serviceWorker.fileName must be a relative same-origin output path without .., query, or fragment.');
    }
    const fallback = worker.documentFallback ?? app.startUrl;
    if (!isPathWithinScope(fallback, app.scope)) {
      errors.push(`serviceWorker.documentFallback (${fallback}) must be inside app.scope (${app.scope}).`);
    }
    if (worker.navigationTimeoutSeconds !== undefined
      && (!Number.isFinite(worker.navigationTimeoutSeconds) || worker.navigationTimeoutSeconds <= 0)) {
      errors.push('serviceWorker.navigationTimeoutSeconds must be greater than zero.');
    }
    if (worker.precache?.maximumFileSizeBytes !== undefined
      && (!Number.isInteger(worker.precache.maximumFileSizeBytes) || worker.precache.maximumFileSizeBytes <= 0)) {
      errors.push('serviceWorker.precache.maximumFileSizeBytes must be a positive integer.');
    }
    for (const entry of worker.precache?.additionalEntries ?? []) {
      if (!entry.url || !entry.revision) errors.push('Every additional precache entry requires a URL and non-empty revision.');
      if (!isPathWithinScope(entry.url, app.scope)) errors.push(`Additional precache URL (${entry.url}) must be inside app.scope (${app.scope}).`);
    }
    for (const [index, rule] of (worker.runtimeCaching ?? []).entries()) {
      const label = `serviceWorker.runtimeCaching[${index}]`;
      if (!rule.match) errors.push(`${label}.match is required.`);
      if (!/^[a-zA-Z0-9_-]+$/.test(rule.cacheName)) errors.push(`${label}.cacheName may contain only letters, numbers, underscore, and hyphen.`);
      if (/(?:token|bearer|email|@|user[-_]?id|account[-_]?id)/i.test(rule.cacheName)) {
        errors.push(`${label}.cacheName looks user-specific. Cache names must never contain tokens, email addresses, or account identifiers.`);
      }
      if (!Number.isInteger(rule.maxEntries) || rule.maxEntries <= 0) errors.push(`${label}.maxEntries must be a positive integer.`);
      if (!Number.isFinite(rule.maxAgeSeconds) || rule.maxAgeSeconds <= 0) errors.push(`${label}.maxAgeSeconds must be greater than zero.`);
      if (rule.maxResponseBytes !== undefined
        && (!Number.isInteger(rule.maxResponseBytes) || rule.maxResponseBytes <= 0)) {
        errors.push(`${label}.maxResponseBytes must be a positive integer.`);
      }
      if (rule.networkTimeoutSeconds !== undefined
        && (!Number.isFinite(rule.networkTimeoutSeconds) || rule.networkTimeoutSeconds <= 0)) {
        errors.push(`${label}.networkTimeoutSeconds must be greater than zero.`);
      }
      if (rule.statuses?.some((status) => !Number.isInteger(status) || status < 0 || status > 599)) {
        errors.push(`${label}.statuses contains an invalid HTTP status.`);
      }
      if (rule.rangeRequests && rule.strategy === 'network-only') {
        errors.push(`${label}.rangeRequests requires a cache-backed strategy.`);
      }
      if (rule.responseTypes?.includes('opaque')) {
        errors.push(`${label}.responseTypes cannot include opaque because its body size and status cannot be validated safely.`);
      }
      if (rule.sensitiveData && rule.sensitiveData !== 'none') {
        if (rule.sensitiveData.purgeOnLogout !== true) {
          errors.push(`${label}.sensitiveData.purgeOnLogout must be true.`);
        }
        if (typeof rule.sensitiveData.partitionKey !== 'function') {
          errors.push(`${label}.sensitiveData.partitionKey must be a self-contained function.`);
        }
        if (!rule.sensitiveData.threatReview?.trim()) {
          errors.push(`${label}.sensitiveData.threatReview must identify the account-switching threat review.`);
        }
      }
    }
    for (const legacyName of worker.legacyNamesToDelete ?? []) {
      if (!legacyName || /[*?]/.test(legacyName)) errors.push('serviceWorker.legacyNamesToDelete accepts exact non-empty cache names only.');
    }
    for (const route of worker.notifications && worker.notifications.routeAllowlist || []) {
      if (!isPathWithinScope(route, app.scope)) errors.push(`Notification route (${route}) must be inside app.scope (${app.scope}).`);
    }
    if (worker.notifications && worker.notifications.subscriptionTransport
      && !isSameOriginPath(worker.notifications.subscriptionTransport)) {
      errors.push('serviceWorker.notifications.subscriptionTransport must be a same-origin URL.');
    }
    if (worker.notifications && worker.notifications.applicationServerKey
      && /BEGIN (?:EC |RSA )?PRIVATE KEY|\bprivate\b/i.test(worker.notifications.applicationServerKey)) {
      errors.push('serviceWorker.notifications.applicationServerKey appears to contain private key material. Configure only the public VAPID key.');
    }
    const update = worker.update;
    if (update?.mode && !['automatic', 'prompt', 'on-restart', 'manual'].includes(update.mode)) {
      errors.push('serviceWorker.update.mode must be automatic, prompt, on-restart, or manual.');
    }
    if (update?.reload === 'immediate' && update.acceptDataLossRisk !== true) {
      errors.push('serviceWorker.update.reload="immediate" requires acceptDataLossRisk: true. Prefer safe-point reloads.');
    }
    if (update?.foregroundMinimumAgeMs !== undefined
      && (!Number.isFinite(update.foregroundMinimumAgeMs) || update.foregroundMinimumAgeMs < 0)) {
      errors.push('serviceWorker.update.foregroundMinimumAgeMs must be zero or greater.');
    }
    if (update?.intervalMinutes !== undefined
      && (!Number.isFinite(update.intervalMinutes) || update.intervalMinutes < 0)) {
      errors.push('serviceWorker.update.intervalMinutes must be zero or greater.');
    }
  }
  if (errors.length) throw new Error(`Invalid Homeframe configuration:\n- ${errors.join('\n- ')}`);
}

export function runtimeCacheOverlapWarnings(config: HomeframeConfig): string[] {
  if (!config.serviceWorker) return [];
  const rules = config.serviceWorker.runtimeCaching ?? [];
  const warnings: string[] = [];
  for (let leftIndex = 0; leftIndex < rules.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rules.length; rightIndex += 1) {
      const left = rules[leftIndex]!;
      const right = rules[rightIndex]!;
      if (typeof left.match !== 'string' || typeof right.match !== 'string') continue;
      const leftType = left.matchType ?? 'prefix';
      const rightType = right.matchType ?? 'prefix';
      let example: string | null = null;
      if (leftType === 'prefix' && rightType === 'prefix'
        && (left.match.startsWith(right.match) || right.match.startsWith(left.match))) {
        example = left.match.length >= right.match.length ? left.match : right.match;
      } else if (leftType === 'exact' && rightType === 'prefix' && left.match.startsWith(right.match)) {
        example = left.match;
      } else if (leftType === 'prefix' && rightType === 'exact' && right.match.startsWith(left.match)) {
        example = right.match;
      } else if (leftType === rightType && left.match === right.match) {
        example = left.match;
      }
      if (example) warnings.push(`Runtime cache rules ${leftIndex} (${left.cacheName}) and ${rightIndex} (${right.cacheName}) overlap at ${example}; declaration order decides which rule wins.`);
    }
  }
  return warnings;
}

function isPathWithinScope(value: string, scope: string): boolean {
  try {
    const origin = 'https://homeframe.invalid';
    const url = new URL(value, origin);
    const scopeUrl = new URL(scope, origin);
    const scopePath = scopeUrl.pathname.endsWith('/')
      ? scopeUrl.pathname
      : `${scopeUrl.pathname}/`;
    return url.origin === scopeUrl.origin
      && (url.pathname === scopeUrl.pathname || url.pathname.startsWith(scopePath));
  } catch {
    return false;
  }
}

function isSameOriginPath(value: string): boolean {
  try {
    return new URL(value, 'https://homeframe.invalid').origin === 'https://homeframe.invalid';
  } catch {
    return false;
  }
}
