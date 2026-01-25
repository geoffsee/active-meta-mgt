import SwiftUI

/// iOS companion app content view
/// Displays configuration information and setup instructions
struct ContentView: View {
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

                    // Configuration section
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
                                    value: Config.isConfigured ? "Configured" : "Not Configured",
                                    color: Config.isConfigured ? .green : .orange
                                )
                            }
                        }

                        if !Config.isConfigured {
                            HStack {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .foregroundColor(.orange)
                                Text("Update password in Config.swift")
                                    .font(.caption)
                            }
                        }
                    }

                    // Instructions section
                    VStack(alignment: .leading, spacing: 12) {
                        Label("Setup Instructions", systemImage: "list.bullet.clipboard")
                            .font(.headline)

                        GroupBox {
                            VStack(alignment: .leading, spacing: 12) {
                                instructionRow(number: 1, text: "Import the case via /api/import to get credentials")
                                instructionRow(number: 2, text: "Update Config.swift with the username and password")
                                instructionRow(number: 3, text: "Build and run the Watch app")
                                instructionRow(number: 4, text: "Grant HealthKit permissions when prompted")
                                instructionRow(number: 5, text: "Tap 'Submit Vitals' to send to the server")
                            }
                        }
                    }

                    // Import case section
                    VStack(alignment: .leading, spacing: 12) {
                        Label("Import a Case", systemImage: "square.and.arrow.down")
                            .font(.headline)

                        GroupBox {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("POST to /api/import with patient data:")
                                    .font(.subheadline)
                                    .fontWeight(.medium)

                                Text("""
curl -X POST http://localhost:3333/api/import \\
  -H "Content-Type: application/json" \\
  -d '{"content": "{\\"patient_id\\": \\"P001\\", \\"age\\": 65, \\"gender\\": \\"M\\", \\"diagnosis\\": \\"CHF\\"}"}'
""")
                                    .font(.system(.caption, design: .monospaced))
                                    .foregroundColor(.secondary)
                                    .padding(8)
                                    .background(Color(.systemGray6))
                                    .cornerRadius(6)

                                Text("Response includes username and password for the Watch app.")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }
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
