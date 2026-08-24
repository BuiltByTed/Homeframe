import SwiftUI

@main
struct HomeframeTestHostApp: App {
    @Environment(\.openURL) private var openURL

    var body: some Scene {
        WindowGroup {
            VStack(spacing: 16) {
                Text("Homeframe simulator test host")
                    .accessibilityIdentifier("homeframe-test-host")
                Button("Open Homeframe in Safari") {
                    let configured = ProcessInfo.processInfo.environment["HOMEFRAME_TEST_URL"]
                        ?? "http://127.0.0.1:4180/"
                    if let url = URL(string: configured) {
                        openURL(url)
                    }
                }
                .accessibilityIdentifier("open-homeframe-in-safari")
            }
        }
    }
}
