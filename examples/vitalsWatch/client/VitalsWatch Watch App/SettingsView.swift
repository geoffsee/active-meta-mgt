import SwiftUI

/// Settings view for manual credential entry on the Watch
/// Used when switching devices or setting up independently from iPhone
struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject var connectivityManager: WatchConnectivityManager

    @State private var username: String = ""
    @State private var password: String = ""
    @State private var serverURL: String = ""
    @State private var showingClearConfirm = false
    @State private var saveSuccess = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if Config.isConfigured {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                            Text("Configured")
                        }
                        Text("Patient: \(Config.patientId)")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    } else {
                        HStack {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundColor(.orange)
                            Text("Not Configured")
                        }
                    }

                    if let syncDate = connectivityManager.lastSyncDate {
                        Text("Last sync: \(syncDate, formatter: dateFormatter)")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                } header: {
                    Text("Status")
                }

                Section {
                    TextField("Username", text: $username)
                        .textContentType(.username)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)

                    SecureField("Password", text: $password)
                        .textContentType(.password)

                    TextField("Server URL", text: $serverURL)
                        .textContentType(.URL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                } header: {
                    Text("Manual Entry")
                } footer: {
                    Text("Enter credentials from the iPhone app or /api/import response")
                }

                Section {
                    Button {
                        saveCredentials()
                    } label: {
                        HStack {
                            Spacer()
                            if saveSuccess {
                                Label("Saved", systemImage: "checkmark")
                            } else {
                                Text("Save")
                            }
                            Spacer()
                        }
                    }
                    .disabled(username.isEmpty || password.isEmpty)

                    if Config.isConfigured {
                        Button(role: .destructive) {
                            showingClearConfirm = true
                        } label: {
                            HStack {
                                Spacer()
                                Text("Clear Credentials")
                                Spacer()
                            }
                        }
                    }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                loadCurrentValues()
            }
            .confirmationDialog("Clear all credentials?", isPresented: $showingClearConfirm) {
                Button("Clear", role: .destructive) {
                    Config.clearConfiguration()
                    loadCurrentValues()
                }
                Button("Cancel", role: .cancel) {}
            }
        }
    }

    private func loadCurrentValues() {
        username = Config.username
        password = "" // Don't show password
        serverURL = Config.apiBaseURL
        saveSuccess = false
    }

    private func saveCredentials() {
        if !username.isEmpty && !password.isEmpty {
            Config.saveCredentials(username: username, password: password)
        }
        if !serverURL.isEmpty {
            Config.apiBaseURL = serverURL
        }
        saveSuccess = true

        // Reset after delay
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            saveSuccess = false
        }
    }

    private var dateFormatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter
    }
}

#Preview {
    SettingsView()
        .environmentObject(WatchConnectivityManager.shared)
}
