# @builtbyted/homeframe

Homeframe is a React framework for apps that live on the iOS Home Screen and as
installed desktop PWAs. It owns the browser behavior that ordinary app code
should not have to rebuild: viewport and safe-area geometry, keyboard docking,
the app shell, startup presentation, routing/history, generated install assets,
the service worker, atomic updates, offline navigation, installation capability,
notifications, lifecycle restore, and diagnostics.

## Create an app

```bash
npx scaffold-homeframe-app my-app
cd my-app
npm run dev
```

The scaffold includes strict TypeScript, a working shell/router composition,
generated PWA assets, `AGENTS.md`, and `docs/HOMEFRAME_RUNBOOK.md` so human and AI
coders know the framework's ownership boundaries.

The generated contract keeps one persistent shell/header with one active primary
scroller around the route outlet, preserves an opaque iOS safe-area header
surface, forbids app-level viewport/splash workarounds, and requires native iPhone
keyboard open/close plus open-keyboard scrolling checks before release.

## Install manually

```bash
npm install @builtbyted/homeframe react react-dom
npm install -D vite @vitejs/plugin-react typescript
```

Use the primary package for React shell and router APIs:

```tsx
import {
  AppScrollView,
  AppShell,
  AppViewport,
  HomeframeProvider,
  HomeframeRouterProvider,
  RouterOutlet,
  createHomeframeRouter,
  useRouteScrollRestoration,
} from '@builtbyted/homeframe';
import '@builtbyted/homeframe/styles.css';
```

Configure generated PWA behavior through the Vite subpath:

```ts
import { defineHomeframe } from '@builtbyted/homeframe/vite';

export default defineHomeframe({
  app: {
    id: '/',
    name: 'My App',
    shortName: 'My App',
    startUrl: '/',
    scope: '/',
    display: 'standalone',
    colorScheme: 'system',
    themeColor: '#dbeafe',
    themeColorDark: '#0f172a',
    backgroundColor: '#dbeafe',
    backgroundColorDark: '#0f172a',
    icon: './brand/icon.svg',
  },
  viewport: {
    selection: 'controls-only',
    snapshot: 'brand',
    bottomDock: 'avoid',
  },
  router: { historyMode: 'auto' },
  serviceWorker: {
    update: { mode: 'automatic', reload: 'safe-point' },
  },
});
```

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { homeframe } from '@builtbyted/homeframe/vite';
import homeframeConfig from './homeframe.config.js';

export default defineConfig({
  plugins: [homeframe(homeframeConfig), react()],
});
```

Keep `index.html` intentionally small. Homeframe generates the viewport,
theme-color, install, Apple, startup, manifest, and service-worker metadata.

Dock placement and keyboard behavior compose independently. For a bottom search
field or composer that overlays content while following the software keyboard:

```tsx
<ViewportDock placement="overlay" keyboard="avoid">
  <SearchComposer />
</ViewportDock>
```

Homeframe owns its safe areas, measurement, hit testing, and keyboard
translation; no app-level viewport positioning rule is required.

For a player or tool row attached below the header, or a search row stacked
above bottom navigation while content scrolls behind it, use the measured shell
slots:

```tsx
<AppShell
  header={<Header />}
  headerAttachment={<VideoPlayer />}
  bottom={<BottomNavigation />}
  bottomAttachment={<SearchComposer />}
  bottomAttachmentKeyboard="avoid"
>
  <AppScrollView>{children}</AppScrollView>
</AppShell>
```

`ViewportAttachment` is also exported for direct composition. Homeframe owns
its position and size but intentionally supplies no colors, fonts, borders, or
shadows. `homeframe doctor --strict` reports app-authored fixed/sticky regions
as `HF_UNTRACKED_VIEWPORT_UI`; the ESLint plugin catches inline versions while
editing when enabled in the application's ESLint configuration.

## Package entry points

- `@builtbyted/homeframe` — React shell and router APIs.
- `@builtbyted/homeframe/styles.css` — required framework styles.
- `@builtbyted/homeframe/react` — React APIs without router re-exports.
- `@builtbyted/homeframe/router` — router APIs.
- `@builtbyted/homeframe/vite` — typed configuration and Vite plugin.
- `@builtbyted/homeframe/runtime` — advanced non-React runtime APIs.
- `@builtbyted/homeframe/sw` — advanced worker/client APIs.
- `@builtbyted/homeframe/eslint-plugin` — framework boundary lint rules.
- `homeframe` — bundled CLI binary with `init`, `migrate`, `upgrade`, and `doctor`.

## Framework boundaries

- The document never scrolls; content scrolls in `AppScrollView`.
- Use one `HomeframeProvider`, one router provider, and one top-level
  `AppViewport`.
- Put persistent chrome in `AppShell`; put bottom controls in its keyboard-aware
  bottom slot or a Homeframe dock.
- Do not register another service worker or hand-author generated PWA metadata.
- Do not use raw viewport measurements or device-specific safe-area constants.
- Use Homeframe editable controls and keep editable text at least 16 CSS px.
- Preserve app identity and worker scope after users install the app.

Run the release-oriented checks with:

```bash
npm run build
npx homeframe doctor --root . --dist dist --strict
```

## Documentation

- [Repository and full guide](https://github.com/BuiltByTed/Homeframe)
- [Live kitchen-sink PWA](https://builtbyted.github.io/Homeframe/)
- [Normative specification](https://github.com/BuiltByTed/Homeframe/blob/main/SPEC.md)
- [Adoption runbook](https://github.com/BuiltByTed/Homeframe/blob/main/docs/adoption-runbook.md)
- [Compatibility policy](https://github.com/BuiltByTed/Homeframe/blob/main/docs/compatibility-policy.md)
- [Security review](https://github.com/BuiltByTed/Homeframe/blob/main/docs/security-review.md)

MIT © BuiltByTed
