# @builtbyted/react

React providers, app-shell primitives, keyboard-aware docks, lifecycle UI,
updates, diagnostics, and capability hooks for
[Homeframe](https://github.com/BuiltByTed/Homeframe).

Start a new application with `npx scaffold-homeframe-app my-app`.

Use `AppShell.headerAttachment` and `AppShell.bottomAttachment` for measured UI
that stays below the header or above the bottom dock while route content scrolls
behind it. `ViewportAttachment` provides the same primitive directly. It owns
geometry and keyboard participation only; application CSS owns appearance.

Existing products can use `<AppShell manualComposition>` when their shell DOM
must remain stable. Compose `AppHeader`, `AppScrollView`, `ViewportDock`, and
`HomeframePortal` explicitly inside it; Homeframe marks and coordinates the
shell without creating duplicate convenience regions.
