# Homeframe application runbook

This is the operating contract for humans and AI coders building
__HOMEFRAME_APP_NAME_MARKDOWN__. It explains where product code belongs, what the
framework owns, and which checks are required before a release.

## 1. Start from the ownership boundary

Homeframe owns browser and installed-app behavior that must remain coherent:

- the document viewport and full-screen canvas;
- all four safe areas and keyboard geometry;
- persistent header/sidebar/bottom-dock placement;
- the sole app scrolling region;
- generated manifest, icons, launch images, bootstrap presentation, and critical
  browser metadata;
- same-document routing, history direction, edge gestures, deep links, and scroll
  restoration;
- the service worker, atomic caches, update activation, offline navigation, push
  routing, and badging;
- lifecycle snapshots, readiness, installation capability, and notification
  capability.

The application owns routes, product components, content, data fetching, domain
state, authentication, authorization, visual design inside the shell, and the UI
that explains install or notification choices.

If a feature crosses both sides, keep browser mechanics in Homeframe and pass
narrow state/actions into app-owned UI. Do not implement a competing subsystem.

## 2. Preserve the root composition

The expected hierarchy is:

```text
HomeframeProvider
└── HomeframeRouterProvider
    └── AppViewport
        └── AppShell
            ├── header: persistent application header
            ├── children: AppScrollView → RouterOutlet
            └── bottom: persistent navigation or keyboard-aware composer
```

Use one instance of each root provider and viewport. A route renders inside the
existing `RouterOutlet`; it does not mount another viewport, manipulate the
document, or create an independent global scroller.

There must also be exactly one persistent `AppShell` above `RouterOutlet` and one
active primary `AppScrollView` inside that shell around the outlet. The scroller
may be keyed by route when route-scoped restoration requires a fresh node. The
shell and header DOM identity must survive every same-document route change. A
route-local `PageFrame` that mounts its own `AppShell` is not a harmless
abstraction: it tears down the safe-area backing between routes, allowing iOS to
expose its transient blur/snapshot layer.

Do not do this:

```tsx
const routes = [
  { path: '/inbox', element: <PageFrame><Inbox /></PageFrame> },
];

function PageFrame({ children }: { children: React.ReactNode }) {
  return <AppShell><AppScrollView>{children}</AppScrollView></AppShell>;
}
```

Keep `PageFrame` route-local only when it renders ordinary semantic page content
and never creates a provider, viewport, shell, header, dock, or primary scroller.

`AppScrollView` is the page scroller. Pass it `scrollKey`, `navigationType`,
`scrollBehavior`, and `permalinkScroll` from `useRouteScrollRestoration()`.
Scrollable widgets inside a page must be deliberately bounded and must not turn
the body into a scrolling fallback.

## 3. Add a route

1. Create a product page component.
2. Add its route to the single `createHomeframeRouter` declaration.
3. Navigate with `Link`, `NavLink`, or the router's navigation API so links remain
   copyable and openable in a new context.
4. Put durable/shareable view state in route parameters, query parameters, or a
   Homeframe permalink. Do not treat `history.state` as a permalink.
5. Verify direct loading, reload, Back, Forward, and cold launch for the URL.

Production hosting must rewrite every in-scope document route to `index.html`.
The generated worker provides the matching offline fallback but cannot fix a
server that returns a production 404 before the app is installed.

## 4. Add page UI

Use ordinary semantic React components inside a route. Follow these constraints:

- Use `HomeframeInput`, `HomeframeTextarea`, and `HomeframeSelect` for editable
  controls. Keep computed editable text at 16px or larger.
- Use `SelectableText` or `data-hf-selectable` only where users need selection or
  copying. Other UI text is protected from accidental iOS selection/callouts.
- Use Homeframe viewport/safe-area hooks and `--hf-*` CSS variables. Never sample
  raw browser viewport geometry or invent device-specific inset constants.
- Use a dock primitive for persistent bottom controls. Do not add page-level
  `position: fixed` controls.
- Keep loading, empty, offline, error, and retry states inside the stable shell.
- Maintain keyboard navigation, visible focus, accessible names, contrast,
  reduced-motion behavior, and 200% desktop zoom usability.

The `AppShell` header slot owns the entire top safe-area surface. Leave its
safe-area behavior enabled and keep the framework-owned `[data-hf-header]`
wrapper opaque with the app background generated from `homeframe.config.ts`.
Do not put `backdrop-filter`, `-webkit-backdrop-filter`, opacity, or a transparent
background on that wrapper. Product styling belongs on the inner header component.
If the framework wrapper computes to a translucent surface, iOS can show its
system blur above the app bar; that is a shell contract violation, not a reason to
add another fixed header.

## 5. Change branding or installation metadata

Edit only `homeframe.config.ts` and assets under `brand/`. Homeframe generates the
manifest, Apple metadata, install icons, maskable icon treatment, launch images,
theme colors, boot splash, and worker build metadata.

Before the first production release, choose final values for `app.id`, `scope`,
`startUrl`, `display`, icon, colors, and worker policy. After users install the
app, treat identity and worker scope as immutable. A visual rebrand may change
names, icons, and colors, but it must not silently create a second installed app
identity or abandon the existing worker.

Do not hand-author generated tags in `index.html`; keep only ordinary document
content such as charset and title there.

Do not style or replace `#homeframe-boot-splash`. `splash.title: ''` intentionally
generates no title element, and Homeframe keeps the logo centered against the same
full-screen canvas used by the generated Apple startup image. An app-level
`:empty` rule, safe-area offset, viewport measurement, or splash animation is a
workaround that reintroduces launch movement.

## 6. Add a bottom composer or navigation

Pass persistent bottom UI to `AppShell`'s `bottom` slot. Homeframe wraps it in a
keyboard-aware dock using the configured policy. Use `ViewportDock` or
`KeyboardDock` directly only for a deliberate nested shell composition.

Placement and keyboard behavior are separate. A search field or composer that
must cover content without reserving a shell row uses
`<ViewportDock placement="overlay" keyboard="avoid">`. Homeframe then owns the
three-edge placement, safe areas, hit testing, measurement, and keyboard
translation together. Do not reproduce that combination with absolute/fixed app
CSS. The legacy `keyboard="overlay"` value remains compatible, but it means
overlay placement without keyboard avoidance.

For persistent content that belongs next to existing shell chrome while route
content scrolls behind it, use a measured viewport attachment:

```tsx
<AppShell
  header={<Header />}
  headerAttachment={<VideoPlayer />}
  bottom={<BottomNavigation />}
  bottomAttachment={<SearchComposer />}
  bottomAttachmentKeyboard="avoid"
>
  <AppScrollView>{/* route content */}</AppScrollView>
</AppShell>
```

To let the software keyboard cover persistent navigation while only the
attachment follows it, use `bottomKeyboard="manual"` together with
`bottomAttachmentKeyboard="avoid"`.

The direct form is `<ViewportAttachment anchor="header">` or
`<ViewportAttachment anchor="dock" keyboard="avoid">`. Use at most one per
edge and put any multi-row UI inside it. Homeframe measures the stack, positions
it against the header/dock, keeps physical-edge controls out of navigation
guards, and classifies bottom fields as keyboard-dock targets. The primitive
provides geometry only: the app owns its colors, typography, borders, and other
visual design.

Never substitute app CSS using `position: fixed` or `position: sticky`.
`npm run doctor` runs `homeframe doctor --strict`, which reports
`HF_UNTRACKED_VIEWPORT_UI` and fails the compliance check. When ESLint is part
of the application toolchain, enable the Homeframe plugin to report inline
fixed/sticky styles earlier during authoring.

Test all transitions: closed → opening → open, switching between fields, open →
closing → closed, rotation while focused, hardware keyboard, dictation, emoji,
and a third-party keyboard. The header must stay fixed, the active control must
remain reachable, and no product content may show through the keyboard-owned
rectangle.

Also scroll a long message thread or form while the software keyboard stays open.
The primary scroller must remain under the finger and continue naturally after
release; Homeframe must not restore a pre-focus anchor, reverse the gesture, or
oscillate the shell. Record separate native iPhone Simulator videos for keyboard
opening and closing, step every encoded movement frame, and compare the dock edge
to the keyboard edge. Browser emulation is useful for deterministic logic tests
but is not iOS keyboard-animation evidence.

## 7. Add lifecycle or update-sensitive state

Use `useStateCheckpoint` for small drafts or route-local state that should survive
iOS process eviction. Do not store secrets, tokens, large server records, or an
entire client cache in a checkpoint.

Use readiness holds only for data that must exist before the startup surface is
removed, and always release every hold. Guard an update while destructive work
or an unsaved transaction is active; do not defer updates indefinitely.

Never call `navigator.serviceWorker.register()` yourself. Configure Homeframe's
worker and update policy in `homeframe.config.ts`, then use Homeframe update state
and actions for app-owned UI.

With automatic launch checks, Homeframe keeps the HTML startup layer visible
until a waiting worker has either activated or been safely deferred. Do not hide
the splash yourself or mark the root ready to avoid an update delay; doing so can
produce an app → splash → app flash during startup.

## 8. Add install or notification UI

Installation and notification hooks are headless: the app owns presentation and
copy, while Homeframe owns eligibility and browser actions. Ask for notification
permission only from a clear user gesture. On iOS browser mode, explain that the
app must first be added to the Home Screen.

Enabling real push requires an authenticated and CSRF-protected subscription
transport plus a server-held VAPID private key. Only the public application server
key belongs in browser configuration. Do not copy a demonstration delivery server
into production without an application-specific security review.

## 9. Automated validation

Run after ordinary application changes:

```bash
npm run typecheck
npm run build
npm run doctor
```

`npm run check` runs the build and strict doctor sequence. Fix errors at the
ownership boundary; do not silence the doctor by hiding unsafe code or editing
generated output.

For a deployed staging URL, also run:

```bash
npx homeframe doctor --root . --dist dist --url https://staging.example.com --strict
```

## 10. Device acceptance matrix

Before production—and after any framework, shell, viewport, keyboard, routing,
lifecycle, install, notification, or service-worker change—test the same built
artifact in:

- desktop Chrome and Safari tabs;
- an installed desktop Chrome PWA window;
- iOS Safari;
- a newly installed iOS Home Screen app;
- an existing installed app upgrading from the currently deployed version;
- portrait and landscape on representative small and large iPhones;
- iPad full-screen and split view;
- light/dark mode, reduced motion, VoiceOver, larger text, and 200% desktop zoom;
- cold start, warm resume, app switching, OS-terminated restore, offline, slow
  network, interrupted updates, and update recovery;
- Back/Forward buttons, installed-iOS edge gestures, direct deep links, scroll
  restoration, and notification clicks into both running and terminated apps.

During keyboard tests record `window.scrollY`, header position, dock position, and
focused-control bounds before focus, while open, while changing fields, and after
close. `window.scrollY` must always be zero.

Record a cold Home Screen launch and inspect it frame by frame. The generated
native startup logo and HTML splash logo must use the same full-screen center; no
intermediate frame may move the logo toward or away from a safe area. Across route
navigation, verify that the shell and header remain the same nodes, exactly one
primary scroller is active, the header's safe-area backing is opaque, and both
computed backdrop-filter properties are `none`. While the keyboard is open, drag
the longest thread/form in both directions and reject any frame that reverses or
oscillates after the finger movement.

## 11. Release and rollback

Keep `@builtbyted/homeframe` on an exact version and update it in one lockfile
change. Build once, test that artifact, and promote the same files.
Deploy versioned assets before revalidating HTML and the worker. Retain assets
used by both the active and previous worker throughout the rollback window.

Rollback by publishing a repaired worker at the same URL, scope, and application
identity. Do not tell ordinary users to clear all website data and do not change
identity to escape a broken release.

## 12. AI coder handoff prompt

Use this at the start of an AI coding session:

```text
Read AGENTS.md, docs/HOMEFRAME_RUNBOOK.md, homeframe.config.ts, and the current
AppShell/router composition before editing. Keep Homeframe's ownership boundaries
intact. Implement the requested product behavior inside existing primitives, run
npm run check, and report any framework gap instead of bypassing it.
```
