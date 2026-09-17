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

Route loaders run again on fresh navigations. A prefetched result can serve one
navigation within 30 seconds; Back/Forward can reuse data for up to 60 seconds.
The router retains at most 100 data entries and six DOM previews. Older managed
history entries remain navigable and use an app-canvas preview until rendered.

After a mutation, call `await router.revalidate()` to refresh the current route
while preserving its history entry and scroll. Call `router.invalidate()` before
changing accounts, then navigate to the next screen; `router.invalidate(url)`
clears a specific URL. Invalidation cancels pending work and clears retained data
and previews; it does not itself navigate or replace the currently rendered UI.
`useHomeframeLogout()` also invalidates active Homeframe routers.

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
  splash: { appleStatusBarStyle: 'default' },
  viewport: {
    // Disable incidental selection everywhere, allow it only on desktop, or
    // retain normal browser selection everywhere.
    selection: 'allow-desktop',
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

If the keyboard should cover persistent bottom navigation while only the
attachment follows it, set `bottomKeyboard="manual"` and keep
`bottomAttachmentKeyboard="avoid"`. Homeframe removes the covered dock row
from the attachment anchor while the attachment owns keyboard focus.

`ViewportAttachment` is also exported for direct composition. Homeframe owns
its position and size but intentionally supplies no colors, fonts, borders, or
shadows. `homeframe doctor --strict` reports app-authored fixed/sticky regions
as `HF_UNTRACKED_VIEWPORT_UI`; the ESLint plugin catches inline versions while
editing when enabled in the application's ESLint configuration.

## Full-height side panels

Import `SidePanel` from `@builtbyted/homeframe` and compose it through the shell:

```tsx
<AppShell header={<Header />} sidePanel={
  <SidePanel open={panelOpen} onOpenChange={setPanelOpen} side="right"
    aria-label="Workspace tools" header={<PanelTitle />} footer={<PanelActions />}>
    <PanelContent />
  </SidePanel>
}>
  <AppScrollView>{children}</AppScrollView>
</AppShell>
```

The default 400px panel narrows the whole app when at least 720px remains,
overlays when it does not, and fills the UI below 768px. Configure `width`,
`minAppWidth`, and `mobileBreakpoint`; use `side="left"` for the other edge.
Keep one panel mounted and toggle `open` to preserve content and scroll state.
Homeframe owns safe areas, keyboard-visible header/footer slots, independent
scrolling, modal focus, dismissal, and reduced motion. Content remains app-owned.

## Launch defaults

| Launch environment | Branded splash |
| --- | --- |
| Desktop browser | Hidden |
| Installed desktop app | Hidden |
| Mobile browser | Hidden |
| Installed mobile app, including tablets | Shown |

Homeframe establishes this policy before first paint and applies it to both the
HTML and React splash, including branded resume presentation. Explicit opt-ins
are `splash.showInBrowserTabs: true` and `splash.showInDesktopApps: true`.
`splash.enabled: false` disables branded presentation and generated Apple startup
images. Explicit privacy snapshots remain available in every environment.

The generated Apple image and HTML splash use the same `splash.logo` artwork.
Homeframe accounts for the opaque iOS status-bar origin when positioning the
HTML logo, independently of shell measurements and keyboard changes.

Install icons default to `purpose: any`, preserving the supplied artwork without
opting into platform masking. Set `app.maskableIcon` only to request adaptive
icon treatment. Browser and operating-system icon decoration remains platform
controlled; there is no universal border-disable manifest flag.

## iOS status-bar compliance

Starting in 0.1.16, `splash.appleStatusBarStyle` defaults to `default` for both
installation metadata and bootstrap. Set it explicitly when upgrading an app.
Doctor requires exactly one generated `content="default"` status-bar declaration
and a matching bootstrap with translucent-mode geometry disabled. Non-default,
missing, duplicate or unverifiable output fails even without `--strict`.
Build before running doctor, or provide the deployed `--url`.

Keep the shell/header opaque. Affected older Home Screen installations may need
removal and re-addition from Safari after protecting local-only data and sign-in
state; code updates alone may retain old native metadata. Preserve manifest
identity, scope and worker URL. See the
[migration guide](https://github.com/BuiltByTed/Homeframe/blob/main/docs/ios-status-bar-migration.md).

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
