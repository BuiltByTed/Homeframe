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
  // The native Apple startup bitmap centers the logo on the full physical
  // canvas. Keep the HTML handoff on that same immutable 100vw × 100vh canvas:
  // safe-area padding and the asynchronously measured shell height both change
  // its center during launch. A title is positioned independently so it can
  // never displace the logo.
  return `:root{--hf-app-background:${background};--hf-color-scheme:${cssScheme};background:${background};color-scheme:var(--hf-color-scheme)}html,body,#homeframe-root{width:100%;margin:0;overflow:hidden;background:var(--hf-app-background)}html,body{height:100vh;min-height:100vh;overscroll-behavior:none}#homeframe-root{height:100%}#homeframe-boot-splash{position:fixed;z-index:2147483647;top:0;left:0;width:100vw;height:100vh;display:grid;place-items:center;color:CanvasText;background:var(--hf-app-background);font:600 17px/1.2 system-ui,-apple-system,sans-serif;transition:opacity 160ms ease}#homeframe-boot-splash img{grid-area:1/1;width:22vmin;height:22vmin;object-fit:contain}#homeframe-boot-splash span{position:absolute;top:calc(50% + 11vmin + 16px);right:max(16px,env(safe-area-inset-right));left:max(16px,env(safe-area-inset-left));text-align:center}:root[data-hf-ready=true]:not([data-hf-splash-visible]) #homeframe-boot-splash{visibility:hidden;opacity:0;pointer-events:none}:root[data-hf-splash-visible] #homeframe-boot-splash{visibility:visible;opacity:1}${adaptiveBackground}@media(prefers-reduced-motion:reduce){#homeframe-boot-splash{transition:none}}`;
}
