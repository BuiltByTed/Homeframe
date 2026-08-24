# Homeframe

Homeframe is a React PWA framework for apps that live on the iOS Home Screen. It owns the viewport, safe areas, keyboard geometry, app shell, startup presentation, History API routing, manifest assets, service worker, updates, installation capability, and notification capability while leaving product UI in the application.

**[Open the live kitchen-sink PWA](https://builtbyted.github.io/Homeframe/)** to test the framework in Safari, as an iPhone Home Screen app, in desktop Chrome/Safari, or in an installed desktop app window.

The same application runs as an installable desktop Chrome PWA. Safari browser mode remains edge-to-edge: page content may extend beneath Safari's chrome while fixed headers, docks, composers, and navigation stay inside the usable visual viewport.

## What it solves

| Common iOS PWA failure | Homeframe's contract |
| --- | --- |
| A black, white, or translucent gap appears around the Home indicator. | Roots translucent iOS scenes in the full, keyboard-stable `100vh` canvas, measures all four safe areas, and applies the bottom inset to the dock instead of shortening the page canvas. This avoids WebKit's percentage-height blank strip and adapts to each iPhone rather than assuming a screen size. |
| Safari content should extend behind browser chrome, but controls must remain reachable. | Browser mode paints edge-to-edge while the header, nav, and composer stay inside the usable visual viewport. |
| iOS leaves a blurry/translucent strip above the app header. | The shell owns and paints the top safe-area backing as part of the stable header, including iOS 26’s edge treatment, so there is no detached blurry top edge. |
| Opening the keyboard moves the whole page or makes the header jump down and slide back. | The installed-app shell keeps an immutable origin and size. Homeframe captures the pre-focus scroll anchor and corrects WebKit's hidden layout-viewport pan throughout keyboard settlement; the header never follows `visualViewport.offsetTop`. |
| Bottom navigation or a text composer teleports when the keyboard opens or closes, or page content shows behind the keyboard. | `ViewportDock keyboard="avoid"` follows measured `visualViewport` geometry frame by frame, continuously removes the Home-indicator inset as the keyboard takes over that edge, and grows an opaque shell mask over the keyboard-owned rectangle. A short linear transition is used only when the browser reports one final geometry jump. |
| Touching a field while trying to scroll opens the keyboard. | Homeframe claims WebKit's native focus action on touch/pen down, but focuses with `preventScroll` only after a completed tap. A drag beginning on a field is transferred to the app scroller and never opens the keyboard. |
| Focusing an input zooms the entire app. | Inputs are audited and clamped to a physically safe minimum size, including iOS scaled-display modes. |
| Labels, icons, and navigation text become selected or show callouts. | UI text selection and touch callouts are disabled by default while form controls, code, and explicit `data-hf-selectable` regions remain selectable. |
| An edge Back/Forward swipe exposes a white system surface in a light OS theme. | Installed iOS/iPadOS mode uses an interactive, finger-tracking in-app history transition with a cached destination scene. Safari, Chrome, and desktop PWAs retain browser History API navigation. |
| Back/Forward refreshes the destination or loses scroll; button navigation inherits stale scroll. | Routes are same-document, keyed entries. History traversal restores per-entry scroll, while links, buttons, and tabs start the destination at the top. |
| A copied link opens the app but loses the selected view or scroll target. | URL-backed permalinks combine route parameters, query-backed view state, and either a stable fragment anchor or an optional exact `AppScrollView` position. They survive cold launch, process death, installation mode, and another device. |
| An internal app scroller loses the familiar quick route back to the top. | Tapping a non-interactive part of the app-owned header scrolls the active `AppScrollView` to top; interactive header controls remain untouched. iOS does not expose the native status-bar tap itself to web JavaScript. |
| Returning from the app switcher flashes an empty white page. | Generated launch images, a static pre-React splash, lifecycle snapshots, and an explicit app canvas cover cold start and resume. |
| Icons, splash images, manifest fields, status-bar metadata, and theme colors drift apart. | One typed config generates Apple touch icons, maskable icons, startup images, adaptive metadata, and the web manifest. Color mode can follow the system or force light/dark. |
| A service-worker update mixes old and new assets or strands users on a stale bundle. | Atomic build-ID caches, bounded runtime caches (including media Range responses), offline navigation, and configurable prompt/automatic/manual activation keep a release internally consistent. Update checks are coalesced, and overlapping/cross-tab checks follow the winning worker instead of surfacing a losing candidate as a false failure. Safe-point reload is configurable. |
| Install and notification prompts are inconsistent or violate platform rules. | Headless capability hooks expose when and how to nudge. The app still owns the component, copy, timing, and user gesture. Push subscription, notification routing, and badging are included. |
| The iPhone fix breaks the desktop-installed app. | Display-mode policies are explicit. The same shell supports iPhone Safari, iPhone Home Screen, desktop Safari/Chrome, and Chrome's installed app window. |

Homeframe also keeps the document itself stationary—only `AppScrollView` scrolls—and supplies lifecycle checkpoints so unfinished UI state survives backgrounding and update reloads.

The normative behavior and acceptance criteria are in [SPEC.md](./SPEC.md).
Migration instructions are in [docs/adoption-runbook.md](./docs/adoption-runbook.md),
release guarantees are in [docs/compatibility-policy.md](./docs/compatibility-policy.md),
and the current finding ledger is in [docs/security-review.md](./docs/security-review.md).

## Try the example

```bash
npm install
npm run build
npm run demo:serve -- --port=4180
```

Open `http://localhost:4180` for ordinary local testing. A non-loopback iPhone or Mac needs HTTPS for service workers, installation, and notifications; see [docs/secure-local-testing.md](./docs/secure-local-testing.md).

The kitchen-sink app exercises safe areas, keyboard docking, focus zoom, routing, history restoration, cold-launch permalinks, URL-backed view state, offline mode, updates, install education, push subscriptions, notifications, badging, lifecycle restore, and diagnostics. Add `?homeframe-debug` to show the geometry HUD.

The hosted GitHub Pages build is static, so its local notification flow works but its “send real web push” control explains how to run the server-backed delivery test locally.

Production recovery, private-cache logout, and the same-URL worker kill-switch are
covered in [the recovery runbook](./docs/recovery-and-kill-switch.md).

## Add Homeframe to a Vite React app

Install the framework packages:

```bash
npm install @homeframe/runtime @homeframe/react @homeframe/router @homeframe/sw
npm install -D @homeframe/vite @homeframe/cli
```

Create `homeframe.config.ts`:

```ts
import { defineHomeframe } from '@homeframe/vite';

export default defineHomeframe({
  app: {
    id: '/',
    name: 'My App',
    shortName: 'My App',
    startUrl: '/',
    scope: '/',
    display: 'standalone',
    colorScheme: 'system',
    themeColor: '#172554',
    themeColorDark: '#020617',
    backgroundColor: '#172554',
    backgroundColorDark: '#020617',
    icon: './brand/icon-1024.png',
    // Optional dedicated sources; otherwise Homeframe safely adapts `icon`.
    maskableIcon: './brand/icon-maskable-1024.png',
    appleTouchIcon: './brand/icon-ios-1024.png',
  },
  viewport: {
    selection: 'controls-only',
    snapshot: 'brand',
    bottomDock: 'avoid',
  },
  router: { historyMode: 'auto' },
  nudges: {
    install: { minSessions: 2, minEngagedMs: 30_000 },
    notifications: { minSessions: 2, minEngagedMs: 45_000 },
  },
  serviceWorker: {
    update: { mode: 'automatic', reload: 'safe-point' },
    notifications: {
      applicationServerKey: process.env.VITE_VAPID_PUBLIC_KEY,
      subscriptionTransport: '/api/push/subscriptions',
    },
  },
});
```

Set `app.colorScheme` to `system` (the default), `light`, or `dark`. System mode emits adaptive browser metadata, critical canvas colors, and light/dark Apple startup images. A forced scheme locks the document canvas and generated assets; Homeframe separately avoids iOS's OS-owned light swipe fallback by selecting managed edge navigation in installed iOS/iPadOS web apps.

The router's default `historyMode: 'auto'` uses ordinary History API entries in Safari, Chrome, and desktop PWAs. Installed iOS/iPadOS web apps use a URL-synchronized managed stack plus left-edge Back and right-edge Forward gestures because WebKit's native snapshot view can fall back to an unpaintable system-white surface. Use `historyMode: 'browser'` to opt back into the native installed gesture, or `historyMode: 'managed'` to exercise the fallback in tests.

### Responsive desktop shell

Passing `sidebar` to `AppShell` enables its desktop grid at 900px while preserving the ordinary header/content/bottom layout below that breakpoint. The sidebar has an independently scrolling main region and a pinned `sidebarFooter`; it can remain expanded, collapse to an icon rail, or hide completely. Set `headerPlacement` to `sidebar`, `content`, or `full` to choose the header span. Wrap text in `AppSidebarLabel` so the framework can visually hide it in rail mode without removing accessible names.

```tsx
<AppShell
  header={<Header />}
  headerPlacement="full"
  sidebar={<PrimaryNavigation />}
  sidebarFooter={<AccountAndSidebarControls />}
  sidebarStorageKey="my-app:sidebar-mode"
>
  <AppScrollView>{children}</AppScrollView>
</AppShell>
```

Use `useAppSidebar()` inside the sidebar or its footer to read the current `expanded | rail | hidden` mode and call `setMode()` or `cycleMode()`. The controlled `sidebarMode` and `onSidebarModeChange` props are available when layout state belongs in application state. Override `--hf-sidebar-width` and `--hf-sidebar-rail-width` to fit the product; Homeframe narrows both from 900–1099px and hides the desktop sidebar below 900px.

### Deep links and permalinks

Every in-scope path, query string, and fragment is directly loadable as long as the production server rewrites document routes to the Homeframe entry document. The generated service worker applies the same scoped document fallback offline. The Pages example emits physical documents for its known routes so they return 200 immediately, plus a matching `404.html` shell for unknown dynamic routes.

`history.state` remains private to one browser history entry and is not shareable. Put durable view state in the URL instead:

```tsx
const permalink = usePermalink();

const shareUrl = permalink.create({
  to: '/projects/42',
  view: { tab: 'activity', filter: ['open', 'assigned'] },
  scroll: { anchor: 'comment-7', offset: 12 },
});

const { scrollKey, direction, scrollBehavior, permalinkScroll } =
  useRouteScrollRestoration();

<AppScrollView
  scrollKey={scrollKey}
  navigationType={direction}
  scrollBehavior={scrollBehavior}
  permalinkScroll={permalinkScroll}
>
  <article id="comment-7">…</article>
</AppScrollView>;
```

The path identifies the route/view, `view` patches ordinary query parameters, and the fragment targets either an element `id` or `data-hf-permalink-anchor`. Prefer stable semantic anchors when possible. Use `scroll: 'current'` to capture the exact internal scroll position into `__hf_scroll` when pixel-level restoration is genuinely useful. Both forms retry while async route content arrives and yield immediately to user scrolling.

The live kitchen sink includes a **Deep links & permalinks** lab with query-controlled layout/filter state, an anchor permalink, and exact-position capture.

### Reactive framework state

Homeframe exposes state through narrowly subscribed hooks instead of injecting a giant props object. Apps can consume a hook in a container and pass the result into any app-owned component:

| Hook | Reactive state |
| --- | --- |
| `useKeyboard()` | `opening`, `open`, `closing`, or `closed`; height and geometry source |
| `useViewport()` / `useSafeArea()` / `useDisplayMode()` | visual and stable dimensions, offsets, scale, all safe-area insets, browser/standalone/fullscreen mode |
| `useNavigationGesture()` | `idle`, `tracking`, `committing`, or `cancelling`; Back/Forward direction, progress, delta, and commit threshold |
| `useRouterSnapshot()` / `useNavigationDirection()` | URL, route match/params/data, entry key/index, push/replace/reload/Back/Forward direction, loading/error status |
| `usePermalink()` | decoded portable view/scroll state and the share-ready URL builder |
| `useAppLifecycle()` | `booting`, `visible`, `hidden`, or `restoring`; persisted-page and visibility timestamps |
| `useServiceWorker()` / `useHomeframeUpdate()` | worker build, update readiness, deferrals, guards, errors, and actions |
| `useInstallCapability()` / `useNotificationCapability()` | eligibility, blockers, permission/subscription state, and user-gesture actions |

Non-React code can use `subscribeRuntimeEvents()`. The same local event stream includes viewport, lifecycle, route, navigation-gesture, worker, install, notification, recovery, and diagnostic transitions; telemetry is opt-in and app-owned.

Desktop apps that opt into `displayOverride: ['window-controls-overlay',
'standalone']` can pass `windowControlsOverlay` to `AppHeader` and place draggable
title-bar content in `HomeframeWindowDragRegion`. Homeframe consumes Chromium's
`titlebar-area-*` environment values while interactive descendants remain
non-draggable.

Add the adapter to Vite:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { homeframe } from '@homeframe/vite';
import homeframeConfig from './homeframe.config';

export default defineConfig({ plugins: [react(), homeframe(homeframeConfig)] });
```

Use an intentionally empty document head and a stable root:

```html
<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8"></head>
  <body><div id="homeframe-root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

Import the framework styles once and contain the app in its shell:

```tsx
import '@homeframe/react/styles.css';
import {
  AppHeader,
  AppScrollView,
  AppViewport,
  HomeframeInput,
  HomeframeProvider,
  ViewportDock,
} from '@homeframe/react';

export function Root() {
  return (
    <HomeframeProvider>
      <AppViewport>
        <AppHeader>My App</AppHeader>
        <AppScrollView>{/* route content */}</AppScrollView>
        <ViewportDock keyboard="avoid">{/* app-owned navigation or composer */}</ViewportDock>
      </AppViewport>
    </HomeframeProvider>
  );
}
```

The build embeds the serializable client policy before the application bundle,
so `<HomeframeProvider>` and `createHomeframeRouter()` automatically consume this
configuration. Apps only pass a React-side override for non-serializable adapters
or deliberate test overrides; there is no second update, viewport, nudge, or
notification configuration to keep in sync.

For a complete router and shell composition, follow [examples/kitchen-sink/src/App.tsx](./examples/kitchen-sink/src/App.tsx).

## Headless install and notification UI

Homeframe makes policy and capability state available without imposing a design:

```tsx
const install = useInstallCapability();
const notifications = useNotificationCapability();

if (install.eligible) return <MyInstallCard capability={install} />;
if (notifications.eligible) return <MyNotificationCard capability={notifications} />;
```

On iOS, the install capability supplies customizable manual Share → Add to Home Screen instructions. Notification permission is requested only from an app-owned user gesture, and iOS browser mode reports `requires-install`. A push delivery server and public VAPID key are still required; Homeframe never embeds a private key in browser code.

iOS may prefer the document's generated Apple touch icon over the manifest icon.
Use `app.appleTouchIcon` when the iOS treatment differs. The generated maskable
icon uses an opaque app-color canvas and contains source artwork within the
standard maskable safe circle instead of cropping it silently.

## Verification

```bash
npm test
npm run doctor
```

The repository also includes a native XCUITest harness in `tests/ios` for both
Mobile Safari and the actual installed Home Screen app viewport contract.
Simulator coverage is a regression gate, not a substitute for the physical-device
release matrix in the spec.

All authored JavaScript-runtime source, Node tooling, tests, and configuration are strict TypeScript. `npm run check:typescript` rejects `.js`, `.jsx`, `.mjs`, or `.cjs` source outside generated/dependency directories. CSS, HTML, JSON, and the native XCUITest harness remain in their platform-native formats; generated package and app output is JavaScript under `dist`.

## Workspace packages

- `@homeframe/runtime`: viewport, safe area, keyboard, lifecycle, install, and local events.
- `@homeframe/react`: shell primitives, inputs, readiness/snapshot UI, headless nudges, diagnostics, checkpoints, updates, and badges.
- `@homeframe/router`: scoped History API routing, real links, direction, loaders, prefetch, navigation-gesture state, deep links, permalinks, and scroll keys.
- `@homeframe/sw`: generated worker, update client, runtime caching, push transport, and badging.
- `@homeframe/vite`: validation, document metadata, icons, startup images, manifest, bootstrap, and worker generation.
- `@homeframe/cli`: `init`, `migrate`, `upgrade`, and `doctor`.
- `@homeframe/eslint-plugin`: checks for unsafe viewport and input patterns.
