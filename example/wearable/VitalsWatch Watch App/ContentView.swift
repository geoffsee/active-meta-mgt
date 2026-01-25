import SwiftUI

/// Main view displaying current vitals and submission controls
struct ContentView: View {
    @StateObject private var healthKit = HealthKitManager()
    @StateObject private var apiClient = APIClient()
    @State private var showManualEntry = false
    @State private var showingResult = false

    // Manual override values
    @State private var manualHeartRate: Double?
    @State private var manualSpO2: Double?
    @State private var manualSystolicBP: Double?
    @State private var manualDiastolicBP: Double?
    @State private var manualRespiratoryRate: Double?
    @State private var manualTemperature: Double?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    // Patient ID header
                    HStack {
                        Image(systemName: "person.fill")
                        Text("Patient: \(Config.patientId)")
                            .font(.headline)
                    }
                    .foregroundColor(AppColors.textSecondary)
                    .padding(.bottom, 4)

                    // Vitals grid
                    VStack(spacing: 8) {
                        vitalRow(
                            icon: "heart.fill",
                            color: .red,
                            label: "Heart Rate",
                            value: displayValue(for: .heartRate),
                            unit: "BPM"
                        )

                        vitalRow(
                            icon: "lungs.fill",
                            color: .blue,
                            label: "SpO2",
                            value: displayValue(for: .spo2),
                            unit: "%"
                        )

                        vitalRow(
                            icon: "waveform.path.ecg",
                            color: .purple,
                            label: "Blood Pressure",
                            value: displayBP(),
                            unit: "mmHg"
                        )

                        vitalRow(
                            icon: "wind",
                            color: .cyan,
                            label: "Resp Rate",
                            value: displayValue(for: .respiratoryRate),
                            unit: "/min"
                        )

                        vitalRow(
                            icon: "thermometer",
                            color: .orange,
                            label: "Temp",
                            value: displayValue(for: .temperature),
                            unit: "°C"
                        )
                    }

                    // Last refresh time
                    if let lastRefresh = healthKit.lastRefresh {
                        Text("Updated \(lastRefresh, formatter: timeFormatter)")
                            .font(.caption2)
                            .foregroundColor(AppColors.textSecondary)
                    }

                    Divider()

                    // Action buttons
                    HStack(spacing: 12) {
                        // Refresh button
                        Button {
                            Task {
                                await healthKit.refreshVitals()
                            }
                        } label: {
                            Label("Refresh", systemImage: "arrow.clockwise")
                        }
                        .buttonStyle(.bordered)
                        .disabled(healthKit.isRefreshing)

                        // Manual entry button
                        Button {
                            showManualEntry = true
                        } label: {
                            Label("Edit", systemImage: "pencil")
                        }
                        .buttonStyle(.bordered)
                    }

                    // Submit button
                    Button {
                        Task {
                            await submitVitals()
                        }
                    } label: {
                        if apiClient.isSubmitting {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                        } else {
                            Label("Submit Vitals", systemImage: "arrow.up.circle.fill")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(apiClient.isSubmitting || !hasVitals)

                    // Status indicator
                    if let result = apiClient.lastResult {
                        HStack {
                            Image(systemName: result.success ? "checkmark.circle.fill" : "xmark.circle.fill")
                                .foregroundColor(result.success ? AppColors.statusNormal : AppColors.statusCritical)
                            Text(result.message)
                                .font(.caption)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                        }
                        .padding(.top, 4)
                    }

                    // Configuration warning
                    if !Config.isConfigured {
                        HStack {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundColor(AppColors.statusWarning)
                            Text("API not configured")
                                .font(.caption)
                        }
                        .padding(.top, 4)
                    }
                }
                .padding()
            }
            .navigationTitle("Vitals")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                Task {
                    await healthKit.requestAuthorization()
                    await healthKit.refreshVitals()
                }
            }
            .sheet(isPresented: $showManualEntry) {
                ManualEntryView(
                    heartRate: $manualHeartRate,
                    spo2: $manualSpO2,
                    systolicBP: $manualSystolicBP,
                    diastolicBP: $manualDiastolicBP,
                    respiratoryRate: $manualRespiratoryRate,
                    temperature: $manualTemperature,
                    healthKit: healthKit
                )
            }
        }
    }

    // MARK: - Helper Views

    private func vitalRow(icon: String, color: Color, label: String, value: String, unit: String) -> some View {
        HStack {
            Image(systemName: icon)
                .foregroundColor(color)
                .frame(width: 20)

            Text(label)
                .font(.caption)
                .foregroundColor(AppColors.textSecondary)

            Spacer()

            Text(value)
                .font(.system(.body, design: .rounded))
                .fontWeight(.semibold)
                .foregroundColor(AppColors.textPrimary)

            Text(unit)
                .font(.caption2)
                .foregroundColor(AppColors.textSecondary)
        }
    }

    // MARK: - Display Helpers

    private func displayValue(for type: VitalType) -> String {
        let manualValue: Double?
        let healthKitReading: VitalReading?

        switch type {
        case .heartRate:
            manualValue = manualHeartRate
            healthKitReading = healthKit.heartRate
        case .spo2:
            manualValue = manualSpO2
            healthKitReading = healthKit.spo2
        case .bloodPressureSystolic:
            manualValue = manualSystolicBP
            healthKitReading = healthKit.bloodPressureSystolic
        case .bloodPressureDiastolic:
            manualValue = manualDiastolicBP
            healthKitReading = healthKit.bloodPressureDiastolic
        case .respiratoryRate:
            manualValue = manualRespiratoryRate
            healthKitReading = healthKit.respiratoryRate
        case .temperature:
            manualValue = manualTemperature
            healthKitReading = healthKit.bodyTemperature
        }

        if let value = manualValue {
            return formatValue(value, for: type)
        } else if let reading = healthKitReading {
            return reading.displayValue
        }
        return "--"
    }

    private func displayBP() -> String {
        let systolic = manualSystolicBP ?? healthKit.bloodPressureSystolic?.value
        let diastolic = manualDiastolicBP ?? healthKit.bloodPressureDiastolic?.value

        if let sys = systolic, let dia = diastolic {
            return "\(Int(sys))/\(Int(dia))"
        } else if let sys = systolic {
            return "\(Int(sys))/--"
        } else if let dia = diastolic {
            return "--/\(Int(dia))"
        }
        return "--/--"
    }

    private func formatValue(_ value: Double, for type: VitalType) -> String {
        switch type {
        case .temperature:
            return String(format: "%.1f", value)
        default:
            return String(format: "%.0f", value)
        }
    }

    private var hasVitals: Bool {
        let payload = buildPayload()
        return payload.hasVitals
    }

    // MARK: - Submission

    private func buildPayload() -> VitalsPayload {
        return healthKit.buildPayload(
            heartRateOverride: manualHeartRate,
            spo2Override: manualSpO2,
            systolicBPOverride: manualSystolicBP,
            diastolicBPOverride: manualDiastolicBP,
            respiratoryRateOverride: manualRespiratoryRate,
            temperatureOverride: manualTemperature
        )
    }

    private func submitVitals() async {
        let payload = buildPayload()
        _ = await apiClient.submitVitals(payload)
    }

    // MARK: - Formatters

    private var timeFormatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        return formatter
    }
}

#Preview {
    ContentView()
}
