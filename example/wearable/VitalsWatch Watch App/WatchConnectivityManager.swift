import Foundation
import WatchConnectivity

/// Manages Watch Connectivity for the watchOS app
/// Receives credentials synced from iPhone via applicationContext (works over LTE)
class WatchConnectivityManager: NSObject, ObservableObject {
    static let shared = WatchConnectivityManager()

    @Published var lastSyncDate: Date?
    @Published var credentialsReceived = false
    @Published var currentPatientId: String = Config.patientId
    @Published var isConfigured: Bool = Config.isConfigured

    private override init() {
        super.init()
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    /// Check for any pending applicationContext on launch
    func checkForPendingContext() {
        guard WCSession.isSupported() else { return }

        let context = WCSession.default.receivedApplicationContext
        if !context.isEmpty {
            processReceivedContext(context)
        }
    }

    /// Process received application context
    private func processReceivedContext(_ context: [String: Any]) {
        // Handle clear credentials command
        if context["clearCredentials"] as? Bool == true {
            Config.clearConfiguration()
            DispatchQueue.main.async {
                self.credentialsReceived = false
                self.currentPatientId = Config.patientId
                self.isConfigured = false
                self.lastSyncDate = Date()
            }
            print("Credentials cleared via WatchConnectivity")
            return
        }

        // Handle credentials sync
        guard let username = context["username"] as? String,
              let password = context["password"] as? String else {
            return
        }

        // Save credentials to local Keychain
        Config.saveCredentials(username: username, password: password)

        // Save server URL if provided
        if let serverURL = context["serverURL"] as? String {
            Config.apiBaseURL = serverURL
        }

        DispatchQueue.main.async {
            self.credentialsReceived = true
            self.currentPatientId = Config.patientId
            self.isConfigured = Config.isConfigured
            if let timestamp = context["timestamp"] as? TimeInterval {
                self.lastSyncDate = Date(timeIntervalSince1970: timestamp)
            } else {
                self.lastSyncDate = Date()
            }
        }

        print("Credentials received via WatchConnectivity: \(username)")
    }
}

// MARK: - WCSessionDelegate
extension WatchConnectivityManager: WCSessionDelegate {
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        if let error = error {
            print("WCSession activation failed: \(error)")
        } else {
            print("WCSession activated with state: \(activationState.rawValue)")
            // Check for any context that arrived before activation
            checkForPendingContext()
        }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        processReceivedContext(applicationContext)
    }
}
