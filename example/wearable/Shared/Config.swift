import Foundation
import Security

/// Keychain helper for secure credential storage
private struct KeychainHelper {
    static let service = "com.vitalswatch.credentials"

    static func save(key: String, data: Data) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data
        ]

        SecItemDelete(query as CFDictionary)
        let status = SecItemAdd(query as CFDictionary, nil)
        return status == errSecSuccess
    }

    static func load(key: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess else { return nil }
        return result as? Data
    }

    static func delete(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
        SecItemDelete(query as CFDictionary)
    }

    static func saveString(key: String, value: String) -> Bool {
        guard let data = value.data(using: .utf8) else { return false }
        return save(key: key, data: data)
    }

    static func loadString(key: String) -> String? {
        guard let data = load(key: key) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

/// Configuration for the VitalsWatch app
/// Uses Keychain for secure credential storage, UserDefaults for non-sensitive settings
struct Config {
    // MARK: - Keys

    private static let usernameKey = "username"
    private static let passwordKey = "password"
    private static let serverURLKey = "vitalswatch.serverURL"

    // MARK: - Default Values

    private static let defaultUsername = "case-p001"
    private static let defaultPassword = "YOUR_PASSWORD_HERE"
    private static let defaultServerURL = "http://localhost:3333"

    // MARK: - Case Credentials (Stored in Keychain)

    /// Username for this case (generated when case is imported)
    /// Format: "case-{patient-id}"
    static var username: String {
        get { KeychainHelper.loadString(key: usernameKey) ?? defaultUsername }
        set { _ = KeychainHelper.saveString(key: usernameKey, value: newValue) }
    }

    /// Password for this case (generated when case is imported)
    /// Stored securely in Keychain - never in plain text
    static var password: String {
        get { KeychainHelper.loadString(key: passwordKey) ?? defaultPassword }
        set { _ = KeychainHelper.saveString(key: passwordKey, value: newValue) }
    }

    // MARK: - API Configuration (UserDefaults - non-sensitive)

    /// Base URL for the clinical API server
    /// For local development: "http://localhost:3333"
    /// For production: "https://your-server.example.com"
    static var apiBaseURL: String {
        get { UserDefaults.standard.string(forKey: serverURLKey) ?? defaultServerURL }
        set { UserDefaults.standard.set(newValue, forKey: serverURLKey) }
    }

    // MARK: - Ingest Endpoint

    /// Full URL for the ingest endpoint
    static var ingestURL: URL {
        URL(string: "\(apiBaseURL)/api/ingest")!
    }

    /// Full URL for the import endpoint
    static var importURL: URL {
        URL(string: "\(apiBaseURL)/api/import")!
    }

    // MARK: - Computed Properties

    /// Check if credentials are configured
    static var isConfigured: Bool {
        let storedPassword = KeychainHelper.loadString(key: passwordKey)
        return storedPassword != nil && storedPassword != defaultPassword && !storedPassword!.isEmpty
    }

    /// Patient ID derived from username (for display purposes)
    /// The actual patient_id is enforced server-side based on credentials
    static var patientId: String {
        if username.hasPrefix("case-") {
            return String(username.dropFirst(5)).uppercased()
        }
        return username.uppercased()
    }

    /// Generate Basic Auth header value
    static var basicAuthHeader: String {
        let credentials = "\(username):\(password)"
        let data = credentials.data(using: .utf8)!
        return "Basic \(data.base64EncodedString())"
    }

    // MARK: - Configuration Methods

    /// Save case credentials securely to Keychain
    static func saveCredentials(username: String, password: String) {
        self.username = username
        self.password = password
    }

    /// Clear all stored configuration
    static func clearConfiguration() {
        KeychainHelper.delete(key: usernameKey)
        KeychainHelper.delete(key: passwordKey)
        UserDefaults.standard.removeObject(forKey: serverURLKey)
    }
}
