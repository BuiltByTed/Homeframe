# Adopting Homeframe in an existing React PWA

This runbook treats an installed PWA's identity and active service worker as production data. Do the migration in stages, retain a rollback deployment, and never change `id`, `scope`, `start_url`, or the worker URL merely to make migration easier.

## Exit criteria

The migration is complete when:

- the existing installed application upgrades in place instead of creating a second icon;
- one Homeframe worker controls the intended scope;
- every in-scope route works by direct load, an app link, Back/Forward, and an edge swipe without a document refresh;
- app-button and tab navigation starts at the top, while Back/Forward restores the history entry's scroll;
- the document never scrolls and the app header remains fixed with the keyboard open;
- every editable control focuses without changing `visualViewport.scale`;
- Safari content paints beneath browser chrome while interactive docks remain above it;
- cold launch, warm resume, app switching, offline launch, update, install education, and notification education pass the release matrix.

## 1. Freeze identity and capture the current system

Before installing Homeframe, record:

- the deployed origin and base path;
- manifest `id`, `scope`, `start_url`, `display`, icons, shortcuts, and colors;
- the service-worker script URL, registration scope, cache names, navigation fallback, update strategy, and cache headers;
- server rewrites, authentication callbacks, deep links, notification routes, and external/native-app handoffs;
- root/body CSS, fixed elements, portal roots, scroll containers, input font sizes, viewport listeners, and selection overrides.

Run the non-mutating inventory:

```bash
npx homeframe migrate --root . --output .homeframe/migration-report.json
npx homeframe doctor --root . --json > .homeframe/baseline-doctor.json
```

Commit these reports with the migration branch if they contain no secrets. Save screenshots and geometry readings from at least one Safari tab and the already installed Home Screen app.

Do not unregister the current worker or clear Cache Storage. Those actions strand existing installations and hide upgrade bugs.

## 2. Add Homeframe as the upstream dependency

For released packages:

```bash
npm install @homeframe/runtime @homeframe/react @homeframe/router @homeframe/sw
npm install -D @homeframe/vite @homeframe/cli @homeframe/eslint-plugin
```

For a monorepo checkout, use npm workspaces as this repository does. For a private fork, publish immutable package versions to the organization's registry and depend on those versions; do not copy framework source into the application. Lock exact versions during migration and let the lockfile record one coherent Homeframe release.

Add a Renovate/Dependabot group for all `@homeframe/*` packages so they update together. Upgrade the dependency in a normal application branch; do not use a Git upstream merge that can overwrite product code or generated configuration.

Build the packages and app in CI before changing runtime behavior:

```bash
npm run typecheck
npm run build
```

## 3. Adopt generated metadata without changing identity

Create `homeframe.config.ts` from the recorded production manifest. Preserve exact URL semantics, including trailing base paths. Provide source artwork at least 1024×1024; use a separate maskable source when available.

Add `homeframe(config)` to Vite. Remove app-authored duplicates only after a production build proves that Homeframe emits their replacement:

- viewport and theme-color metadata;
- manifest and Apple touch-icon links;
- app-capable and status-bar metadata;
- startup images and boot splash;
- any second root background declaration.

Run:

```bash
npm run build
npx homeframe doctor --root . --dist dist --strict
```

Diff `index.html`, `manifest.webmanifest`, `generated/asset-report.json`, and all icon dimensions. A changed manifest identity is a stop-ship issue.

## 4. Move layout ownership to Homeframe

Import `@homeframe/react/styles.css` once, as early as possible. Wrap the React tree in `HomeframeProvider` and the visible application in one `AppViewport`.

Make `html`, `body`, and `#homeframe-root` non-scrolling. Remove `100vh`/`100dvh` app-shell sizing, global Visual Viewport listeners, body scroll locks, fixed-body keyboard hacks, and duplicated `env(safe-area-inset-*)` padding from migrated shell elements.

Map existing UI as follows:

| Existing responsibility | Homeframe owner |
| --- | --- |
| fixed top application bar | `AppHeader` or `AppShell.header` |
| route/page scrolling | `AppScrollView` |
| bottom navigation | `ViewportDock keyboard="avoid"` |
| focused search/chat composer | `ViewportDock keyboard="avoid"` or `KeyboardDock` |
| overlay/modal portal | `HomeframePortal` |
| editable controls | `HomeframeInput`, `HomeframeTextarea`, `HomeframeSelect`, or an audited equivalent |
| deliberately copyable text | `SelectableText` |
| long-press-sensitive control | `NoCallout` |

Do not put the entire shell inside a page scroller. The invariant is one stationary document, one explicit scrolling content region, and controls positioned from Homeframe's visual viewport variables.

Custom CSS may use:

```css
var(--hf-viewport-height)
var(--hf-viewport-y)
var(--hf-stable-height)
var(--hf-safe-top)
var(--hf-safe-bottom)
var(--hf-effective-safe-bottom)
var(--hf-keyboard-height)
var(--hf-input-min-font-size)
```

Never reduce input text below `--hf-input-min-font-size`. This value is scale-aware and may exceed 16px on iOS display modes whose baseline viewport scale is below 1.

## 5. Adapt routing and scroll behavior

The built-in router uses real anchors and History API entries in browsers and desktop PWAs. Its default `historyMode: 'auto'` switches installed iOS/iPadOS web apps to a URL-synchronized managed stack and framework edge gestures, avoiding WebKit's system-white native snapshot fallback. Configure its scope to match the application and pass its scroll key and direction to the one route scroller:

```tsx
const route = useRouterSnapshot();
const { scrollKey, direction, scrollBehavior } = useRouteScrollRestoration();

<AppScrollView
  scrollKey={scrollKey}
  navigationType={direction}
  scrollBehavior={scrollBehavior}
>
  <RouterOutlet />
</AppScrollView>
```

Use `Link` for semantic navigation and `navigate()` for app buttons. Do not call `location.href` for same-origin in-scope routes. Ordinary push/replace navigation starts the destination at `scrollTop = 0`; popstate Back/Forward restores the saved entry.

`useRouterSnapshot()` exposes the current `url`, route `state`, matched params/data, history key, and direction. This supports query-driven screens and lightweight navigation-state hints without reaching into `window.history.state`.

For a URL-only modal or sheet update, pass `{ replace: true, preventScrollReset: true }` to `navigate`. The router marks that transition as `scrollBehavior: 'preserve'`; ordinary pushes and replaces continue to reset to the top.

Configure the origin server to rewrite known in-scope document routes, including `/__homeframe/recovery`, to `index.html`. Exclude APIs, asset-like paths, and the worker. The recovery route remains network-first in the generated worker and can fall back to the validated shell offline. Test direct loading while online before enabling offline fallback.

If retaining React Router or another router, write a small adapter that supplies a stable history-entry key and navigation direction to `AppScrollView`. Preserve real anchors. On an installed iOS/iPadOS web app, either adopt Homeframe's managed-history adapter or explicitly accept the native WebKit snapshot fallback; a dark document alone cannot recolor that OS-owned transition surface.

## 6. Hand off the service worker safely

Keep the existing stable worker URL and scope whenever possible. Configure `legacyNamesToDelete` with only the old app-owned cache names. Never delete all origin caches or registrations.

First deploy Homeframe in `prompt` or `manual` update mode to a canary audience. Verify:

1. The new worker downloads every required current chunk before becoming waiting.
2. A deliberately failed precache leaves the old worker and its caches usable.
3. Activation occurs only at a safe point: visible, keyboard closed, no modal/prompt transition, and no vetoing update guard.
4. `controllerchange` reloads each old client at most once.
5. Multiple open clients converge on the same build.
6. Deep routes continue to resolve during the mixed-build rollback window.

Register guards around unsaved forms and critical work:

```tsx
const update = useHomeframeUpdate();

useEffect(() => update.registerGuard(() => !formIsDirty), [formIsDirty, update]);
```

Release versioned assets before HTML and `sw.js`, retain old assets for the rollback window, and serve `sw.js` and HTML with revalidation-friendly headers. Only move to automatic safe-point updates after an upgrade from the actual deployed old worker passes.

## 7. Add app-owned install and notification nudges

Render product-specific components from `useInstallCapability()` and `useNotificationCapability()`. Homeframe controls eligibility, ordering, cooldowns, impressions, platform blockers, and success state; the application controls presentation and wording.

On iOS Safari, show the supplied manual Add to Home Screen education. Do not show notification education until the app is installed. Call notification permission and push subscription methods directly from the user's click/tap.

Provide only a public VAPID application-server key to the browser and configure an authenticated, CSRF-protected subscription transport. The backend must implement idempotent `PUT` and `DELETE`, tolerate old/new payload versions during rollout, remove expired endpoints, and send only same-origin scoped routes. Test denied, revoked, rotated, and restored subscriptions.

## 8. Add lifecycle and privacy behavior

Choose a snapshot policy:

- `brand`: cover app-switch/resume frames with the generated brand surface;
- `privacy`: cover sensitive UI while hidden and restoring;
- `preserve`: leave the last application frame visible.

Use `useStateCheckpoint` for small drafts or route state that must survive an iOS process eviction. Do not store secrets or large account data in a checkpoint. Use `HomeframeReadinessProvider` holds for application bootstrap data that must be ready before the splash is removed, and always release a hold.

## 9. Validate in increasing-risk order

Run automated checks first:

```bash
npm run typecheck
npm run test:unit
npm run build
npm run test:e2e
npx homeframe doctor --root . --dist dist --url https://staging.example.com --strict
```

Then test the exact built output over trusted HTTPS:

- desktop Chrome tab and installed window;
- iOS Safari tab and a newly installed Home Screen app;
- an already installed pre-migration app upgrading in place;
- portrait and landscape, small and large iPhones, iPad full-screen and split view;
- default, larger-text, hardware, emoji/dictation, and third-party keyboard paths;
- cold start, warm resume, app switch, OS-terminated restore, offline, slow network, and interrupted update;
- edge-swipe Back/Forward, direct deep links, notification click into an existing app, and notification click from a terminated app;
- light/dark, reduced motion, VoiceOver, 200% desktop zoom, and text selection/copy.

For every input, record `visualViewport.scale`, `window.scrollY`, header position, dock bottom, and the focused control's visible bounds before focus, while open, while switching inputs, and after close. The expected document scroll is always zero.

## 10. Roll out and roll back

Promote the same tested artifacts; do not rebuild between staging and production. Monitor worker install failures, update deferrals, route recovery, and subscription transport failures without recording payload bodies, input contents, or full URLs.

Rollback means republishing a fixed worker at the same URL and identity with assets that remain available. Never roll back by changing manifest identity, scope, or asking ordinary users to clear all website data.

After every Homeframe dependency update:

```bash
npx homeframe upgrade --from <old-version> --to <new-version>
npm test
npx homeframe doctor --root . --dist dist --strict
```

Repeat the installed-app upgrade smoke test and the physical iOS keyboard/safe-area suite before production promotion.
