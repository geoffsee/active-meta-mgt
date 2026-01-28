import SwiftUI

/// Connection status for the server
enum ConnectionStatus: Equatable {
    case disconnected
    case connecting
    case connected
    case failed(String)

    var description: String {
        switch self {
        case .disconnected: return "Not Connected"
        case .connecting: return "Connecting..."
        case .connected: return "Connected"
        case .failed(let error): return "Failed: \(error)"
        }
    }

    var color: Color {
        switch self {
        case .disconnected: return .orange
        case .connecting: return .blue
        case .connected: return .green
        case .failed: return .red
        }
    }
}

/// iOS companion app API client for server connectivity and case import
@MainActor
class CompanionAPIClient: ObservableObject {
    @Published var connectionStatus: ConnectionStatus = .disconnected
    @Published var isImporting = false
    @Published var importError: String?
    @Published var importSuccess = false

    /// Check server connectivity
    func checkConnection() async {
        connectionStatus = .connecting

        guard let url = URL(string: Config.apiBaseURL) else {
            connectionStatus = .failed("Invalid URL")
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "HEAD"
        request.timeoutInterval = 10

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            if let httpResponse = response as? HTTPURLResponse,
               (200...499).contains(httpResponse.statusCode) {
                connectionStatus = .connected
            } else {
                connectionStatus = .failed("Server error")
            }
        } catch let error as URLError {
            switch error.code {
            case .notConnectedToInternet:
                connectionStatus = .failed("No internet")
            case .timedOut:
                connectionStatus = .failed("Timed out")
            case .cannotConnectToHost:
                connectionStatus = .failed("Cannot connect")
            default:
                connectionStatus = .failed(error.localizedDescription)
            }
        } catch {
            connectionStatus = .failed(error.localizedDescription)
        }
    }

    /// Save credentials and verify with server
    func saveCredentials(username: String, password: String) async {
        isImporting = true
        importError = nil
        importSuccess = false

        // Verify credentials work by making a test request to the ingest endpoint
        var request = URLRequest(url: Config.ingestURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // Build auth header with provided credentials
        let credentials = "\(username):\(password)"
        let authData = credentials.data(using: .utf8)!
        let authHeader = "Basic \(authData.base64EncodedString())"
        request.setValue(authHeader, forHTTPHeaderField: "Authorization")

        // Send empty vitals just to verify auth
        let testPayload = ["vitals": [] as [Any]]
        request.httpBody = try? JSONSerialization.data(withJSONObject: testPayload)
        request.timeoutInterval = 15

        do {
            let (_, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                importError = "Invalid response"
                isImporting = false
                return
            }

            // 200, 201, or even 400 (no vitals) means auth worked
            // 401/403 means bad credentials
            if httpResponse.statusCode == 401 || httpResponse.statusCode == 403 {
                importError = "Invalid credentials"
            } else {
                // Credentials are valid - save them
                Config.saveCredentials(username: username, password: password)
                // Sync to Watch over Bluetooth/WiFi/LTE
                WatchConnectivityManager.shared.syncCredentials(
                    username: username,
                    password: password,
                    serverURL: Config.apiBaseURL
                )
                importSuccess = true
            }
        } catch let error as URLError {
            switch error.code {
            case .notConnectedToInternet:
                importError = "No internet connection"
            case .timedOut:
                importError = "Request timed out"
            case .cannotConnectToHost:
                importError = "Cannot connect to server"
            default:
                importError = error.localizedDescription
            }
        } catch {
            importError = error.localizedDescription
        }

        isImporting = false
    }
}

/// iOS companion app content view
/// Displays configuration information and allows case import after connecting
struct ContentView: View {
    @StateObject private var apiClient = CompanionAPIClient()
    @State private var serverURL: String = Config.apiBaseURL
    @State private var username: String = ""
    @State private var password: String = ""

    init() {
        // Disable animations in screenshot mode
        if Config.isScreenshotMode {
            UIView.setAnimationsEnabled(false)
        }

        // Initialize demo credentials in screenshot mode
        if Config.isDemoCredentials {
            Config.saveCredentials(
                username: Config.demoUsername,
                password: Config.demoPassword
            )
            Config.apiBaseURL = Config.demoServerURL
        }
    }

    private var isConnected: Bool {
        if case .connected = apiClient.connectionStatus {
            return true
        }
        return false
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Header
                    VStack(spacing: 8) {
                        Image(systemName: "applewatch.radiowaves.left.and.right")
                            .font(.system(size: 60))
                            .foregroundColor(.blue)

                        Text("VitalsWatch")
                            .font(.largeTitle)
                            .fontWeight(.bold)

                        Text("Clinical Vitals Submission")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 30)

                    // Server Connection Section
                    VStack(alignment: .leading, spacing: 12) {
                        Label("Server Connection", systemImage: "network")
                            .font(.headline)

                        GroupBox {
                            VStack(alignment: .leading, spacing: 12) {
                                HStack {
                                    TextField("Server URL", text: $serverURL)
                                        .textFieldStyle(.roundedBorder)
                                        .autocapitalization(.none)
                                        .disableAutocorrection(true)
                                        .keyboardType(.URL)

                                    Button(action: {
                                        Config.apiBaseURL = serverURL
                                        Task {
                                            await apiClient.checkConnection()
                                        }
                                    }) {
                                        if case .connecting = apiClient.connectionStatus {
                                            ProgressView()
                                                .frame(width: 80)
                                        } else {
                                            Text("Connect")
                                                .frame(width: 80)
                                        }
                                    }
                                    .buttonStyle(.borderedProminent)
                                    .disabled(apiClient.connectionStatus == .connecting)
                                }

                                HStack {
                                    Circle()
                                        .fill(apiClient.connectionStatus.color)
                                        .frame(width: 10, height: 10)
                                    Text(apiClient.connectionStatus.description)
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                            }
                        }
                    }

                    // Configuration section - only show when credentials exist
                    if Config.isConfigured {
                        VStack(alignment: .leading, spacing: 12) {
                            Label("Case Configuration", systemImage: "person.badge.key")
                                .font(.headline)

                            GroupBox {
                                VStack(alignment: .leading, spacing: 8) {
                                    configRow(label: "Username", value: Config.username)
                                    Divider()
                                    configRow(label: "Patient ID", value: Config.patientId)
                                    Divider()
                                    configRow(label: "Server", value: Config.apiBaseURL)
                                    Divider()
                                    configRow(
                                        label: "Status",
                                        value: "Configured",
                                        color: .green
                                    )
                                }
                            }
                        }
                    }

                    // Credential entry section - only shown when connected and not yet configured
                    if isConnected && !Config.isConfigured {
                        VStack(alignment: .leading, spacing: 12) {
                            Label("Enter Credentials", systemImage: "key.fill")
                                .font(.headline)

                            GroupBox {
                                VStack(alignment: .leading, spacing: 12) {
                                    Text("Enter the credentials provided by your healthcare provider")
                                        .font(.caption)
                                        .foregroundColor(.secondary)

                                    TextField("Username", text: $username)
                                        .textFieldStyle(.roundedBorder)
                                        .autocapitalization(.none)
                                        .disableAutocorrection(true)
                                        .textContentType(.username)

                                    SecureField("Password", text: $password)
                                        .textFieldStyle(.roundedBorder)
                                        .textContentType(.password)

                                    Button(action: {
                                        Task {
                                            await apiClient.saveCredentials(
                                                username: username,
                                                password: password
                                            )
                                        }
                                    }) {
                                        HStack {
                                            if apiClient.isImporting {
                                                ProgressView()
                                                    .padding(.trailing, 4)
                                            }
                                            Text(apiClient.isImporting ? "Verifying..." : "Save Credentials")
                                        }
                                        .frame(maxWidth: .infinity)
                                    }
                                    .buttonStyle(.borderedProminent)
                                    .disabled(
                                        username.isEmpty ||
                                        password.isEmpty ||
                                        apiClient.isImporting
                                    )

                                    if let error = apiClient.importError {
                                        HStack {
                                            Image(systemName: "exclamationmark.triangle.fill")
                                                .foregroundColor(.red)
                                            Text(error)
                                                .font(.caption)
                                                .foregroundColor(.red)
                                        }
                                    }

                                    if apiClient.importSuccess {
                                        HStack {
                                            Image(systemName: "checkmark.circle.fill")
                                                .foregroundColor(.green)
                                            Text("Credentials saved and synced to Watch!")
                                                .font(.caption)
                                                .foregroundColor(.green)
                                        }
                                    }
                                }
                            }
                        }
                    } else if !isConnected && !Config.isConfigured {
                        // Show instructions when not connected and not configured
                        VStack(alignment: .leading, spacing: 12) {
                            Label("Setup Instructions", systemImage: "list.bullet.clipboard")
                                .font(.headline)

                            GroupBox {
                                VStack(alignment: .leading, spacing: 12) {
                                    instructionRow(number: 1, text: "Enter your server URL above and tap Connect")
                                    instructionRow(number: 2, text: "Enter the credentials from your provider")
                                    instructionRow(number: 3, text: "Credentials sync automatically to your Watch")
                                    instructionRow(number: 4, text: "Grant HealthKit permissions when prompted")
                                    instructionRow(number: 5, text: "Tap 'Submit Vitals' to send to the server")
                                }
                            }
                        }
                    }

                    // Clear configuration button (when configured)
                    if Config.isConfigured {
                        Button(role: .destructive) {
                            Config.clearConfiguration()
                            WatchConnectivityManager.shared.clearCredentials()
                            apiClient.importSuccess = false
                        } label: {
                            Label("Clear Configuration", systemImage: "trash")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                    }

                    Spacer()
                }
                .padding()
            }
            .navigationBarHidden(true)
        }
    }

    private func configRow(label: String, value: String, color: Color = .primary) -> some View {
        HStack {
            Text(label)
                .foregroundColor(.secondary)
            Spacer()
            Text(value)
                .fontWeight(.medium)
                .foregroundColor(color)
        }
    }

    private func instructionRow(number: Int, text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(number)")
                .font(.caption)
                .fontWeight(.bold)
                .foregroundColor(.white)
                .frame(width: 20, height: 20)
                .background(Color.blue)
                .clipShape(Circle())

            Text(text)
                .font(.subheadline)
        }
    }
}

#Preview {
    ContentView()
}
