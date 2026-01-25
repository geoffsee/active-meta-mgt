import Foundation

/// Configuration for the VitalsWatch app
/// Update these values for your deployment
struct Config {
    // MARK: - Case Credentials

    /// Username for this case (generated when case is imported)
    /// Format: "case-{patient-id}"
    static let username = "case-p001"

    /// Password for this case (generated when case is imported)
    /// Get this from the /api/import response
    static let password = "YOUR_PASSWORD_HERE"

    // MARK: - API Configuration

    /// Base URL for the clinical API server
    /// For local development: "http://localhost:3333"
    /// For production: "https://your-server.example.com"
    static let apiBaseURL = "http://localhost:3333"

    // MARK: - Ingest Endpoint

    /// Full URL for the ingest endpoint
    static var ingestURL: URL {
        URL(string: "\(apiBaseURL)/api/ingest")!
    }

    // MARK: - Computed Properties

    /// Check if credentials are configured
    static var isConfigured: Bool {
        password != "YOUR_PASSWORD_HERE"
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
}
