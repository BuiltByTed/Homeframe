# iOS Simulator regression harness

This XCUITest host opens the built kitchen-sink PWA in a standalone `WKWebView` configuration and verifies the geometry contract using the same URL and output a tester sees.

Set `HOMEFRAME_TEST_URL` in `tests/ios/project.yml` or in the test scheme, generate the Xcode project with XcodeGen, and run:

```bash
xcodebuild test \
  -project HomeframeSimulatorTests.xcodeproj \
  -scheme HomeframeSimulatorTests \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  CODE_SIGNING_ALLOWED=NO
```

The tests check full-edge painting, stationary document scroll, persistent header geometry, dock/composer tracking, input switching, keyboard close restoration, and focus-scale stability. The URL must be reachable and its certificate trusted by the simulator.

This is a deterministic regression harness. The physical-device matrix in `SPEC.md` remains required before a stable release because simulator WebKit does not reproduce every Home Screen, keyboard, snapshot, notification, or edge-swipe behavior.
