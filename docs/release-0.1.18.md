# Homeframe 0.1.18

Both `@builtbyted/homeframe` and `scaffold-homeframe-app` advance to 0.1.18.
The starter pins the matching framework version. This remains a 0.1.x preview
release; native-device acceptance is separate from automated validation.

- The iOS HTML launch splash now measures the visible layout viewport before
  paint to align its logo with the native startup image when an opaque status
  bar shifts the content origin. This handles cold-launch frames where CSS
  viewport units have not yet settled.
- Splash geometry is recalculated when only the viewport height changes, and
  incomplete initial measurements are retried as the viewport settles.
- Windowed iPad apps retain their own splash canvas, and the default opaque
  status-bar policy remains in place.

## Upgrade

Pin `@builtbyted/homeframe` to `0.1.18`, update the lockfile, rebuild, run strict
doctor, and deploy the matching artifacts. Preserve installed-app identity and
scope, and keep `splash.appleStatusBarStyle` set to `default`.

Regression coverage includes opaque iOS splash alignment, incomplete cold-launch
geometry, and viewport-height settlement. Native installed iOS launch appearance
still requires device verification.
