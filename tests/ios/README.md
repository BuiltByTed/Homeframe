# iOS Simulator regression harness

This XCUITest host opens the built kitchen-sink PWA in a standalone `WKWebView` configuration and verifies the geometry contract using the same URL and output a tester sees.

The default Safari-tab URL is `http://127.0.0.1:4180/`; set
`HOMEFRAME_TEST_URL` in `tests/ios/project.yml` or in the generated test scheme
when the exact build is served elsewhere. Generate the Xcode project with
XcodeGen, and run:

```bash
xcodebuild test \
  -project HomeframeSimulatorTests.xcodeproj \
  -scheme HomeframeSimulatorTests \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  CODE_SIGNING_ALLOWED=NO
```

The tests check the actual installed Home Screen web app for full-edge painting,
stationary document scroll, persistent header geometry, dock/composer tracking,
input switching, keyboard close restoration, focus-scale stability, and managed
Back/Forward gestures. They also launch Mobile Safari through the test host and
verify that app-owned interactive controls remain clear of Safari's browser
chrome. The configured URL must be reachable and its certificate trusted by the
simulator.

This is a deterministic regression harness. The physical-device matrix in `SPEC.md` remains required before a stable release because simulator WebKit does not reproduce every Home Screen, keyboard, snapshot, notification, or edge-swipe behavior.
