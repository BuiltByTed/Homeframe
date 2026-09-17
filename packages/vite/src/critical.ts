import type { HomeframeConfig } from './types.js';

export function criticalCss(config: HomeframeConfig): string {
  const configuredScheme = config.app.colorScheme ?? 'system';
  const lightBackground = config.app.backgroundColor;
  const darkBackground = config.app.backgroundColorDark ?? lightBackground;
  const background = configuredScheme === 'dark' ? darkBackground : lightBackground;
  const cssScheme = configuredScheme === 'system'
    ? 'light dark'
    : `only ${configuredScheme}`;
  const adaptiveBackground = configuredScheme === 'system'
    ? `@media(prefers-color-scheme:dark){:root{--hf-app-background:${darkBackground};background:${darkBackground}}}`
    : '';
  // Do not position:fixed the document itself. WebKit clips a fixed root above
  // the standalone bottom scene inset (WebKit 237961/301108), producing the
  // exact empty strip Homeframe is intended to prevent. The document remains
  // immobile through overflow:hidden while AppViewport owns viewport geometry.
  //
  // Native startup bitmaps use the physical screen center. The head bootstrap
  // supplies a splash-only offset for opaque iOS windows whose content starts
  // below the status bar. Keep it independent of runtime shell/safe-area updates.
  const surfaces = ':is(#homeframe-boot-splash,[data-hf-react-splash])';
  return [
    `:root{--hf-app-background:${background};--hf-color-scheme:${cssScheme};background:${background};color-scheme:var(--hf-color-scheme)}`,
    'html,body,#homeframe-root{width:100%;margin:0;overflow:hidden;background:var(--hf-app-background)}html,body{height:100vh;min-height:100vh;overscroll-behavior:none}#homeframe-root{height:100%}',
    '#homeframe-boot-splash{position:fixed;z-index:2147483647;top:0;left:0;width:100vw;height:100vh;display:grid;place-items:center;color:CanvasText;background:var(--hf-app-background);font:600 17px/1.2 system-ui,-apple-system,sans-serif;transition:opacity 160ms ease}',
    '#homeframe-boot-splash img{grid-area:1/1;width:var(--hf-splash-logo-size,22vmin);height:var(--hf-splash-logo-size,22vmin);object-fit:contain;transform:translateY(var(--hf-splash-offset-y,0px))}',
    '#homeframe-boot-splash span{position:absolute;top:calc(50% + var(--hf-splash-offset-y,0px) + var(--hf-splash-logo-size,22vmin) / 2 + 16px);right:max(16px,env(safe-area-inset-right));left:max(16px,env(safe-area-inset-left));text-align:center}',
    `${surfaces}{visibility:hidden;opacity:0;pointer-events:none}`,
    `:root[data-hf-splash-enabled=true]:not([data-hf-ready=true]) ${surfaces},:root[data-hf-splash-enabled=true][data-hf-splash-visible=brand] ${surfaces},:root[data-hf-splash-visible=privacy] ${surfaces}{visibility:visible;opacity:1;pointer-events:auto}`,
    '#homeframe-boot-splash>[data-hf-snapshot-content]{display:none}:root[data-hf-splash-visible=privacy] #homeframe-boot-splash>:is(img,span){display:none}:root[data-hf-splash-visible=privacy] #homeframe-boot-splash>[data-hf-snapshot-content]{display:block}',
    adaptiveBackground,
    '@media(prefers-reduced-motion:reduce){#homeframe-boot-splash{transition:none}}',
  ].join('');
}
