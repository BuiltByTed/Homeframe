import XCTest

final class HomeframeSimulatorUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testStandaloneLayout() throws {
        let webApp = try launchHomeframe()
        let appTitle = webApp.staticTexts["Homeframe"]
        XCTAssertTrue(appTitle.waitForExistence(timeout: 15))

        let window = webApp.windows.firstMatch.frame
        XCTAssertEqual(window.width, 402, accuracy: 1)
        XCTAssertEqual(window.height, 874, accuracy: 1)
        XCTAssertTrue(appTitle.frame.minY >= window.minY)
        XCTAssertTrue(webApp.otherElements["main"].exists)
        let bottomLink = webApp.links["◉ PWA"]
        XCTAssertTrue(bottomLink.waitForExistence(timeout: 10))
        XCTAssertLessThanOrEqual(bottomLink.frame.maxY, window.maxY - 24)
        XCTAssertGreaterThan(bottomLink.frame.maxY, window.maxY - 50)
        XCTAssertGreaterThan(bottomLink.frame.minY, window.maxY - 130)

        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "Homeframe Standalone"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    func testKeyboardAvoidanceWithoutDocumentLiftOrFocusZoom() throws {
        let webApp = try launchHomeframe()
        let header = webApp.staticTexts["Homeframe"]
        XCTAssertTrue(header.waitForExistence(timeout: 15))
        let headerFrame = header.frame

        let textField = webApp.textFields["Type text"]
        if !textField.exists {
            let keyboardLink = webApp.links.matching(NSPredicate(format: "label CONTAINS 'Keyboard'")).firstMatch
            XCTAssertTrue(keyboardLink.waitForExistence(timeout: 10))
            tapCenter(of: keyboardLink, in: webApp)
        }
        let searchField = webApp.searchFields["Search without zoom"]
        let contract = webApp.descendants(matching: .any)
            .matching(NSPredicate(format: "label BEGINSWITH 'Viewport contract:'"))
            .firstMatch
        XCTAssertTrue(textField.waitForExistence(timeout: 10))
        XCTAssertTrue(contract.waitForExistence(timeout: 10))
        let scaleBefore = try viewportScale(from: contract.label)

        // Beginning a scroll on an editable control must not be interpreted as
        // an intentional tap. This guards against eager pointer-down focus.
        let fieldCenter = textField.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let scrollDestination = fieldCenter.withOffset(CGVector(dx: 0, dy: -180))
        fieldCenter.press(
            forDuration: 0.05,
            thenDragTo: scrollDestination,
            withVelocity: .slow,
            thenHoldForDuration: 0.1
        )
        XCTAssertTrue(waitUntil(timeout: 2) { contract.label.contains("closed") })

        let routeAnchor = webApp.staticTexts[
            "The top bar must remain visible, the page itself must not slide, and the bottom composer must meet the keyboard."
        ]
        XCTAssertTrue(routeAnchor.waitForExistence(timeout: 5))
        let routeAnchorY = routeAnchor.frame.minY
        let sceneOrigin = webApp.windows.firstMatch.frame.maxY
            - (try contractNumber(named: "visual bottom", from: contract.label))
        tapCenter(of: textField, in: webApp)
        let composer = webApp.textFields["Persistent composer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        XCTAssertTrue(waitUntil(timeout: 10) {
            !contract.label.contains("closed") && contract.label.contains("document scroll 0")
        })
        XCTAssertEqual(try viewportScale(from: contract.label), scaleBefore, accuracy: 0.01)
        XCTAssertEqual(header.frame.minY, headerFrame.minY, accuracy: 1)
        XCTAssertEqual(routeAnchor.frame.minY, routeAnchorY, accuracy: 1)
        XCTAssertEqual(
            composer.frame.maxY,
            sceneOrigin + (try contractNumber(named: "visual bottom", from: contract.label)),
            accuracy: 24
        )

        XCTAssertTrue(searchField.exists)
        tapCenter(of: searchField, in: webApp)
        XCTAssertTrue(waitUntil(timeout: 5) { !contract.label.contains("closed") })
        XCTAssertEqual(try viewportScale(from: contract.label), scaleBefore, accuracy: 0.01)
        XCTAssertEqual(
            composer.frame.maxY,
            sceneOrigin + (try contractNumber(named: "visual bottom", from: contract.label)),
            accuracy: 24
        )
        XCTAssertEqual(header.frame.minY, headerFrame.minY, accuracy: 1)

        pressScreenPoint(
            x: webApp.windows.firstMatch.frame.maxX - 42,
            y: sceneOrigin + (try contractNumber(named: "visual bottom", from: contract.label)) + 38,
            in: webApp
        )
        XCTAssertTrue(waitUntil(timeout: 10) { contract.label.contains("closed") })
        XCTAssertTrue(contract.label.contains("document scroll 0"))
        XCTAssertGreaterThan(composer.frame.maxY, webApp.windows.firstMatch.frame.maxY - 70)
        XCTAssertEqual(header.frame.minY, headerFrame.minY, accuracy: 1)

        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "Homeframe Keyboard Restored"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    func testBackgroundResumeCannotLeaveKeyboardSizedBlankSpace() throws {
        let webApp = try launchHomeframe()
        let header = webApp.staticTexts["Homeframe"]
        XCTAssertTrue(header.waitForExistence(timeout: 15))
        let headerFrame = header.frame

        let textField = webApp.textFields["Type text"]
        if !textField.exists {
            let keyboardLink = webApp.links.matching(NSPredicate(format: "label CONTAINS 'Keyboard'")).firstMatch
            XCTAssertTrue(keyboardLink.waitForExistence(timeout: 10))
            tapCenter(of: keyboardLink, in: webApp)
        }
        let composer = webApp.textFields["Persistent composer"]
        let contract = webApp.descendants(matching: .any)
            .matching(NSPredicate(format: "label BEGINSWITH 'Viewport contract:'"))
            .firstMatch
        XCTAssertTrue(textField.waitForExistence(timeout: 10))
        XCTAssertTrue(contract.waitForExistence(timeout: 10))
        tapCenter(of: textField, in: webApp)
        XCTAssertTrue(waitUntil(timeout: 10) { !contract.label.contains("closed") })
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        let openComposerBottom = composer.frame.maxY

        XCUIDevice.shared.press(.home)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        XCTAssertTrue(tapHomeframeIcon(in: springboard))
        XCTAssertTrue(webApp.wait(for: .runningForeground, timeout: 15))
        XCTAssertTrue(header.waitForExistence(timeout: 15))
        XCTAssertTrue(contract.waitForExistence(timeout: 15))
        XCTAssertTrue(waitUntil(timeout: 10) { contract.label.contains("closed") })

        XCTAssertEqual(header.frame.minY, headerFrame.minY, accuracy: 1)
        XCTAssertGreaterThan(composer.frame.maxY, openComposerBottom + 120)
        XCTAssertGreaterThan(composer.frame.maxY, webApp.windows.firstMatch.frame.maxY - 70)

        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "Homeframe Background Resume Restored"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    func testInteractiveHistorySwipeNeverExposesALightScene() throws {
        let webApp = try launchHomeframe()
        let settings = webApp.links["Settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 15))
        tapCenter(of: settings, in: webApp)

        let historyLink = webApp.links
            .matching(NSPredicate(format: "label CONTAINS 'History'"))
            .firstMatch
        XCTAssertTrue(historyLink.waitForExistence(timeout: 10))
        tapCenter(of: historyLink, in: webApp)

        let historyTitle = webApp.staticTexts["Scroll, navigate, then edge-swipe back"]
        XCTAssertTrue(historyTitle.waitForExistence(timeout: 10))
        let firstDestination = webApp.links
            .matching(NSPredicate(format: "label CONTAINS 'Restoration item 1'"))
            .firstMatch
        XCTAssertTrue(firstDestination.waitForExistence(timeout: 10))
        tapCenter(of: firstDestination, in: webApp)
        XCTAssertTrue(webApp.staticTexts["History destination 1"].waitForExistence(timeout: 10))

        let window = webApp.windows.firstMatch
        let start = window.coordinate(withNormalizedOffset: CGVector(dx: 0.002, dy: 0.5))
        let end = window.coordinate(withNormalizedOffset: CGVector(dx: 0.55, dy: 0.5))
        start.press(
            forDuration: 0.01,
            thenDragTo: end,
            withVelocity: .slow,
            thenHoldForDuration: 0.2
        )

        XCTAssertTrue(historyTitle.waitForExistence(timeout: 10))
        let forwardStart = window.coordinate(withNormalizedOffset: CGVector(dx: 0.998, dy: 0.5))
        let forwardEnd = window.coordinate(withNormalizedOffset: CGVector(dx: 0.45, dy: 0.5))
        forwardStart.press(
            forDuration: 0.01,
            thenDragTo: forwardEnd,
            withVelocity: .slow,
            thenHoldForDuration: 0.2
        )
        XCTAssertTrue(webApp.staticTexts["History destination 1"].waitForExistence(timeout: 10))

        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "Homeframe History Back and Forward"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    func testAppHeaderTapScrollsTheInternalRouteViewToTop() throws {
        let webApp = try launchHomeframe()
        let historyLink = webApp.links
            .matching(NSPredicate(format: "label CONTAINS 'History'"))
            .firstMatch
        XCTAssertTrue(historyLink.waitForExistence(timeout: 10))
        tapCenter(of: historyLink, in: webApp)

        let historyTitle = webApp.staticTexts["Scroll, navigate, then edge-swipe back"]
        XCTAssertTrue(historyTitle.waitForExistence(timeout: 10))
        let initialTitleFrame = historyTitle.frame
        for _ in 0..<4 { webApp.swipeUp() }
        XCTAssertLessThan(historyTitle.frame.maxY, webApp.windows.firstMatch.frame.minY)

        let window = webApp.windows.firstMatch.frame
        pressScreenPoint(x: window.minX + 96, y: window.minY + 74, in: webApp)
        XCTAssertTrue(waitUntil(timeout: 5) {
            abs(historyTitle.frame.minY - initialTitleFrame.minY) < 2
        })
    }

    @MainActor
    func testStandaloneDarkAppearancePaintsTheSystemTopSurface() throws {
        let webApp = try launchHomeframe()
        let settings = webApp.links["Settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 15))
        tapCenter(of: settings, in: webApp)

        let appearance = webApp.otherElements["Appearance"]
        XCTAssertTrue(appearance.waitForExistence(timeout: 10))
        if (appearance.value as? String) != "Dark" {
            appearance.tap()
            let dark = webApp.buttons["Dark"]
            XCTAssertTrue(dark.waitForExistence(timeout: 10))
            dark.tap()
        }
        XCTAssertTrue(waitUntil(timeout: 10) {
            (webApp.otherElements["Appearance"].value as? String) == "Dark"
        })
        XCTAssertTrue(webApp.staticTexts
            .matching(NSPredicate(format: "label CONTAINS 'dark appearance'"))
            .firstMatch
            .exists)

        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "Homeframe Standalone Dark Appearance"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    func testSafariBrowserModeKeepsInteractiveControlsClearOfBrowserChrome() throws {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.launch()
        let address = safari.textFields["Address"]
        XCTAssertTrue(address.waitForExistence(timeout: 10))
        address.tap()
        address.typeText(ProcessInfo.processInfo.environment["HOMEFRAME_TEST_URL"]
            ?? "http://127.0.0.1:4180/")
        let go = safari.keyboards.buttons["go"]
        XCTAssertTrue(go.waitForExistence(timeout: 5))
        go.tap()

        let header = safari.staticTexts["Homeframe"]
        let main = safari.otherElements["main"]
        let bottomLink = safari.links
            .matching(NSPredicate(format: "label CONTAINS 'PWA'"))
            .firstMatch
        XCTAssertTrue(header.waitForExistence(timeout: 15))
        XCTAssertTrue(main.waitForExistence(timeout: 15))
        XCTAssertTrue(bottomLink.waitForExistence(timeout: 15))
        XCTAssertTrue(safari.staticTexts["Install Homeframe as an app"].waitForExistence(timeout: 15))
        XCTAssertTrue(safari.staticTexts[
            "Use Share, then Add to Home Screen for the full iPhone PWA experience."
        ].exists)

        let window = safari.windows.firstMatch.frame
        XCTAssertGreaterThan(header.frame.minY, window.minY)
        XCTAssertLessThan(bottomLink.frame.maxY, window.maxY - 8)

        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "Homeframe iPhone Safari"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    private func launchHomeframe() throws -> XCUIApplication {
        XCUIApplication(bundleIdentifier: "com.apple.webapp").terminate()
        XCUIDevice.shared.press(.home)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        // A second Home press returns SpringBoard to its first icon page even if
        // a prior run stopped on the App Library or another Home Screen page.
        XCUIDevice.shared.press(.home)
        if !springboard.icons["Homeframe"].waitForExistence(timeout: 10) {
            XCTFail("The Homeframe Web app must be installed on the simulator Home Screen.")
        }
        XCTAssertTrue(tapHomeframeIcon(in: springboard), "The Homeframe Web app icon must be reachable on a Home Screen page.")

        let webApp = XCUIApplication(bundleIdentifier: "com.apple.webapp")
        XCTAssertTrue(webApp.wait(for: .runningForeground, timeout: 15))
        return webApp
    }

    @MainActor
    private func tapHomeframeIcon(in springboard: XCUIApplication) -> Bool {
        for page in 0..<5 {
            let icons = springboard.icons.matching(NSPredicate(format: "label == 'Homeframe'"))
            for index in 0..<icons.count {
                let icon = icons.element(boundBy: index)
                if icon.isHittable {
                    icon.tap()
                    return true
                }
            }
            if page < 4 {
                springboard.swipeLeft()
            }
        }
        return false
    }

    private func waitUntil(timeout: TimeInterval, condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        return condition()
    }

    @MainActor
    private func tapCenter(of element: XCUIElement, in app: XCUIApplication) {
        let frame = element.frame
        let window = app.windows.firstMatch.frame
        let point = CGVector(
            dx: (frame.midX - window.minX) / window.width,
            dy: (frame.midY - window.minY) / window.height
        )
        app.windows.firstMatch.coordinate(withNormalizedOffset: point).press(forDuration: 0.05)
    }

    @MainActor
    private func pressScreenPoint(x: CGFloat, y: CGFloat, in app: XCUIApplication) {
        let window = app.windows.firstMatch.frame
        let point = CGVector(
            dx: (x - window.minX) / window.width,
            dy: (y - window.minY) / window.height
        )
        app.windows.firstMatch.coordinate(withNormalizedOffset: point).press(forDuration: 0.05)
    }

    private func viewportScale(from label: String) throws -> Double {
        try contractNumber(named: "scale", from: label)
    }

    private func contractNumber(named name: String, from label: String) throws -> Double {
        let pattern = NSRegularExpression.escapedPattern(for: name) + #" ([0-9.]+)"#
        let expression = try NSRegularExpression(pattern: pattern)
        let range = NSRange(label.startIndex..<label.endIndex, in: label)
        guard let match = expression.firstMatch(in: label, range: range),
              let valueRange = Range(match.range(at: 1), in: label),
              let value = Double(label[valueRange]) else {
            XCTFail("Could not read \(name) from viewport contract: \(label)")
            return .nan
        }
        return value
    }
}
