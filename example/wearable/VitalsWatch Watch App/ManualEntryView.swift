import SwiftUI

/// View for manually entering or adjusting vital values
struct ManualEntryView: View {
    @Environment(\.dismiss) private var dismiss

    @Binding var heartRate: Double?
    @Binding var spo2: Double?
    @Binding var systolicBP: Double?
    @Binding var diastolicBP: Double?
    @Binding var respiratoryRate: Double?
    @Binding var temperature: Double?

    let healthKit: HealthKitManager

    @State private var tempHeartRate: Double = 72
    @State private var tempSpO2: Double = 98
    @State private var tempSystolicBP: Double = 120
    @State private var tempDiastolicBP: Double = 80
    @State private var tempRespiratoryRate: Double = 16
    @State private var tempTemperature: Double = 37.0

    // Track which values are enabled
    @State private var heartRateEnabled = false
    @State private var spo2Enabled = false
    @State private var bpEnabled = false
    @State private var respEnabled = false
    @State private var tempEnabled = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    // Heart Rate
                    vitalEntrySection(
                        title: "Heart Rate",
                        icon: "heart.fill",
                        color: .red,
                        value: $tempHeartRate,
                        enabled: $heartRateEnabled,
                        range: VitalType.heartRate.inputRange,
                        step: VitalType.heartRate.step,
                        unit: "BPM",
                        format: "%.0f"
                    )

                    // SpO2
                    vitalEntrySection(
                        title: "SpO2",
                        icon: "lungs.fill",
                        color: .blue,
                        value: $tempSpO2,
                        enabled: $spo2Enabled,
                        range: VitalType.spo2.inputRange,
                        step: VitalType.spo2.step,
                        unit: "%",
                        format: "%.0f"
                    )

                    // Blood Pressure
                    VStack(alignment: .leading, spacing: 8) {
                        Toggle(isOn: $bpEnabled) {
                            HStack {
                                Image(systemName: "waveform.path.ecg")
                                    .foregroundColor(.purple)
                                Text("Blood Pressure")
                                    .font(.headline)
                            }
                        }

                        if bpEnabled {
                            HStack {
                                VStack {
                                    Text("Systolic")
                                        .font(.caption)
                                    Stepper(
                                        value: $tempSystolicBP,
                                        in: VitalType.bloodPressureSystolic.inputRange,
                                        step: 1
                                    ) {
                                        Text("\(Int(tempSystolicBP))")
                                            .font(.title3)
                                    }
                                }

                                Text("/")
                                    .font(.title2)
                                    .foregroundColor(.secondary)

                                VStack {
                                    Text("Diastolic")
                                        .font(.caption)
                                    Stepper(
                                        value: $tempDiastolicBP,
                                        in: VitalType.bloodPressureDiastolic.inputRange,
                                        step: 1
                                    ) {
                                        Text("\(Int(tempDiastolicBP))")
                                            .font(.title3)
                                    }
                                }
                            }
                        }
                    }
                    .padding()
                    .background(Color(.systemGray6))
                    .cornerRadius(10)

                    // Respiratory Rate
                    vitalEntrySection(
                        title: "Resp Rate",
                        icon: "wind",
                        color: .cyan,
                        value: $tempRespiratoryRate,
                        enabled: $respEnabled,
                        range: VitalType.respiratoryRate.inputRange,
                        step: VitalType.respiratoryRate.step,
                        unit: "/min",
                        format: "%.0f"
                    )

                    // Temperature
                    vitalEntrySection(
                        title: "Temperature",
                        icon: "thermometer",
                        color: .orange,
                        value: $tempTemperature,
                        enabled: $tempEnabled,
                        range: VitalType.temperature.inputRange,
                        step: VitalType.temperature.step,
                        unit: "°C",
                        format: "%.1f"
                    )

                    // Clear all button
                    Button(role: .destructive) {
                        clearAll()
                    } label: {
                        Label("Clear All Manual Values", systemImage: "trash")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .padding(.top, 8)
                }
                .padding()
            }
            .navigationTitle("Manual Entry")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        saveValues()
                        dismiss()
                    }
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .onAppear {
                loadCurrentValues()
            }
        }
    }

    // MARK: - Helper View

    private func vitalEntrySection(
        title: String,
        icon: String,
        color: Color,
        value: Binding<Double>,
        enabled: Binding<Bool>,
        range: ClosedRange<Double>,
        step: Double,
        unit: String,
        format: String
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Toggle(isOn: enabled) {
                HStack {
                    Image(systemName: icon)
                        .foregroundColor(color)
                    Text(title)
                        .font(.headline)
                }
            }

            if enabled.wrappedValue {
                HStack {
                    Stepper(
                        value: value,
                        in: range,
                        step: step
                    ) {
                        Text(String(format: format, value.wrappedValue))
                            .font(.title2)
                            .fontWeight(.medium)
                    }

                    Text(unit)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(10)
    }

    // MARK: - Data Management

    private func loadCurrentValues() {
        // Load existing manual values or HealthKit values
        if let hr = heartRate ?? healthKit.heartRate?.value {
            tempHeartRate = hr
            heartRateEnabled = heartRate != nil
        }

        if let sp = spo2 ?? healthKit.spo2?.value {
            tempSpO2 = sp
            spo2Enabled = spo2 != nil
        }

        if let sys = systolicBP ?? healthKit.bloodPressureSystolic?.value,
           let dia = diastolicBP ?? healthKit.bloodPressureDiastolic?.value {
            tempSystolicBP = sys
            tempDiastolicBP = dia
            bpEnabled = systolicBP != nil || diastolicBP != nil
        }

        if let rr = respiratoryRate ?? healthKit.respiratoryRate?.value {
            tempRespiratoryRate = rr
            respEnabled = respiratoryRate != nil
        }

        if let temp = temperature ?? healthKit.bodyTemperature?.value {
            tempTemperature = temp
            tempEnabled = temperature != nil
        }
    }

    private func saveValues() {
        heartRate = heartRateEnabled ? tempHeartRate : nil
        spo2 = spo2Enabled ? tempSpO2 : nil
        systolicBP = bpEnabled ? tempSystolicBP : nil
        diastolicBP = bpEnabled ? tempDiastolicBP : nil
        respiratoryRate = respEnabled ? tempRespiratoryRate : nil
        temperature = tempEnabled ? tempTemperature : nil
    }

    private func clearAll() {
        heartRateEnabled = false
        spo2Enabled = false
        bpEnabled = false
        respEnabled = false
        tempEnabled = false

        heartRate = nil
        spo2 = nil
        systolicBP = nil
        diastolicBP = nil
        respiratoryRate = nil
        temperature = nil
    }
}
