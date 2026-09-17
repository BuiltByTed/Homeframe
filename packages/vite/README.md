# @builtbyted/vite

The Vite adapter for [Homeframe](https://github.com/BuiltByTed/Homeframe). It
generates validated browser metadata, icons, launch assets, the manifest,
bootstrap presentation, and the service worker from `homeframe.config.ts`.

By default, the branded splash appears only in installed mobile apps, including
phones and tablets. Browser tabs and installed desktop apps skip it before first
paint. `splash.showInBrowserTabs: true` and `splash.showInDesktopApps: true` are
explicit opt-ins; `splash.enabled: false` also disables generated Apple startup
images. Privacy snapshots remain independent of branded launch presentation.

Install icons use `purpose: any` by default. `app.maskableIcon` explicitly opts
into platform masking; the starter and kitchen sink leave it unset. Icon metadata
does not override every browser or operating-system decoration policy.

Start a new application with `npx scaffold-homeframe-app my-app`.
