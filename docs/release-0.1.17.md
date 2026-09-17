# Homeframe 0.1.17

Both `@builtbyted/homeframe` and `scaffold-homeframe-app` advance to 0.1.17.
The starter pins the matching framework version. This remains a 0.1.x preview
release; native-device acceptance is separate from automated validation.

- Branded splash presentation now defaults to installed mobile apps, including
  tablets. Browser tabs and installed desktop apps skip the HTML and React splash
  before first paint and during branded resume presentation. Explicit opt-ins
  remain available through `showInBrowserTabs` and `showInDesktopApps`.
- The iOS HTML launch logo accounts for the opaque status-bar content origin to
  align with the generated native startup image. Both use `splash.logo` artwork.
  Runtime shell measurements and keyboard settlement do not recenter the logo.
- `splash.enabled: false` disables branded presentation and generated Apple
  startup images. Explicit privacy snapshots remain available on every platform.
- The starter and kitchen sink emit `purpose: any` install icons. Maskable icon
  treatment requires an explicit `app.maskableIcon` configuration; metadata does
  not override every browser or operating-system decoration policy.
- `splash.appleStatusBarStyle: 'default'` and its strict doctor checks remain in
  place, along with legacy geometry support for existing installations.

## Upgrade

Pin `@builtbyted/homeframe` to `0.1.17`, update the lockfile, rebuild, run strict
doctor, and deploy the matching artifacts. Keep `splash.appleStatusBarStyle` set
to `default`. Remove explicit splash opt-ins or `app.maskableIcon` settings when
adopting the corresponding defaults. Preserve installed-app identity and scope.

Automated coverage includes the launch-mode matrix, generated metadata, viewport
settlement, privacy presentation, and package/scaffold checks. Native installed
iOS launch appearance and desktop operating-system icon rendering still require
device verification.
