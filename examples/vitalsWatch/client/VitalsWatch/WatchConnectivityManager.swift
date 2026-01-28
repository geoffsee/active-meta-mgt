import Foundation
import WatchConnectivity

/// Manages Watch Connectivity for the iOS app
/// Syncs credentials to the Watch via applicationContext (works over LTE)
class WatchConnectivityManager: NSObject, ObservableObject {
    static let shared = WatchConnectivityManager()

    @Published var isReachable = false
    @Published var isPaired = false
    @Published var isWatchAppInstalled = false

    private override init() {
        super.init()
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    /// Sync credentials to the Watch
    /// Uses applicationContext which syncs over Bluetooth, WiFi, or LTE
    func syncCredentials(username: String, password: String, serverURL: String) {
        guard WCSession.isSupported() else {
            print("WatchConnectivity not supported")
            return
        }

        let context: [String: Any] = [
            "username": username,
            "password": password,
            "serverURL": serverURL,
            "timestamp": Date().timeIntervalSince1970
        ]

        do {
            try WCSession.default.updateApplicationContext(context)
            print("Credentials synced to Watch via applicationContext")
        } catch {
            print("Failed to sync credentials: \(error)")
        }
    }

    /// Clear credentials on the Watch
    func clearCredentials() {
        guard WCSession.isSupported() else { return }

        let context: [String: Any] = [
            "clearCredentials": true,
            "timestamp": Date().timeIntervalSince1970
        ]

        do {
            try WCSession.default.updateApplicationContext(context)
            print("Clear credentials command sent to Watch")
        } catch {
            print("Failed to clear credentials: \(error)")
        }
    }
}

// MARK: - WCSessionDelegate
extension WatchConnectivityManager: WCSessionDelegate {
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        DispatchQueue.main.async {
            self.isPaired = session.isPaired
            self.isWatchAppInstalled = session.isWatchAppInstalled
            self.isReachable = session.isReachable
        }

        if let error = error {
            print("WCSession activation failed: \(error)")
        } else {
            print("WCSession activated with state: \(activationState.rawValue)")
        }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {
        print("WCSession became inactive")
    }

    func sessionDidDeactivate(_ session: WCSession) {
        print("WCSession deactivated")
        // Reactivate for switching between watches
        WCSession.default.activate()
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async {
            self.isReachable = session.isReachable
        }
    }

    func sessionWatchStateDidChange(_ session: WCSession) {
        DispatchQueue.main.async {
            self.isPaired = session.isPaired
            self.isWatchAppInstalled = session.isWatchAppInstalled
        }
    }
}
