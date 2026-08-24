# Homeframe: React Home-Screen PWA Framework

Status: Proposed specification | Version: 0.1 | Date: 2026-08-23

Primary targets: installed iOS/iPadOS web apps and installed desktop Chrome PWAs

> `Homeframe` and the `@homeframe/*` package names are working names used to make
> this specification concrete. They are not assumed to be available package names.

## 1. Summary

Homeframe is a React framework for building installable web applications that
behave predictably when launched from the iOS or iPadOS Home Screen. It owns the
fragile platform integration layer—viewport measurement, safe areas, virtual
keyboard transitions, fixed app chrome, launch and resume presentation, history,
installation metadata, service-worker lifecycle, and capability detection—while
leaving product UI and business logic in the application.

A conforming application should be able to start with this structure:

```tsx
<HomeframeProvider config={config}>
  <AppShell
    header={<Header />}
    bottom={<BottomNavigation />}
  >
    <AppScrollView>
      <RouterOutlet />
    </AppScrollView>
  </AppShell>
</HomeframeProvider>
```

and receive safe-area handling, keyboard avoidance, scroll containment, resume
protection, install metadata, and update coordination without application-specific
iOS workarounds.

The words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are
normative requirements in the sense used by RFC 2119.

## 2. Goals

Homeframe MUST:

- Paint to every physical screen edge while keeping interactive content inside
  the current safe area in portrait, landscape, rotation, and iPad multitasking.
- Keep the app header visible at the top of the visual viewport while the software
  keyboard opens, changes, or closes.
- Keep bottom navigation, composers, and search controls attached either to the
  safe screen bottom or immediately above the software keyboard, according to a
  declared policy.
- Prevent the document underneath the app shell from scrolling or being panned by
  keyboard focus. Only declared scroll regions may move.
- Prevent iOS focus zoom for every conforming input without disabling the user's
  accessibility zoom.
- Prevent accidental selection and dragging of UI chrome while preserving normal
  editing, copy, accessibility, and explicitly selectable content.
- Generate and install all required manifest, icon, Apple metadata, theme, and
  launch-image declarations from one configuration and source artwork.
- Prevent framework-originated white or transparent frames during boot, route
  transitions, app resume, and bundle updates.
- Provide real History API navigation, deep-link fallback, scroll restoration,
  and back/forward behavior without document reloads for in-app routes.
- Ship a production service worker with revisioned caches, bounded runtime caches,
  offline behavior, configurable atomic updates, cache cleanup, push notification
  handling, notification-click routing, and badging.
- Expose headless install and notification nudge state. The framework owns
  eligibility, timing, persistence, and platform actions; the app owns all visual
  components and wording.
- Provide a safe migration path for an existing React application and a stable
  upstream dependency/update contract.
- Provide a first-class installed desktop Chrome experience using the same app,
  manifest, router, update flow, and notification abstraction.

## 3. Non-goals and platform boundaries

Homeframe v1 is not:

- A general-purpose visual component library. It provides structural primitives
  and unstyled/headless state, not branded headers, dialogs, buttons, or nudges.
- A replacement for an application data layer, authentication system, or push
  delivery server.
- A native wrapper, App Store package, or way to access APIs unavailable to the
  browser.
- A promise that an operating-system or WebKit rendering defect can never display
  a transient frame. It MUST eliminate white frames caused by Homeframe or app
  initialization and provide the best possible launch background and snapshot;
  an OS-compositor defect is reported as a platform limitation with a reproducible
  test, not hidden behind a false guarantee.
- A reason to disable pinch zoom, focus indicators, semantic HTML, or assistive
  technology behavior.
- A full SSR framework in v1. The core runtime MUST be SSR-safe when imported, but
  the first supported build adapter targets client-rendered React applications.

## 4. Supported environments

### 4.1 Support tiers

| Tier | Environment | Contract |
| --- | --- | --- |
| 1 | Installed Home Screen web app on the current and previous two stable iOS/iPadOS releases | Full layout, lifecycle, routing, offline, update, and feature-detected push support |
| 1 | Installed desktop Chrome on macOS, Windows, Linux, and ChromeOS; current and previous two stable Chrome releases | Full layout, install prompt, routing, offline, update, and notification support |
| 2 | Safari browser tab on supported iOS/iPadOS | Layout and routing work; install help replaces a programmatic install prompt; installed-only capabilities report blockers |
| 2 | Chromium browsers with compatible standards support | Feature-detected behavior; no browser-brand guarantee |
| 3 | Other modern browsers | Usable responsive web app with explicit capability degradation |

The core layout SHOULD remain usable below the Tier 1 range, but support for Web
Push on iOS begins only where the installed Home Screen environment exposes it.
No user-agent version check may be the sole gate for a capability.

### 4.2 Deployment prerequisites

- Production MUST use HTTPS and a service-worker-eligible same-origin scope.
- Localhost MAY use the browser's secure-context development exception.
- The manifest `id`, `scope`, `start_url`, service-worker URL, and service-worker
  scope MUST be explicit.
- The application server or CDN MUST be able to return the app shell for known
  client-side routes.

## 5. Design principles

1. **Own the outer document.** Homeframe controls the root sizing, overflow,
   background, metadata, and boot script. Applications render inside the shell.
2. **One source of viewport truth.** Components consume normalized state and CSS
   variables, never separate `innerHeight` hacks.
3. **Feature detection before platform detection.** Platform hints are used only
   to explain installation steps or select tested fallbacks.
4. **Use browser history except where iOS cannot render it safely.** Browser and
   desktop-installed modes create genuine same-document history entries. An
   installed iOS/iPadOS web app uses a URL-synchronized managed stack by default
   so WebKit's native swipe snapshot fallback cannot expose an OS-colored view.
5. **Updates are atomic.** An HTML document and its JS/CSS chunks always belong to
   one complete build. A partial precache can never activate.
6. **No surprise permission prompts or reloads.** Both are exposed through policy
   and observable state. User work can veto a reload.
7. **Accessible defaults are not optional polish.** Input zoom is fixed with
   legible control sizing, not by disabling user zoom. Selection suppression is
   scoped. Focus and semantic behavior remain native.
8. **Generate integration files.** Applications commit configuration and source
   artwork, not hand-maintained copies of framework boilerplate.
9. **Recover from process death.** iOS may terminate a Home Screen app. Shell and
   navigation state must restore without depending on a long-lived JS process.

## 6. Architecture

### 6.1 Packages

The reference implementation is split into replaceable packages:

| Package | Responsibility |
| --- | --- |
| `@homeframe/react` | Provider, shell, scroll, dock, lifecycle, nudge hooks, update hooks, error and offline boundaries |
| `@homeframe/runtime` | Pre-React boot runtime, normalized viewport store, capability detection, lifecycle state, diagnostics |
| `@homeframe/router` | History router and adapter contract; a maintained React Router adapter SHOULD also ship |
| `@homeframe/sw` | Service-worker source, page-side registration/update client, push and badge helpers |
| `@homeframe/vite` | Reference build adapter, generated HTML/manifest/assets, revision injection, development emulation |
| `@homeframe/cli` | `init`, `migrate`, `doctor`, asset generation, upgrade codemods, and device-test utilities |
| `@homeframe/eslint-plugin` | Rules for unsafe inputs, body scrolling, untracked fixed positioning, and raw History API use |

Applications MAY use the viewport and React packages without the Homeframe router,
provided their router passes the history conformance tests. The build adapter MUST
expose a documented interface so another bundler can be supported without forking
runtime code.

### 6.2 Ownership boundary

Homeframe owns:

- the viewport meta tag and app-capable metadata;
- critical root/splash CSS and the inline bootstrap script;
- `html`, `body`, root, viewport frame, and portal-root sizing behavior;
- CSS environment variables beginning `--hf-`;
- service-worker registration and framework cache names;
- generated manifest, icon, launch image, and production service worker;
- normalized history metadata under `history.state.__homeframe`;
- persisted nudge state under versioned `hf:` storage keys.

The application owns:

- route content, app header, bottom navigation, modals, and nudge components;
- data fetching and explicitly configured runtime cache policies;
- dirty-form/update guards;
- notification wording, categories, server delivery, and subscription endpoint;
- source brand artwork, product colors, names, and accessibility copy.

An application MUST NOT write directly to a Homeframe-owned field. All generated
files MUST contain a banner and fail `doctor` if a source copy is being edited.

## 7. Developer experience

### 7.1 Proposed setup

```sh
pnpm add @homeframe/react @homeframe/router
pnpm add -D @homeframe/vite @homeframe/cli
pnpm homeframe init
```

`homeframe init` MUST:

1. detect the React entry point and supported build tool;
2. create `homeframe.config.ts` and a source asset directory;
3. install or show the exact plugin integration diff;
4. add a provider and app shell only with explicit confirmation if an existing
   root component would be changed;
5. run `homeframe doctor` and print unresolved work;
6. never overwrite an existing manifest, worker, icon, or HTML customization
   without saving a patch and identifying the conflict.

### 7.2 Minimal configuration

```ts
// homeframe.config.ts
import { defineHomeframe } from '@homeframe/vite';

export default defineHomeframe({
  app: {
    id: '/app',
    name: 'Example App',
    shortName: 'Example',
    startUrl: '/app',
    scope: '/',
    description: 'An example installed web app',
    themeColor: '#111827',
    backgroundColor: '#111827',
    colorScheme: 'system',
    icon: './brand/app-icon-1024.png',
  },
  viewport: {
    bottomDock: 'avoid-keyboard',
    selection: 'controls-only',
  },
  serviceWorker: {
    update: { mode: 'automatic' },
    offline: { documentFallback: '/app' },
  },
  nudges: {
    install: { enabled: true },
    notifications: { enabled: true },
  },
});
```

### 7.3 Configuration contract

The public shape is conceptually:

```ts
interface HomeframeConfig {
  app: AppIdentityConfig;
  viewport?: ViewportConfig;
  splash?: SplashConfig;
  router?: RouterBuildConfig;
  serviceWorker?: ServiceWorkerConfig | false;
  nudges?: NudgeConfig;
  diagnostics?: DiagnosticsConfig;
  security?: SecurityConfig;
}
```

Configuration MUST be validated at build time. Invalid identity, out-of-scope
URLs, missing artwork, overlapping runtime cache rules, unsupported CSP settings,
and unsafe update combinations MUST fail the production build with an actionable
message.

## 8. Document and viewport runtime

### 8.1 Generated document contract

The build adapter MUST inject, before any external stylesheet or application
script:

```html
<meta
  name="viewport"
  content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-visual"
>
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
```

It MUST also inject:

- the manifest link;
- Apple touch icon declarations;
- configured Apple status-bar style;
- light/dark `theme-color` declarations when configured;
- a `color-scheme` declaration configured as `system`, forced `light`, or forced `dark`, with matching critical canvas and startup-image colors;
- inline, nonce-compatible critical background and layout CSS;
- a static splash element inside the root document;
- the small Homeframe bootstrap script before the application bundle.

`viewport-fit=cover` makes the viewport edge-to-edge. Homeframe MUST apply safe
area insets to the correct internal regions; it MUST NOT pad `html` or `body`,
which would recreate the visible bottom gap the framework is intended to remove.

The default viewport MUST NOT include `user-scalable=no` or `maximum-scale=1`.
Those settings are not the focus-zoom solution and reduce accessibility.

### 8.2 Root layout contract

The critical stylesheet MUST establish the equivalent of:

```css
html,
body {
  width: 100%;
  height: 100vh;
  min-height: 100vh;
  margin: 0;
  overflow: hidden;
  background: var(--hf-app-background);
}

#homeframe-root {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: var(--hf-app-background);
}

html,
body {
  overscroll-behavior: none;
}

[data-hf-viewport] {
  position: fixed;
  left: 0;
  top: 0;
  width: var(--hf-viewport-width);
  height: var(--hf-viewport-height);
  transform: translate3d(var(--hf-viewport-x), var(--hf-viewport-y), 0);
  overflow: hidden;
}
```

Production CSS may differ, but these invariants MUST hold:

- `html` and `body` are rooted in the large, keyboard-stable viewport rather
  than a percentage-height containing block. In a translucent iOS standalone
  scene, `height: 100%` can leave an unpainted strip at the physical bottom
  equal to the top safe-area inset.
- `window.scrollY` remains `0` during ordinary app use, focus, keyboard changes,
  route changes, and modal presentation.
- The physical area outside safe content is still painted with the configured app
  surface color.
- A dedicated scroll component—not `body`—owns vertical content scrolling.
- Framework portal roots are inside the normalized viewport frame so dialogs and
  toasts use the same keyboard and safe-area coordinate system.
- App code using `position: fixed` outside a Homeframe primitive produces a
  development warning because it can bind to the wrong viewport.

### 8.3 Normalized viewport state

The bootstrap runtime MUST publish an external store usable before React mounts:

```ts
interface HomeframeViewportSnapshot {
  width: number;
  height: number;
  x: number;
  y: number;
  stableWidth: number;
  stableHeight: number;
  scale: number;
  orientation: 'portrait' | 'landscape';
  safeArea: { top: number; right: number; bottom: number; left: number };
  keyboard: {
    phase: 'closed' | 'opening' | 'open' | 'closing';
    height: number;
    source: 'virtual-keyboard' | 'visual-viewport' | 'none';
  };
  displayMode: 'standalone' | 'fullscreen' | 'minimal-ui' | 'browser' | 'unknown';
  revision: number;
}
```

It MUST expose the following CSS variables on the root:

```text
--hf-viewport-width       --hf-viewport-height
--hf-viewport-x           --hf-viewport-y
--hf-stable-width         --hf-stable-height
--hf-safe-top             --hf-safe-right
--hf-safe-bottom          --hf-safe-left
--hf-effective-safe-bottom
--hf-keyboard-height      --hf-keyboard-open
--hf-header-height        --hf-bottom-height
```

Safe-area variables MUST be derived from `env(safe-area-inset-*)` through a CSS
probe when numeric JS state is needed. They MUST remain CSS-native for layout so
an environment update does not wait on React.

### 8.4 Measurement and stabilization algorithm

The controller MUST listen to:

- `visualViewport.resize` and `visualViewport.scroll`, when available;
- window `resize`, orientation changes, and relevant media-query changes;
- `focusin` and `focusout` for editable elements;
- `pageshow`, `pagehide`, and `visibilitychange`;
- Virtual Keyboard `geometrychange`, when available;
- service-worker controller changes that may lead to a reload.

Measurements MUST be coalesced to one animation-frame write. After focus,
orientation, visibility, or keyboard transitions, the controller MUST schedule
bounded follow-up samples until two consecutive samples are stable. It MUST not
assume the first resize event contains the final iOS keyboard geometry.

The preferred source order for keyboard geometry is:

1. a supported Virtual Keyboard bounding rectangle;
2. the obscured portion inferred from `visualViewport` and the stable viewport;
3. no claimed keyboard geometry.

For the visual-viewport fallback, all values are in layout CSS pixels and the
candidate obscured bottom is:

```ts
const visibleBottom = visualViewport.offsetTop + visualViewport.height;
const keyboardHeight = Math.max(0, stableHeight - visibleBottom);
```

The measured visual rectangle follows `visualViewport.offsetLeft/offsetTop` and
`visualViewport.width/height`. Browser-mode controls may use that rectangle to
remain inside browser chrome. An installed app MUST NOT move or resize the shell
or header to follow transient visual-viewport offsets during keyboard focus.
Instead, it keeps one stable physical shell rectangle, captures the internal
scroller position before focus, restores document scroll to zero, and counters
any independent `visualViewport.pageTop` layout pan during a bounded keyboard
settlement window. Only the avoid dock and keyboard occlusion mask consume the
keyboard rectangle. Implementations MUST clamp transient negative or overlarge
values and preserve the last stable snapshot rather than publish invalid
geometry.

Visual-viewport inference MUST require both an editable focus target and a
meaningful height reduction. The default meaningful reduction is the smaller of
`120 CSS px` and `18%` of stable height, configurable for test environments. This
prevents rotation, split-screen resizing, browser chrome, or desktop window
resizing from being mislabeled as a keyboard. A hardware keyboard with no visible
software keyboard therefore leaves the phase `closed`.

`stableHeight` MUST only be replaced by a trustworthy keyboard-closed
measurement for the current orientation and display mode. It MUST be reset on an
orientation or display-mode change.

### 8.5 Keyboard state machine

```text
closed -> opening -> open -> closing -> closed
            |          |         |
            +----------+---------+-- geometry correction
```

- `opening` begins on editable focus plus qualifying geometry.
- `open` begins after stable geometry or a bounded settle timeout.
- `closing` begins on blur, a zero keyboard rectangle, or recovering height.
- `closed` begins only after keyboard-closed geometry is stable.
- Focus moving directly between editable controls MUST NOT emit a false closed
  state or drop a bottom dock to the screen between fields.
- An app may subscribe to phase changes, but normal layout MUST not require an app
  event handler.

### 8.6 App shell and scrolling

`<AppShell>` MUST implement three independent regions in the normalized frame:

```text
+----------------------------------+
| safe top + persistent header     |
+----------------------------------+
| independently scrollable content|
|                                  |
+----------------------------------+
| bottom dock + effective safe area|
+----------------------------------+
        software keyboard
```

The shell SHOULD use CSS grid rows `auto minmax(0, 1fr) auto`. The header and
bottom region MUST not live inside the scrolling element.

`<AppScrollView>` MUST:

- provide momentum scrolling on iOS;
- contain overscroll and prevent scroll chaining into the document;
- preserve `scrollTop` while the keyboard changes unless the focused control is
  obscured;
- expose a stable scroll restoration key to the router;
- support explicitly declared nested scroll regions without treating all nested
  elements as restoration roots;
- account for safe-area and shell occupancy without app-authored spacer elements.

For touch or pen activation of an inactive editable, Homeframe MUST intercept
WebKit's native focus action at pointer/touch start, before its implicit reveal
pan can begin. It MUST focus with `{ preventScroll: true }` only after the gesture
resolves to a tap. A vertical drag that began on the editable MUST remain a
scroll gesture in the nearest application scroller and MUST NOT focus it. The
pre-focus scroll anchor MUST survive the subsequent `focusin` event, and bounded
animation-frame corrections MUST preserve it while the keyboard settles.

After keyboard geometry settles, Homeframe MAY scroll only the nearest declared
scroll region by the minimum distance needed to reveal the focused control. It
MUST never scroll the document to do so. Application code can opt out per control.

### 8.7 Header and dock policies

`<AppHeader>` occupies the top of the stable installed-app shell and includes the
top safe inset by default. It MUST remain visible and pixel-stable during keyboard
transitions. In browser mode it remains inside the browser's usable visual
viewport without preventing route content from painting beneath browser chrome.

`<ViewportDock>` supports:

| `keyboard` policy | Behavior |
| --- | --- |
| `avoid` | Default. Dock remains immediately above the keyboard. When closed it includes the bottom safe inset. |
| `hide` | Dock is removed from layout after keyboard opening begins and restored only after close settles. |
| `overlay` | Dock stays at the stable physical bottom and may be covered by the keyboard. Intended only for nonessential decoration. |
| `manual` | Framework publishes geometry; the app supplies positioning and accepts conformance responsibility. |

When the software keyboard is open, the default `--hf-effective-safe-bottom` is
`0px` because the dock is adjacent to the keyboard, not the Home indicator. Apps
MAY configure a design-system spacing value separately from the physical safe
inset.

The shell MUST paint an opaque, theme-matched occlusion layer over the portion of
its stable rectangle owned by the software keyboard. Route content MUST NOT be
visible behind the keyboard during opening, steady state, or closing.

`<KeyboardDock>` is an alias optimized for composers and bottom search fields. It
MUST provide `keyboard="avoid"` and accessible focus behavior by default.

### 8.8 Input focus zoom

iOS focus zoom is prevented through the control itself, not by prohibiting page
zoom:

- Every `input`, `textarea`, `select`, and editable host rendered inside the shell
  MUST have a computed font size of at least `16 CSS px` at the moment it receives
  focus.
- `<HomeframeInput>`, `<HomeframeTextarea>`, and `<HomeframeSelect>` MUST enforce
  this while remaining visually styleable. A design system can visually scale
  surrounding labels and dimensions, but not reduce the editable text below the
  threshold.
- A development observer MUST inspect focused editable elements. A nonconforming
  control produces an error containing its selector, computed size, and fix.
- `homeframe doctor --url <url>` MUST test every statically discoverable control;
  the device suite verifies dynamic controls.
- The base stylesheet MUST set `text-size-adjust: 100%`; it MUST NOT use text-size
  suppression as a substitute for responsive layout.
- Pinch zoom and platform accessibility text enlargement MUST remain available.

The guarantee is for conforming controls. A production build MAY fail under a
strict setting if app CSS overrides a control below 16px.

### 8.9 Accidental selection, dragging, and touch behavior

The default `selection: 'controls-only'` policy applies CSS selection suppression
to app chrome and ordinary UI labels. It MUST restore selection for:

- inputs, textareas, selects, and editable content;
- `[data-hf-selectable]` and `<SelectableText>`;
- code, preformatted content, article content, or other app-declared copy targets.

The implementation SHOULD use `user-select` and `-webkit-user-select`, not global
`selectstart` cancellation. `<NoCallout>` MAY also suppress WebKit touch callouts
for button-like controls, but this MUST not be applied to links, copyable content,
or editable fields by default.

Homeframe MUST preserve:

- native link activation and long-press behavior where semantically useful;
- keyboard focus and visible focus indicators;
- screen-reader navigation and form editing;
- vertical pan gestures in scroll regions;
- system back/forward edge gestures.

Interactive components MUST NOT install full-screen horizontal touch handlers.
Components that need horizontal swipes MUST reserve a configurable edge zone,
defaulting to `24 CSS px` on both sides, for system navigation.

## 9. Launch, resume, and process-death behavior

### 9.1 Three separate presentation layers

Homeframe treats these as separate problems:

1. **OS launch presentation:** generated manifest background/theme colors, Apple
   touch icon, and device/media-matched `apple-touch-startup-image` declarations.
2. **Pre-React boot:** an inline static splash in the HTML document, painted by
   critical CSS without waiting for fonts, JS chunks, network, or hydration.
3. **Resume shield:** a pre-mounted layer used while viewport geometry and required
   application state are restored after `pageshow` or `visibilitychange`.

All three MUST share a generated color and branding token set. The static splash
MUST not depend on the service worker being active.

### 9.2 Readiness protocol

The splash remains until all required readiness gates are satisfied:

- the first React shell commit has occurred;
- viewport state has a stable sample;
- the router has resolved the current location to either content or an intentional
  loading/error/offline view;
- every app-registered critical readiness promise has settled.

```ts
const readiness = useHomeframeReadiness();
const release = readiness.hold('restore-session');
await restoreSession();
release();
```

Holds MUST include a development timeout and owner stack. Production MUST retain
the branded shell and show a recoverable error state rather than reveal the raw
document background indefinitely.

The splash exit MUST honor `prefers-reduced-motion` and complete with at least one
fully painted underlying frame before removal.

### 9.3 App-switcher snapshot policy

`splash.snapshot` supports:

- `preserve` — leave the current UI visible when hidden;
- `brand` — synchronously cover potentially sensitive or stale UI with the static
  brand surface when the document becomes hidden;
- `privacy` — render an app-provided privacy component in the same layer.

On visibility return, a shown shield remains until viewport stabilization and the
first ready paint. No mode may reveal unstyled white root content.

### 9.4 Process death and state restoration

Because a Home Screen app may be killed without a conventional close event:

- route location is always recoverable from the URL;
- shell-level state MAY be checkpointed through a versioned storage adapter;
- critical form drafts SHOULD opt into an encrypted or application-approved
  persistence adapter;
- transient data MUST not be assumed to survive;
- the first offline launch MUST render the cached shell and an explicit recoverable
  offline state even if dynamic route data is unavailable.

Homeframe MUST not persist form contents or personal data by default.

## 10. Routing and browser history

### 10.1 Router requirements

In browser mode, the built-in router and every adapter MUST:

- use `history.pushState` for ordinary in-scope navigations and `replaceState`
  only when replacement is requested;
- create one entry per user-visible route transition;
- subscribe to `popstate` and render the destination without a document request;
- keep `history.state` mergeable with application and third-party state;
- assign a versioned entry key and monotonic index under
  `history.state.__homeframe`;
- set `history.scrollRestoration = 'manual'` and restore each declared scroll root
  after the route has committed;
- preserve query strings, fragments, and same-origin deep links;
- expose a permalink builder that encodes route identity in the path, portable
  view state in ordinary query parameters, and an optional scroll target as a
  stable fragment anchor or bounded exact internal-scroll position;
- use real `<a href>` elements and intercept only eligible unmodified, in-scope,
  same-origin activations;
- allow downloads, external origins, `_blank`, custom schemes, and out-of-scope
  destinations to use normal browser behavior;
- respond correctly to `pageshow` with `event.persisted` and not remount a second
  app after a back-forward-cache restoration;
- leave the shell mounted while route content loads, errors, or suspends.

`history.state` MUST be treated as entry-local state and MUST NOT be presented as
shareable or process-death-safe. A permalink MUST be fully recoverable from its
URL alone. Permalink query values MUST support repeated keys, and framework-owned
scroll keys MUST be namespaced and excluded from application view state. Invalid,
non-finite, negative, or unreasonably large scroll values MUST be rejected or
bounded before layout use.

`AppScrollView` MUST apply an explicit permalink scroll target after route
content commits. It MUST retry a missing anchor or temporarily clamped position
for bounded asynchronous loading, cancel immediately on pointer, touch, wheel,
or keyboard interaction, keep document scroll at zero, and clamp naturally when
the destination lacks enough overflow to satisfy an exact offset. Stable anchors
SHOULD be preferred over pixel positions.

In managed history mode, the router MUST keep the same URL, entry-key,
navigation-direction, deep-link, scroll-restoration, and no-document-request
contracts. It MUST update the visible URL with `history.replaceState`, maintain
one in-memory entry per route transition, and truncate forward entries after a
new push. Managed history MUST be selected automatically only for installed
iOS/iPadOS web apps, or explicitly by the developer for testing. Safari, Chrome,
and installed desktop PWAs MUST continue to use browser history by default.

### 10.2 iOS edge navigation

On iOS, WebKit renders a native `SwipeSnapshot` view during browser history
gestures. If the target snapshot is absent or unusable, that native view falls
back to an OS-owned color outside the document; in light appearance it can be
white even when the page, manifest, and theme metadata are dark. Web content
cannot paint that native surface.

Therefore installed iOS/iPadOS web apps MUST default to managed history with
framework-owned left-edge Back and right-edge Forward gestures. The gesture
MUST remain edge-scoped, prevent horizontal document lift, keep the shell and
header mounted, expose no transparent canvas, and commit only after a threshold.
Safari browser mode retains its native browser gesture. Developers MAY opt into
native installed history with `historyMode: 'browser'`, accepting the WebKit
fallback limitation, or force `historyMode: 'managed'` for conformance testing.

The managed router MUST expose a separately subscribable navigation-gesture
snapshot with `idle`, `tracking`, `committing`, and `cancelling` phases, Back or
Forward direction, CSS-pixel delta, commit distance, normalized progress, and a
`canCommit` flag. React applications receive it through
`useNavigationGesture()`. Phase boundaries MUST also enter the local runtime
event stream; per-frame progress SHOULD remain on the dedicated store so an
opted-in telemetry adapter is not called at display refresh rate. Native browser
gestures that WebKit does not expose remain `idle` rather than reporting guessed
state.

On `popstate`, cached route code and state SHOULD render synchronously. If route
data must be revalidated, the previous stable shell and an intentional route-level
loading state remain painted; the document MUST not refresh and the root MUST not
blank.

Route modules SHOULD be prefetched on intent and included in the service worker's
revisioned asset graph so a history destination does not wait for a missing old
chunk offline.

The router MUST expose direction (`back`, `forward`, `replace`, `push`, `reload`,
or `unknown`) derived from entry indices. A second stack is forbidden except for
the installed-iOS managed-history fallback defined above.

### 10.3 Server and service-worker fallback

- The origin server SHOULD rewrite known in-scope routes to the current app HTML.
- The service worker MUST serve the current precached document fallback for an
  in-scope navigation only when the network cannot provide a valid response.
- Asset-looking URLs, API routes, out-of-scope URLs, and non-GET requests MUST NOT
  receive the document fallback.
- A deep link opened from a notification MUST resolve through the same route table.
- Changing `start_url` MUST not be used as a routing workaround.

## 11. Headless install and notification nudges

Homeframe supplies no default nudge UI. It supplies state machines, policies,
storage, and actions from which developers build product-specific components.

### 11.1 Nudge coordinator

Only one Homeframe nudge may be eligible at a time. Default priority is:

1. blocking recovery/update choice;
2. install education;
3. notification education;
4. optional app-defined capability nudges.

The coordinator MUST suppress nudges while:

- a software keyboard or modal is open;
- the app is hidden, booting, restoring, offline where the action needs network,
  or in an error boundary;
- the current route declares `nudges: 'suppress'`;
- a user-defined critical task is active.

It stores impression count, last shown time, dismissal, snooze, success, and policy
version through a replaceable storage adapter. Policy-version changes MUST NOT
silently override a permanent denial or repeatedly nag the same user.

```ts
interface NudgePolicy {
  enabled: boolean;
  minSessions?: number;
  minEngagedMs?: number;
  cooldownDays?: number;
  maxImpressions?: number;
  routes?: string[];
}
```

Defaults SHOULD wait for demonstrated engagement, apply a multi-day cooldown, and
cap impressions. Applications MAY make the policy stricter, but SHOULD NOT trigger
the native permission prompt on initial load.

### 11.2 Install capability

```ts
interface InstallCapability {
  state:
    | 'checking'
    | 'installed'
    | 'native-prompt-ready'
    | 'manual-instructions'
    | 'unavailable';
  platformHint: 'ios' | 'chromium' | 'other';
  eligible: boolean;
  blockers: InstallBlocker[];
  prompt(): Promise<'accepted' | 'dismissed' | 'instructions-required'>;
  recordImpression(): void;
  dismiss(options?: { permanent?: boolean }): void;
  snooze(days?: number): void;
}
```

`useInstallCapability()` MUST:

- retain Chromium's `beforeinstallprompt` event only for a later user action;
- detect an active installed display mode through standards-based media queries
  and an iOS standalone fallback;
- return `manual-instructions` on iOS browser contexts where no programmatic
  prompt exists, with structured instruction tokens rather than hard-coded UI;
- update after `appinstalled`, display-mode changes, or a successful relaunch;
- never claim with certainty that an app is not installed elsewhere when the
  platform does not expose that information;
- require `prompt()` to be called directly from a user activation.

The application renders its own banner, sheet, coach mark, or settings row and
calls `recordImpression()` only when the nudge was actually visible.

### 11.3 Notification capability

```ts
interface NotificationCapability {
  state:
    | 'checking'
    | 'requires-install'
    | 'unsupported'
    | 'default'
    | 'requesting'
    | 'denied'
    | 'granted-unsubscribed'
    | 'subscribed'
    | 'error';
  eligible: boolean;
  permission: NotificationPermission | 'unsupported';
  subscription: PushSubscription | null;
  blockers: NotificationBlocker[];
  requestAndSubscribe(): Promise<NotificationResult>;
  unsubscribe(): Promise<void>;
  recordImpression(): void;
  dismiss(options?: { permanent?: boolean }): void;
  snooze(days?: number): void;
}
```

`useNotificationCapability()` MUST:

- identify installed-only push requirements and return `requires-install` rather
  than presenting a dead-end notification nudge;
- request native permission only as the immediate result of a user activation;
- preserve user activation through the permission call rather than performing
  unrelated awaits first;
- subscribe with the configured application server key and synchronize through
  the application's subscription transport;
- treat native `denied` as non-nudgeable unless the app renders explicit settings
  help in response to a user request;
- distinguish permission from server subscription state;
- recover an existing browser subscription after reinstall/reload and reconcile it
  with the server idempotently;
- feature-detect Push, Notifications, Service Worker, and Badging independently.

The recommended product flow is an app-owned educational component followed by
the native prompt after the user presses its enable button. Homeframe MUST NOT
display or simulate the native prompt itself.

### 11.4 Example app-owned components

```tsx
function CapabilityNudges() {
  const install = useInstallCapability();
  const notifications = useNotificationCapability();

  if (install.eligible) {
    return <MyInstallSheet capability={install} />;
  }

  if (notifications.eligible) {
    return <MyNotificationCard capability={notifications} />;
  }

  return null;
}
```

No Homeframe release may change app copy, visual hierarchy, or automatically
render a new nudge.

## 12. Manifest, icons, metadata, and splash assets

### 12.1 Generated manifest

The manifest generator MUST emit at least:

- stable `id`;
- `name` and `short_name`;
- `description` when configured;
- explicit `start_url` and `scope`;
- `display: "standalone"` by default and configured display overrides;
- `background_color` and `theme_color`;
- `icons` including at least 192x192 and 512x512 `any` icons plus a validated
  512x512 `maskable` icon;
- orientation only when the app explicitly constrains it;
- optional shortcuts, screenshots, categories, share targets, and protocol
  handlers where configured and supported.

The build MUST reject an `id`, start URL, or shortcut outside the declared scope.
It MUST warn prominently when an existing installed app changes `id` because that
can alter install identity and notification/focus behavior.

### 12.2 Apple and cross-platform assets

From source artwork and splash configuration, the adapter MUST generate:

- an `apple-touch-icon`, with a dedicated iOS source override when supplied;
- manifest icons at required and recommended sizes;
- maskable artwork with safe-zone validation;
- favicon formats for browser tabs;
- media-qualified Apple launch images for the maintained device/orientation
  catalog selected by the support policy;
- manifest and document colors matching the inline boot surface;
- an asset report showing every generated file, purpose, dimensions, and hash.

When both an Apple touch icon and manifest icons are emitted, documentation MUST
explain that iOS may give the Apple declaration precedence. The icon generator
MUST not silently crop a logo outside the maskable safe zone.

### 12.3 Metadata ownership and validation

`homeframe doctor` MUST detect duplicate or conflicting:

- viewport tags;
- manifests;
- app-capable/status-bar metadata;
- theme colors;
- Apple touch icons and startup images;
- service-worker registrations;
- root backgrounds.

Generated HTML MUST support a CSP nonce or hash for inline critical style/script.
No `unsafe-inline` requirement is acceptable.

## 13. Service worker

### 13.1 Default cache model

Homeframe uses build-time content hashes and a build identifier. It MUST NOT rely
on random cache-busting query strings.

| Request class | Default strategy | Notes |
| --- | --- | --- |
| Current HTML navigation | Network first with a bounded timeout; current precached shell on network failure | Never cache an opaque/error response as the shell |
| Hashed JS/CSS/worker chunks | Revisioned precache, cache first | Treated as immutable; all required current chunks install atomically |
| Local fonts and static media | Revisioned precache or bounded stale-while-revalidate | Selected by size/build config |
| User-requested images | Bounded stale-while-revalidate | Count, age, status, origin, and response-type limits required |
| Same-origin read API | Network only | Caching requires an explicit rule and data classification |
| Mutation/API write | Network only | Optional outbox is a separate explicit feature |
| Cross-origin resources | Network only | Explicit allowlist and cache rule required |
| Service worker script | Never runtime-cached | Served with revalidation-friendly headers |

Precache entries MUST be generated from the build graph. Every non-hashed entry
MUST have a content revision. Installation fails if a required entry cannot be
validated; the currently active worker and cache remain untouched.

Runtime caches MUST have maximum entries, maximum age, allowed status codes,
allowed response types, and quota-error cleanup. Framework cache cleanup MUST
delete only cache names owned by the same Homeframe app id.

The build-time configuration MUST expose the important cache choices without
requiring an app-authored worker:

```ts
interface ServiceWorkerConfig {
  precache?: {
    include?: string[];
    exclude?: string[];
    maximumFileSizeBytes?: number;
    additionalEntries?: Array<{ url: string; revision: string }>;
  };
  navigation?: {
    fallback: string;
    networkTimeoutSeconds?: number;
    allow?: Array<string | RegExp>;
    deny?: Array<string | RegExp>;
  };
  runtimeCaching?: RuntimeCacheRule[];
  caches?: {
    namespace?: string;
    revisionSalt?: string;
    cleanupOutdated?: boolean;
    legacyNamesToDelete?: string[];
  };
  update?: UpdateConfig;
  notifications?: NotificationWorkerConfig | false;
}

interface RuntimeCacheRule {
  match: string | RegExp | ((request: Request, url: URL) => boolean);
  method?: 'GET';
  strategy:
    | 'network-only'
    | 'cache-only'
    | 'cache-first'
    | 'network-first'
    | 'stale-while-revalidate';
  cacheName: string;
  networkTimeoutSeconds?: number;
  maxEntries: number;
  maxAgeSeconds: number;
  statuses?: number[];
  responseTypes?: Array<Response['type']>;
  sensitiveData?: 'none' | PrivateCacheConfig;
}

interface PrivateCacheConfig {
  partitionKey(request: Request): string | Promise<string>;
  purgeOnLogout: true;
}
```

Rules are evaluated in declaration order after the precache route. Overlapping
rules produce a build warning with example URLs. `revisionSalt` deliberately
invalidates all generated revisions and is the supported emergency full cache
bust; routine releases use content revisions. Page APIs MAY request an update
check or purge a named app-owned runtime cache, but MUST NOT expose an unscoped
“clear all origin storage” action.

### 13.2 Sensitive data rules

- Authenticated API responses, account-specific documents, and mutation results
  MUST NOT be cached by default.
- Opt-in private caching requires an app-provided partition key, logout purge
  callback, documented threat review, and tests for account switching.
- Push payloads and notification route values are untrusted input. The worker MUST
  validate schema, length, URL origin, and route scope; it MUST never insert payload
  HTML.
- Cache names MUST not contain access tokens, user email, or other personal data.
- Homeframe telemetry is off by default and MUST never collect notification
  payloads, input contents, or complete URLs without an explicit app adapter.

### 13.3 Update policy

```ts
type UpdateMode = 'automatic' | 'prompt' | 'on-restart' | 'manual';

interface UpdateConfig {
  mode: UpdateMode;
  checkOnLaunch?: boolean;       // default true
  checkOnForeground?: boolean;   // default true after a minimum age
  intervalMinutes?: number;      // visible documents only
  reload?: 'safe-point' | 'immediate';
}
```

The default is `mode: 'automatic', reload: 'safe-point'`.

All modes share this lifecycle:

```text
checking -> downloading -> ready/waiting -> activating -> reloading -> current
                 |                |
                 +-> failed ------+-> deferred
```

- A new worker MUST fully install and validate its revisioned precache before
  becoming `ready`.
- `automatic` requests activation and reloads each visible client at its next safe
  point.
- `prompt` waits and exposes headless update state/actions for an app-owned UI.
- `on-restart` lets the browser activate after old controlled clients close. It
  does not manufacture a reload while a client remains open.
- `manual` downloads the update but acts only when the app calls the activation
  action.
- `immediate` is allowed only when the application has explicitly accepted data
  loss risk. The build warns unless no update guards are registered.

The page API MUST include:

```ts
interface HomeframeUpdate {
  state: UpdateState;
  currentBuild: string;
  availableBuild?: string;
  check(): Promise<void>;
  activate(): Promise<void>;
  defer(): void;
  registerGuard(guard: UpdateGuard): () => void;
}
```

A safe point requires:

- no dirty or vetoing update guard;
- no active mutation/checkout/media-capture critical task;
- no open software keyboard;
- a stable viewport;
- no other Homeframe prompt or modal transition;
- a visible document, unless the configured resume shield deliberately performs
  the reload before revealing the app.

There is no default maximum deferral that can discard user work. Apps MAY add a
time-based policy only if they also define how drafts are preserved.

### 13.4 Multi-client and mixed-build safety

- Tabs/windows coordinate through service-worker messages and `BroadcastChannel`
  with a storage-event fallback.
- Exactly one client leads activation; every client observes the same build id.
- On `controllerchange`, each old client reloads at most once and only after the
  new worker confirms control.
- A route transition MUST not combine old HTML with a newly deleted lazy chunk.
  Deployments therefore retain assets for at least the rollback window, and the
  worker's atomic precache contains every entry required by the current shell.
- The server MUST deploy versioned assets before publishing the HTML/worker that
  references them.

### 13.5 Update checks and HTTP headers

Registration SHOULD use a stable same-origin worker URL and bypass intermediate
cache reuse for imports where supported. The worker client checks on:

- app launch;
- return to foreground after the configured minimum age;
- transition back online;
- a visible-only interval when configured;
- explicit application request.

Recommended response headers:

| Resource | Cache-Control |
| --- | --- |
| `sw.js` | `no-cache` or `max-age=0, must-revalidate` |
| app HTML | `no-cache` unless deployment architecture proves equivalent revalidation |
| hashed assets | `public, max-age=31536000, immutable` |
| manifest | short-lived/revalidated; never immutable across app metadata changes |

CDN configuration MUST be included in `doctor` deployment checks when a URL is
provided.

### 13.6 Offline and recovery behavior

- First successful online load precaches the complete minimum offline shell.
- Offline route navigation renders the shell plus app-supplied cached data or a
  structured offline boundary, never a browser error page for a known app route.
- `navigator.onLine` is a hint only. Actual request success determines network
  state and retries use bounded exponential backoff with jitter.
- A framework recovery route MUST remain network-first and be able to report
  registration, controller, build, cache ownership, and last worker error without
  exposing user data.
- The project MUST document a kill-switch deployment that replaces a bad worker
  at the same stable URL. Recovery never depends on asking ordinary users to clear
  all website data.

### 13.7 Push notifications and badging

Notification support requires app configuration for a public application-server
key and a transport adapter or endpoint:

```ts
notifications: {
  enabled: true,
  applicationServerKey: process.env.PUBLIC_VAPID_KEY,
  subscriptionTransport: '/api/push/subscriptions',
  defaultIcon: '/generated/notification-icon.png',
  defaultBadge: '/generated/notification-badge.png',
  routeAllowlist: ['/inbox', '/orders/'],
}
```

The framework MUST provide:

- permission and subscription APIs described in the nudge section;
- idempotent create/update/delete subscription transport semantics;
- `push` handling that always produces a user-visible notification when required
  by the Push contract;
- `notificationclick` behavior that focuses the best existing same-origin client
  and routes it, or opens a scoped app URL;
- optional `notificationclose` analytics through an app adapter;
- feature-detected actions, images, silent options, and Declarative Web Push;
- `setAppBadge` and `clearAppBadge` helpers in page and worker contexts;
- push-subscription rotation/reconciliation;
- a typed, versioned payload schema with a fallback title/body/route;
- local development commands for safe simulated push events.

The framework MUST clearly report that a delivery server is still necessary. It
MUST not embed a private VAPID key in client code. A public application-server key
is expected to be public.

## 14. Desktop Chrome behavior

On desktop Chrome, Homeframe MUST:

- generate an installable manifest and support `beforeinstallprompt` through the
  same headless install capability;
- use normal window dimensions and zero safe-area values where no inset exists;
- support software keyboards and the Virtual Keyboard API by feature detection on
  touch-capable devices without applying iOS heuristics to ordinary window resize;
- support installed/windowed and ordinary tab display modes;
- retain keyboard, focus, scroll, routing, update, offline, push, notification,
  badge, shortcuts, and theme behavior;
- allow responsive desktop layout inside `<AppShell>` and optional app-defined
  maximum widths; it MUST not force a phone-sized column;
- preserve title-bar drag and window-controls-overlay areas when an application
  explicitly opts into that Chromium feature.

The desktop experience MUST be functional with mouse, keyboard, trackpad, touch,
screen reader, window resize, high zoom, and multiple app windows.

## 15. Public React API

The initial stable API SHOULD include:

```ts
// Shell and viewport
HomeframeProvider
AppViewport
AppShell
AppHeader
AppScrollView
ViewportDock
KeyboardDock
HomeframePortal
SelectableText
NoCallout

// Inputs and focus
HomeframeInput
HomeframeTextarea
HomeframeSelect
useKeyboard
useViewport
useSafeArea
useRevealFocusedControl

// Lifecycle and resilience
HomeframeSplash
HomeframeErrorBoundary
HomeframeOfflineBoundary
useHomeframeReadiness
useDisplayMode
useAppLifecycle
useStateCheckpoint

// Routing
createHomeframeRouter
HomeframeRouterProvider
Link
NavLink
RouterOutlet
useNavigationDirection
useNavigationGesture
useRouteScrollRestoration
usePermalink

// Capabilities and nudges
HomeframeNudgeProvider
useInstallCapability
useNotificationCapability
useNudgeCoordinator

// Worker and updates
useServiceWorker
useHomeframeUpdate
useAppBadge
```

All stores used by React MUST be compatible with concurrent rendering and provide
a stable server snapshot. Event handlers MUST not require rerendering every app
component on each visual-viewport event; frame geometry is written to CSS first
and React state is coalesced.

## 16. Diagnostics and developer safeguards

### 16.1 Development overlay

An opt-in overlay MUST display, without affecting measurements:

- layout, stable, and visual viewport rectangles;
- safe-area insets;
- keyboard rectangle, source, and phase;
- active element and computed font size;
- window and registered scroll-root positions;
- display mode and lifecycle state;
- current/waiting worker build ids and update guards;
- route key/index/direction;
- install and notification capability blockers.

It MUST be togglable by query parameter and a programmatic API so an iPhone can be
debugged without a desktop inspector.

### 16.2 `homeframe doctor`

The doctor has static, built, and deployed modes. It MUST detect:

- conflicting root CSS and `body` scrolling;
- unsafe focused-control sizes;
- duplicate head metadata;
- invalid manifest identity/scope/assets;
- old and new service workers competing for a scope;
- unhashed or missing precache entries;
- missing navigation rewrites and incorrect content types;
- unsafe cache policies for authenticated routes;
- CSP incompatibility;
- incorrect `sw.js`, HTML, manifest, and hashed-asset cache headers;
- route chunks missing from the retained deployment;
- push configuration that includes a private key or lacks a subscription backend.

Every diagnostic has a stable code, severity, explanation, remediation, and link
to framework documentation. CI can promote warnings to errors.

### 16.3 Runtime events

Homeframe emits structured local events for viewport changes, unusual focus zoom,
resume duration, update deferral, worker failure, route recovery, install outcome,
and notification outcome. No event leaves the device unless the app registers a
telemetry adapter.

## 17. Accessibility and quality requirements

- App primitives MUST meet WCAG 2.2 AA when used as documented.
- The framework MUST never remove focus outlines without providing a visible
  `:focus-visible` replacement.
- All structural primitives accept semantic elements and ARIA attributes without
  overwriting valid app values.
- Header and bottom navigation are not automatically given landmark roles if that
  would create duplicates; semantic convenience wrappers are available.
- Text selection suppression cannot prevent input editing or app-declared copy.
- User zoom remains enabled and layouts work at 200% browser zoom on desktop.
- Dynamic Type/text-size testing is included in the iOS device matrix.
- Animations honor reduced motion; colors support forced/high contrast where the
  target browser exposes it.
- Keyboard-open layout changes MUST not produce avoidable layout shifts in the
  scrolling content.

## 18. Security and privacy requirements

- All privileged features require a secure context and explicit user action where
  the platform requires it.
- The default CSP guidance uses nonces/hashes, `worker-src 'self'`, and explicit
  `manifest-src`; Homeframe cannot require `unsafe-eval` in production.
- Service workers and persisted PWA assets increase the impact of XSS. The release
  process MUST include dependency review, output integrity checks, and CSP tests.
- Notification routes are restricted to configured same-origin scope.
- Push and runtime cache payloads are size-bounded and schema-validated.
- Nudge decisions contain capability state and timestamps only; permission values
  are not used for advertising or fingerprinting by the framework.
- Snapshot privacy mode is available for apps containing sensitive information.
- Logout MUST offer hooks to clear app-authorized private caches, subscriptions,
  and checkpoints without deleting unrelated origin storage.

## 19. Testing and conformance

### 19.1 Automated tests

The project MUST include:

- unit tests for every viewport and keyboard state transition, including reordered,
  duplicated, and missing browser events;
- property tests for geometry and safe-area calculations;
- browser tests for focus, scrolling, history, offline navigation, update modes,
  notification-click routing, and nudge policies;
- built-output tests for manifest, icons, splash media, CSP, service worker, and
  revision completeness;
- migration fixtures for supported project shapes and legacy service workers;
- an example app used unchanged across iOS device tests and desktop Chrome CI.

### 19.2 Required physical/device matrix

Before each stable release, test at least:

- a supported Face ID/home-indicator iPhone in portrait and landscape;
- a supported smaller iPhone viewport;
- an iPad in full screen and split view;
- software, hardware, floating, emoji, dictation, and third-party keyboard paths
  where available;
- installed Home Screen mode, Safari tab mode, cold launch, warm resume, and return
  after OS process termination;
- light/dark appearance, increased text size, reduced motion, VoiceOver, and zoom;
- desktop Chrome installed on macOS and Windows, plus Linux/ChromeOS in automated
  coverage where physical release testing is unavailable;
- offline, slow, interrupted deploy, partial precache failure, multiple windows,
  rollback, denied permission, revoked permission, and rotated push subscription.

Simulators are useful but MUST NOT replace physical iOS release testing for
keyboard, Home Screen launch, notification, snapshot, and edge-swipe behavior.

### 19.3 Core acceptance criteria

An implementation is conforming when these scenarios pass:

1. **Safe edges:** On every matrix orientation, the root background paints every
   screenshot pixel. Interactive header and dock content does not overlap a notch,
   rounded corner, status area, or Home indicator.
2. **Keyboard open:** Focusing each input type leaves visual viewport scale
   unchanged within measurement tolerance, keeps the header visible, attaches an
   `avoid` dock to the keyboard edge within 1 CSS px after settling, and leaves
   `window.scrollY === 0`.
3. **Keyboard switch/close:** Moving between fields produces no dock drop. Closing
   restores the dock to the safe bottom with no lasting gap and preserves the
   primary scroll anchor.
4. **Text behavior:** UI labels cannot be accidentally selected under the default
   policy. Inputs and marked content still support selection, copy, paste, and
   assistive technology.
5. **Resume:** Cold launch, warm resume, and killed-process relaunch never expose a
   framework-originated unpainted or default-white root; an intentional splash,
   shell, offline, or error surface is always visible.
6. **History:** Link navigation followed by device edge back/forward changes the
   route and restores its scroll position without increasing the document-load
   counter or remounting the shell.
7. **Offline:** After a complete first load, a known route opens offline to the app
   shell and intentional offline content. APIs not explicitly cached never leak a
   prior user's response.
8. **Atomic update:** Interrupting a new worker install keeps the old build fully
   usable. A completed automatic update waits for guards, activates once, reloads
   once, and runs one internally consistent build.
9. **Install nudge:** Chromium exposes a deferred prompt only after the app's own
   user action; iOS exposes manual instruction state; installed mode suppresses
   the nudge. Dismissal and cooldown survive relaunch.
10. **Notification nudge:** iOS browser mode reports `requires-install`; installed
    eligible mode requests permission only from the app's button; denial is not
    re-prompted; subscription and click routing are idempotent.
11. **Desktop:** The same production output is installable in desktop Chrome and
    works at narrow, wide, zoomed, keyboard-only, offline, and multi-window sizes.

## 20. Existing-project adoption runbook

This is the normative migration path for making Homeframe an upstream dependency
of an existing React application.

### Phase 0: inventory and protect identity

1. Create a normal migration branch and record the last known-good production
   build and deployment id.
2. Inventory:
   - bundler and React entry points;
   - HTML template and all PWA metadata;
   - current manifest `id`, `start_url`, `scope`, display mode, and icons;
   - every service-worker registration, URL, scope, cache name, caching rule, push
     handler, and update UI;
   - router, redirects, rewrites, link wrappers, route chunks, and scroll handling;
   - uses of `100vh`, `position: fixed/sticky`, body/document scrolling,
     `visualViewport`, `innerHeight`, safe-area environment variables, global
     touch handlers, selection suppression, and input font sizes;
   - CSP, CDN caching headers, authentication boundaries, offline storage, and push
     subscription backend.
3. Save the installed-app identity values. Unless the product intentionally wants
   a separate installed app, migration MUST preserve `id`, `scope`, and start URL.
4. Capture baseline device videos/screenshots and tests for login, deep links,
   back/forward, keyboard forms, update, offline, launch, and push.
5. Run `homeframe migrate --dry-run` when available. It MUST make no writes and
   produce a conflict/risk report.

Exit criterion: the team knows which current behavior is intentional, which caches
contain sensitive data, and which identifiers must remain stable.

### Phase 1: add Homeframe only as a dependency

1. Add compatible `@homeframe/*` packages using an exact version or organization
   lockfile policy.
2. Add the build plugin and `homeframe.config.ts`.
3. Populate configuration from the existing manifest rather than inventing new
   identity values.
4. Add source artwork but do not remove the old manifest/worker yet.
5. Generate to a temporary output and compare metadata, URLs, icons, and headers.
6. Run `homeframe doctor`; configure CI to retain its report.

Homeframe packages, not copied source files, are the upstream. Generated manifest,
icons, launch media, critical CSS, and service worker belong in build output unless
the deployment platform specifically requires committed output.

Exit criterion: a production build can be generated without changing runtime
registration or routing.

### Phase 2: adopt the document and shell

1. Let the Homeframe adapter own the viewport tag, app-capable metadata, manifest
   link, critical background, and boot splash. Remove duplicates only after built
   HTML comparison passes.
2. Wrap the existing root in `<HomeframeProvider>` and `<AppShell>`.
3. Move the persistent header and bottom navigation into shell slots.
4. Convert document/body scrolling to one or more `<AppScrollView>` regions.
5. Replace fixed bottom composers/search fields with `<KeyboardDock>`.
6. Replace raw portals with `<HomeframePortal>` so modals share viewport geometry.
7. Remove app-specific viewport listeners and safe-area spacers one at a time after
   matching their intentional behavior.
8. Adopt `controls-only` selection and mark real copyable regions.
9. Convert or fix every editable control to meet the 16px focus contract. The app
   may retain its own design-system components if their computed output conforms.

Exit criterion: the device keyboard/safe-area acceptance suite passes before the
router or worker is changed.

### Phase 3: adopt or adapt routing

Choose one path:

- **Built-in router:** map existing route definitions and loaders to Homeframe.
- **Adapter:** retain the current router and install the official adapter.
- **Conformance mode:** retain an unsupported router only after it passes the
  Homeframe history/scroll interface and test suite.

Then:

1. replace custom history mutation with router actions;
2. preserve canonical URLs, query behavior, redirect semantics, and route ids;
3. use genuine anchors through the framework `Link` or adapter;
4. configure server rewrites and worker document fallback from the same route
   matcher where possible;
5. register scroll roots and verify route-specific restoration;
6. verify deep links, notification links, OAuth returns, external links, and edge
   back/forward on a physical installed iPhone;
7. confirm the app shell does not remount across same-document routes.

Exit criterion: every in-scope route supports direct load, link navigation,
back/forward, reload, and offline fallback without an unintended document refresh.

### Phase 4: hand off the service worker safely

Never register two workers for the same intended scope and never clear all origin
caches indiscriminately.

1. Map old caching and push behavior into explicit Homeframe configuration.
2. Review every old API cache. Default it back to network-only unless the private
   data requirements are intentionally satisfied.
3. Keep the existing stable worker URL and scope when possible. Deploying the new
   worker at that URL lets the browser perform a normal worker update.
4. Give Homeframe caches a new app-id/build namespace. During activation, delete
   only enumerated legacy caches confirmed to belong to this app.
5. Ensure the old deployed hashed assets remain available for the rollback/mixed-
   client window.
6. Deploy versioned assets first, then HTML/manifest/worker.
7. Canary with `update.mode: 'prompt'` so update state can be inspected without an
   automatic fleet-wide reload.
8. Test install failure, offline activation, multi-tab coordination, process death,
   rollback, and a client held open across two deployments.
9. Move to `automatic` only after app update guards cover dirty forms and critical
   tasks.
10. Migrate push handling and verify existing subscriptions before enabling the
    notification nudge. The server must tolerate both worker payload versions for
    the migration window.

Exit criterion: old clients update atomically, sensitive old caches are removed by
name, push works, rollback works, and no user instruction to clear site data is
needed.

### Phase 5: add app-owned nudges

1. Place `<HomeframeNudgeProvider>` near the shell root.
2. Build an install component around `useInstallCapability()`.
3. Build a separate notification education component around
   `useNotificationCapability()`.
4. Configure engagement thresholds, cooldown, maximum impressions, suppressed
   routes, analytics adapter, and copy.
5. Confirm that install wins over notification on iOS browser mode and that no
   system prompt occurs before a direct button press.
6. Test already-installed, dismissed, denied, revoked, unsupported, offline,
   subscription-expired, and multi-window states.

Exit criterion: nudge display is fully controlled by app components while platform
actions and persistence remain framework-owned.

### Phase 6: release and observe

1. Run static, built, deployed, desktop, and physical-iOS conformance suites.
2. Verify CDN headers and route rewrites against the real production origin.
3. Ship a small canary cohort or environment first.
4. Watch framework events for blank-boot recovery, viewport anomalies, update
   failures, reload loops, offline failures, and push click routing. Telemetry
   remains app-owned and opt-in.
5. Expand only after at least one old-to-new update, one rollback rehearsal, and
   one killed-process launch pass.

### Rollback procedure

1. Re-deploy the previous known-good application while retaining any new hashed
   assets referenced by active clients.
2. Serve a corrected compatible worker from the same stable worker URL. Do not
   merely delete the file or unregister from page code.
3. Keep cache schemas readable for at least one previous Homeframe release, or
   write an explicit forward/backward migration.
4. Never roll back by changing manifest `id` or scope.
5. Use the recovery route to verify controller/build/cache state.
6. If a data schema is not backward compatible, block the application rollback
   before deployment; service-worker rollback cannot repair server data.

### Ongoing upstream upgrades

- Pin Homeframe by normal semver/lockfile policy and automate update pull requests.
- Run `homeframe upgrade --from <version> --to <version>` for codemods and a
  machine-readable breaking-change report.
- Require `doctor`, migration fixtures, built-output diff, and device smoke tests
  on every major/minor framework upgrade.
- Applications may extend documented tokens and adapters; they MUST NOT patch
  generated runtime output in place.
- The framework publishes a compatibility table, deprecation period, cache-schema
  compatibility, worker rollback window, and identity-impact notice for every
  release.
- If the application was originally cloned from a Homeframe starter repository,
  treat the starter as examples only. Prefer package upgrades. If Git upstream is
  retained, merge tagged starter changes into a dedicated integration branch and
  never let it overwrite app code or generated configuration automatically.

## 21. Recommended additional capabilities

These ideas are included because they prevent common “second wave” PWA failures:

1. **Install diagnostics and education state.** iOS has no universal programmable
   install prompt, so structured manual steps and suppression after installed
   launch are essential.
2. **Update guards and draft checkpoints.** Automatic updates are only pleasant if
   they cannot erase a half-completed form.
3. **Resume resilience.** Treat memory loss as normal and make URL/shell restoration
   a first-class path, not an error case.
4. **Privacy snapshots.** Financial, health, and messaging apps should be able to
   hide sensitive content in the system app switcher.
5. **Offline outbox as an explicit module.** Retrying writes can be useful, but it
   requires idempotency keys, user-visible status, conflict handling, and a server
   contract; it should never be an invisible default.
6. **Storage health.** Expose quota/persistence status, bounded cache sizes, and a
   product-controlled “downloaded for offline” manager because mobile storage may
   be evicted.
7. **Auth/external-navigation helpers.** Preserve return routes across OAuth or
   native-app handoffs and clearly distinguish in-scope links from external ones.
8. **Badging, shortcuts, share targets, and protocol handling.** Keep these
   feature-detected, headless, and generated from the same route/identity config.
9. **A device debug HUD and capture export.** Viewport bugs are much easier to fix
   when a tester can export geometry/event history directly from the phone.
10. **Release channel support.** Stable, canary, and rollback worker channels allow
    real update testing without changing installed-app identity.

## 22. Delivery plan

### Milestone 1: viewport foundation

- bootstrap runtime, CSS variables, safe areas, app shell, scroll view, header,
  docks, input enforcement, selection policy, splash, diagnostics;
- physical iOS keyboard/orientation test application.

### Milestone 2: build and installation

- Vite adapter, config validation, manifest/icon/launch generation, CSP support,
  install capability, desktop installability, doctor static/built modes.

### Milestone 3: routing and lifecycle

- router and adapter contract, History API direction, scroll restoration, deep
  links, resume shield, state checkpoints, edge-navigation device tests.

### Milestone 4: worker and notifications

- revisioned precache, bounded runtime caching, offline boundary, update policies,
  update guards, multi-client coordination, push/click/badge, notification
  capability and nudge policy.

### Milestone 5: migration and release hardening

- CLI migrate/upgrade flows, legacy-worker fixtures, deployed doctor, recovery
  route, canary channel, full matrix, documentation, compatibility policy.

No stable v1 release should occur before the physical device acceptance suite and
an old-worker-to-v1 migration have both passed.

## 23. Open product decisions

These do not block an initial prototype, but should be decided before API freeze:

1. Final framework/package name and npm scope.
2. Exact minimum iOS/iPadOS version versus the rolling support policy.
3. Whether the built-in router is the recommended default or the first release
   should lead with a React Router adapter.
4. Whether the default app-switcher snapshot is `preserve` or `brand`; sensitive
   products will still override it with `privacy`.
5. The default install/notification engagement thresholds and whether products
   must set them explicitly.
6. The standard push subscription transport schema, including authenticated and
   anonymous subscription rotation.
7. Which deployment providers receive first-party header/rewrite adapters.

Recommended defaults are: rolling current-plus-two iOS support, a first-party
history router plus React Router adapter, `brand` resume snapshots, conservative
nudge timing, automatic-safe updates, and Vite as the first build adapter.

## 24. Primary platform references

- [WebKit: safe areas and `viewport-fit=cover`](https://webkit.org/blog/7929/designing-websites-for-iphone-x/)
- [MDN: Visual Viewport API](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport)
- [W3C: CSS viewport and interactive widgets](https://www.w3.org/TR/css-viewport-1/)
- [W3C: Virtual Keyboard API](https://www.w3.org/TR/virtual-keyboard/)
- [MDN: viewport metadata and zoom accessibility](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport)
- [W3C: Web Application Manifest](https://www.w3.org/TR/appmanifest/)
- [Apple: configuring installed web applications](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html)
- [WebKit: Web Push for iOS/iPadOS Home Screen apps](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [WebKit: Badging for Home Screen web apps](https://webkit.org/blog/14112/badging-for-home-screen-web-apps/)
- [Chrome: Workbox precaching and revision behavior](https://developer.chrome.com/docs/workbox/modules/workbox-precaching)
- [Chrome: service-worker update events](https://developer.chrome.com/docs/workbox/modules/workbox-window)
- [Chrome: PWA manifest/installability guidance](https://developer.chrome.com/docs/lighthouse/pwa/installable-manifest)
