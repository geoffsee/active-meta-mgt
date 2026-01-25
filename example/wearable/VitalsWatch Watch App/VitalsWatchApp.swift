import SwiftUI

/// Main entry point for the VitalsWatch watchOS app
@main
struct VitalsWatchApp: App {
    /// Initialize WatchConnectivity to receive credentials from iPhone
    @StateObject private var connectivityManager = WatchConnectivityManager.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(connectivityManager)
        }
    }
}
