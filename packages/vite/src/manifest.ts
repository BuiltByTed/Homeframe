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
    background_color: forcedDark ? app.backgroundColorDark ?? app.backgroundColor : app.backgroundColor,
    theme_color: forcedDark ? app.themeColorDark ?? app.themeColor : app.themeColor,
    ...(app.orientation ? { orientation: app.orientation } : {}),
    ...(app.lang ? { lang: app.lang } : {}),
    ...(app.categories ? { categories: app.categories } : {}),
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
  if (!app.icon) errors.push('app.icon is required.');
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
  for (const [key, color] of Object.entries({
    themeColor: app.themeColor,
    backgroundColor: app.backgroundColor,
    themeColorDark: app.themeColorDark,
    backgroundColorDark: app.backgroundColorDark,
  })) {
    if (color && !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color)) {
      errors.push(`app.${key} must be an opaque six-digit hex color.`);
    }
  }
  if (errors.length) throw new Error(`Invalid Homeframe configuration:\n- ${errors.join('\n- ')}`);
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
