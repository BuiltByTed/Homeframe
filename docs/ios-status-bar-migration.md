# iOS status-bar migration

Homeframe now resolves an omitted `splash.appleStatusBarStyle` to `default` once
and uses that value for both installation metadata and bootstrap geometry. The
scaffold and kitchen sink explicitly select it. Set it explicitly in existing
applications as well:

```ts
splash: {
  // Preserve the application's other splash settings.
  appleStatusBarStyle: 'default',
},
```

`homeframe doctor` fails, even without `--strict`, when source configuration
explicitly selects another value, built/deployed HTML lacks exactly one status-bar
declaration with `content="default"`, or the bootstrap cannot verify the same
setting with translucent-mode geometry disabled. Without a build or `--url`,
doctor fails because source inspection alone cannot establish the effective
output. Dynamic/imported config is verified through the generated artifact.
`--strict` continues to fail other warnings as well.

The adapter still accepts legacy `black` and `black-translucent` configurations
with a migration warning so their geometry can be supported during migration.
They are **not compliant** with this fix and fail doctor. Existing runtime
geometry support remains in place for older installed surfaces.

## Installation behavior

Automated HTML checks and Chromium viewport tests verify the generated build
contract. Native iOS appearance requires separate installed-app testing.

Preserve one persistent provider/router/viewport/shell/header and primary
`AppScrollView`, opaque app/header/dock/sidebar surfaces, and the project's
existing Homeframe theme integration. Do not add duplicate metadata, safe-area
padding, fixed covers, blur masks, or viewport measurements. Do not change
manifest identity, scope, start URL, or worker URL to replace an installation.

Protect local-only data and installation-bound sign-in state before removing an
affected Home Screen installation. Re-add from Safari after deployment. A reload
or service-worker update alone may not change retained native metadata.
