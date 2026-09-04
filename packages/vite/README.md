# @builtbyted/vite

The Vite adapter for [Homeframe](https://github.com/BuiltByTed/Homeframe). It
generates validated browser metadata, icons, launch assets, the manifest,
bootstrap presentation, and the service worker from `homeframe.config.ts`.

Set `splash.showInBrowserTabs: false` when the branded HTML boot surface should
remain an installed-app launch treatment and ordinary browser tabs should paint
the configured app background until React is ready.

Start a new application with `npx scaffold-homeframe-app my-app`.
