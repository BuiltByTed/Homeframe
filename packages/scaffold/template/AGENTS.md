# Homeframe coding-agent contract

Read `docs/HOMEFRAME_RUNBOOK.md` before changing application architecture. Treat
that runbook and `homeframe.config.ts` as required project context.

## Non-negotiable boundaries

- Keep exactly one `HomeframeProvider`, one `HomeframeRouterProvider`, one
  top-level `AppViewport`, one `AppShell`, and one primary `AppScrollView`.
- Mount `AppShell` and `AppScrollView` above `RouterOutlet`. Route components
  render page content only. Never put `AppShell`, `AppViewport`, or a page-frame
  wrapper that creates either one inside a route element; the shell, header, and
  primary scroller DOM nodes must retain identity across navigation.
- Compose persistent chrome through `AppShell`. The document itself must never
  scroll.
- Keep the framework-owned header wrapper and top safe-area backing opaque using
  the app colors generated from `homeframe.config.ts`. Do not apply transparency,
  `backdrop-filter`, or `-webkit-backdrop-filter` to `[data-hf-header]`; style an
  inner app header instead.
- Put fixed bottom navigation or composers in the `AppShell` `bottom` slot or a
  `ViewportDock`/`KeyboardDock`. Do not position app-owned controls against the
  browser viewport.
- Do not use `100vh`, `100dvh`, `window.innerHeight`, direct `visualViewport`
  measurements, document scrolling, or hand-written safe-area geometry. Use
  Homeframe CSS variables and hooks.
- Do not register a service worker, author a web manifest, or add viewport,
  theme-color, Apple icon, startup-image, or app-capable tags. The
  `@builtbyted/homeframe/vite` adapter generates and owns them.
- Preserve `app.id`, `app.scope`, `app.startUrl`, and the deployed worker URL once
  the app has users. These values are installation identity, not ordinary config.
- Use `HomeframeInput`, `HomeframeTextarea`, or `HomeframeSelect` for editable
  controls. All rendered editable text must be at least 16 CSS px.
- Use the Homeframe router, `Link`/`NavLink`, route scroll restoration, and URL
  state/permalinks. Do not replace it with page reloads or a second router.
- Keep `@builtbyted/homeframe` pinned to an exact version.
- Keep application code in strict TypeScript. Do not add JavaScript source files.

## Change workflow

1. Inspect the current shell, route, and `homeframe.config.ts` before editing.
2. Decide whether the change is product UI or framework-owned browser behavior.
3. Implement product UI inside existing Homeframe primitives. If a required
   primitive is missing, stop and identify the framework gap instead of bypassing
   its ownership boundary.
4. Preserve real links, accessible names, focus behavior, reduced motion, and
   light/dark surfaces.
5. Run `npm run check` before declaring the change complete.
6. For viewport, keyboard, safe-area, routing, lifecycle, install, notification,
   or worker changes, complete the device checks in the runbook.

## Definition of done

- `npm run typecheck`, `npm run build`, and `npm run doctor` pass.
- `window.scrollY` remains zero on every route.
- The header does not move when the keyboard opens.
- The same header and primary scroller nodes survive route navigation, the top
  safe-area surface is opaque, and computed backdrop filters are `none`.
- The bottom dock follows keyboard geometry without exposing content behind it.
- A user can scroll a long route/thread while the keyboard is open without the
  framework restoring an old scroll position or oscillating the shell.
- The native startup image and HTML splash keep the logo at the same full-screen
  center with no intermediate jump.
- Back/Forward, deep links, reload, offline launch, and update activation preserve
  the expected route and state.
- No duplicate framework ownership was introduced.
