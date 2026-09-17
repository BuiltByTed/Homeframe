# Homeframe 0.1.16

Both `@builtbyted/homeframe` and `scaffold-homeframe-app` advance to 0.1.16. The
starter pins the matching framework version. This is part of the 0.1.x preview
line; native-device acceptance remains separate from automated validation.

- `AppShell.sidePanel` accepts a persistent, general-purpose `SidePanel` on the
  left or right. It narrows the whole app when there is space, overlays on
  narrower desktops, and fills the mobile UI. Configurable width and thresholds,
  independent scrolling, header/footer slots, keyboard geometry, modal focus,
  Escape/backdrop dismissal, focus restoration, and reduced motion are included.
  Toggle `open` while keeping the panel mounted to preserve drafts and scroll.
- The Vite adapter resolves `splash.appleStatusBarStyle` once, defaulting to
  `default`, and uses it for both installation metadata and bootstrap geometry.
  Scaffold and kitchen-sink configurations explicitly select `default`.
- `homeframe doctor` now fails for non-default status bars, missing/duplicate
  declarations, and unverifiable or mismatched bootstrap settings, even without
  `--strict`. It verifies generated document routes/fallbacks as well as the
  entry document, and applies the status-bar check to deployed HTML with `--url`.
  Source-only doctor runs without a build or deployed URL now fail because they
  cannot establish the effective installation metadata.
- Legacy `black` and `black-translucent` configurations retain build/runtime
  geometry support and receive migration diagnostics, but fail compliance.
  App-authored duplicate status-bar tags are rejected during HTML generation.
- The kitchen sink demonstrates both panel edges and all responsive modes.
  Its GitHub Pages deployment runs strict doctor before publishing.

## Upgrade

Pin `@builtbyted/homeframe` to `0.1.16`, explicitly select
`splash.appleStatusBarStyle: 'default'`, rebuild, run strict doctor, and deploy
matching HTML/bootstrap/styles/assets/worker. Preserve app identity and scope.
Affected older Home Screen installations may retain native translucent metadata
across code updates; protect local-only data and installation-bound sign-in state
before removing and re-adding from Safari. Publishing or updating the npm package
alone does not change retained native metadata.

The [migration guide](./ios-status-bar-migration.md) describes the build contract
and installation requirements. Automated checks do not establish physical-iPhone,
rotation, VoiceOver, or native header-blur acceptance.
