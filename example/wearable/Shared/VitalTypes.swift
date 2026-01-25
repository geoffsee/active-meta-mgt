import Foundation

/// Represents a collection of vital signs for submission
/// Note: patient_id is enforced server-side based on case credentials
struct VitalsPayload: Codable {
    var heartRate: Double?
    var spo2: Double?
    var systolicBP: Double?
    var diastolicBP: Double?
    var respiratoryRate: Double?
    var temperature: Double?

    enum CodingKeys: String, CodingKey {
        case heartRate = "heart_rate"
        case spo2
        case systolicBP = "systolic_bp"
        case diastolicBP = "diastolic_bp"
        case respiratoryRate = "respiratory_rate"
        case temperature
    }

    init() {}

    /// Check if at least one vital is present
    var hasVitals: Bool {
        heartRate != nil || spo2 != nil || systolicBP != nil ||
        diastolicBP != nil || respiratoryRate != nil || temperature != nil
    }
}

/// Represents a single vital sign reading
struct VitalReading: Identifiable {
    let id = UUID()
    let type: VitalType
    var value: Double?
    let unit: String
    let timestamp: Date?
    let source: VitalSource

    var displayValue: String {
        guard let value = value else { return "--" }
        switch type {
        case .heartRate:
            return String(format: "%.0f", value)
        case .spo2:
            return String(format: "%.0f", value)
        case .bloodPressureSystolic, .bloodPressureDiastolic:
            return String(format: "%.0f", value)
        case .respiratoryRate:
            return String(format: "%.0f", value)
        case .temperature:
            return String(format: "%.1f", value)
        }
    }
}

/// Types of vitals supported
enum VitalType: String, CaseIterable, Identifiable {
    case heartRate = "Heart Rate"
    case spo2 = "SpO2"
    case bloodPressureSystolic = "Systolic BP"
    case bloodPressureDiastolic = "Diastolic BP"
    case respiratoryRate = "Respiratory Rate"
    case temperature = "Temperature"

    var id: String { rawValue }

    var unit: String {
        switch self {
        case .heartRate: return "BPM"
        case .spo2: return "%"
        case .bloodPressureSystolic, .bloodPressureDiastolic: return "mmHg"
        case .respiratoryRate: return "breaths/min"
        case .temperature: return "°C"
        }
    }

    var icon: String {
        switch self {
        case .heartRate: return "heart.fill"
        case .spo2: return "lungs.fill"
        case .bloodPressureSystolic, .bloodPressureDiastolic: return "waveform.path.ecg"
        case .respiratoryRate: return "wind"
        case .temperature: return "thermometer"
        }
    }

    var normalRange: ClosedRange<Double> {
        switch self {
        case .heartRate: return 60...100
        case .spo2: return 95...100
        case .bloodPressureSystolic: return 90...120
        case .bloodPressureDiastolic: return 60...80
        case .respiratoryRate: return 12...20
        case .temperature: return 36.1...37.2
        }
    }

    var inputRange: ClosedRange<Double> {
        switch self {
        case .heartRate: return 30...250
        case .spo2: return 70...100
        case .bloodPressureSystolic: return 60...250
        case .bloodPressureDiastolic: return 30...150
        case .respiratoryRate: return 5...60
        case .temperature: return 34...42
        }
    }

    var step: Double {
        switch self {
        case .heartRate: return 1
        case .spo2: return 1
        case .bloodPressureSystolic, .bloodPressureDiastolic: return 1
        case .respiratoryRate: return 1
        case .temperature: return 0.1
        }
    }

    var defaultValue: Double {
        switch self {
        case .heartRate: return 72
        case .spo2: return 98
        case .bloodPressureSystolic: return 120
        case .bloodPressureDiastolic: return 80
        case .respiratoryRate: return 16
        case .temperature: return 37.0
        }
    }
}

/// Source of the vital reading
enum VitalSource: String {
    case healthKit = "HealthKit"
    case manual = "Manual"
    case unknown = "Unknown"
}

/// Result of a submission attempt
struct SubmissionResult {
    let success: Bool
    let message: String
    let timestamp: Date
}
