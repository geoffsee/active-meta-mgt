import Foundation
import HealthKit

/// Manages HealthKit authorization and vital sign queries
@MainActor
class HealthKitManager: ObservableObject {
    private let healthStore = HKHealthStore()

    @Published var isAuthorized = false
    @Published var authorizationStatus: String = "Not Requested"

    @Published var heartRate: VitalReading?
    @Published var spo2: VitalReading?
    @Published var bloodPressureSystolic: VitalReading?
    @Published var bloodPressureDiastolic: VitalReading?
    @Published var respiratoryRate: VitalReading?
    @Published var bodyTemperature: VitalReading?

    @Published var lastRefresh: Date?
    @Published var isRefreshing = false

    // MARK: - HealthKit Type Identifiers

    private var heartRateType: HKQuantityType? {
        HKQuantityType.quantityType(forIdentifier: .heartRate)
    }

    private var oxygenSaturationType: HKQuantityType? {
        HKQuantityType.quantityType(forIdentifier: .oxygenSaturation)
    }

    private var bloodPressureSystolicType: HKQuantityType? {
        HKQuantityType.quantityType(forIdentifier: .bloodPressureSystolic)
    }

    private var bloodPressureDiastolicType: HKQuantityType? {
        HKQuantityType.quantityType(forIdentifier: .bloodPressureDiastolic)
    }

    private var respiratoryRateType: HKQuantityType? {
        HKQuantityType.quantityType(forIdentifier: .respiratoryRate)
    }

    private var bodyTemperatureType: HKQuantityType? {
        HKQuantityType.quantityType(forIdentifier: .bodyTemperature)
    }

    // MARK: - Authorization

    /// Check if HealthKit is available on this device
    var isHealthKitAvailable: Bool {
        HKHealthStore.isHealthDataAvailable()
    }

    /// Request authorization for all vital types
    func requestAuthorization() async {
        guard isHealthKitAvailable else {
            authorizationStatus = "HealthKit not available"
            return
        }

        var typesToRead: Set<HKObjectType> = []

        if let type = heartRateType { typesToRead.insert(type) }
        if let type = oxygenSaturationType { typesToRead.insert(type) }
        if let type = bloodPressureSystolicType { typesToRead.insert(type) }
        if let type = bloodPressureDiastolicType { typesToRead.insert(type) }
        if let type = respiratoryRateType { typesToRead.insert(type) }
        if let type = bodyTemperatureType { typesToRead.insert(type) }

        guard !typesToRead.isEmpty else {
            authorizationStatus = "No vital types available"
            return
        }

        do {
            try await healthStore.requestAuthorization(toShare: [], read: typesToRead)
            isAuthorized = true
            authorizationStatus = "Authorized"
        } catch {
            authorizationStatus = "Authorization failed: \(error.localizedDescription)"
            isAuthorized = false
        }
    }

    // MARK: - Query Methods

    /// Refresh all vitals from HealthKit
    func refreshVitals() async {
        guard isHealthKitAvailable else { return }

        isRefreshing = true

        async let hr = queryLatestHeartRate()
        async let ox = queryLatestOxygenSaturation()
        async let sysBP = queryLatestBloodPressureSystolic()
        async let diaBP = queryLatestBloodPressureDiastolic()
        async let rr = queryLatestRespiratoryRate()
        async let temp = queryLatestBodyTemperature()

        heartRate = await hr
        spo2 = await ox
        bloodPressureSystolic = await sysBP
        bloodPressureDiastolic = await diaBP
        respiratoryRate = await rr
        bodyTemperature = await temp

        lastRefresh = Date()
        isRefreshing = false
    }

    /// Query the latest heart rate sample
    private func queryLatestHeartRate() async -> VitalReading? {
        guard let type = heartRateType else { return nil }
        guard let sample = await queryLatestSample(for: type) else { return nil }

        let bpm = sample.quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
        return VitalReading(
            type: .heartRate,
            value: bpm,
            unit: "BPM",
            timestamp: sample.startDate,
            source: .healthKit
        )
    }

    /// Query the latest oxygen saturation (SpO2) sample
    private func queryLatestOxygenSaturation() async -> VitalReading? {
        guard let type = oxygenSaturationType else { return nil }
        guard let sample = await queryLatestSample(for: type) else { return nil }

        let percentage = sample.quantity.doubleValue(for: HKUnit.percent()) * 100
        return VitalReading(
            type: .spo2,
            value: percentage,
            unit: "%",
            timestamp: sample.startDate,
            source: .healthKit
        )
    }

    /// Query the latest systolic blood pressure
    private func queryLatestBloodPressureSystolic() async -> VitalReading? {
        guard let type = bloodPressureSystolicType else { return nil }
        guard let sample = await queryLatestSample(for: type) else { return nil }

        let mmHg = sample.quantity.doubleValue(for: HKUnit.millimeterOfMercury())
        return VitalReading(
            type: .bloodPressureSystolic,
            value: mmHg,
            unit: "mmHg",
            timestamp: sample.startDate,
            source: .healthKit
        )
    }

    /// Query the latest diastolic blood pressure
    private func queryLatestBloodPressureDiastolic() async -> VitalReading? {
        guard let type = bloodPressureDiastolicType else { return nil }
        guard let sample = await queryLatestSample(for: type) else { return nil }

        let mmHg = sample.quantity.doubleValue(for: HKUnit.millimeterOfMercury())
        return VitalReading(
            type: .bloodPressureDiastolic,
            value: mmHg,
            unit: "mmHg",
            timestamp: sample.startDate,
            source: .healthKit
        )
    }

    /// Query the latest respiratory rate
    private func queryLatestRespiratoryRate() async -> VitalReading? {
        guard let type = respiratoryRateType else { return nil }
        guard let sample = await queryLatestSample(for: type) else { return nil }

        let breathsPerMin = sample.quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
        return VitalReading(
            type: .respiratoryRate,
            value: breathsPerMin,
            unit: "breaths/min",
            timestamp: sample.startDate,
            source: .healthKit
        )
    }

    /// Query the latest body temperature
    private func queryLatestBodyTemperature() async -> VitalReading? {
        guard let type = bodyTemperatureType else { return nil }
        guard let sample = await queryLatestSample(for: type) else { return nil }

        let celsius = sample.quantity.doubleValue(for: HKUnit.degreeCelsius())
        return VitalReading(
            type: .temperature,
            value: celsius,
            unit: "°C",
            timestamp: sample.startDate,
            source: .healthKit
        )
    }

    /// Generic helper to query the latest sample for a given type
    private func queryLatestSample(for type: HKQuantityType) async -> HKQuantitySample? {
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)
        let predicate = HKQuery.predicateForSamples(
            withStart: Calendar.current.date(byAdding: .day, value: -7, to: Date()),
            end: Date(),
            options: .strictStartDate
        )

        return await withCheckedContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: type,
                predicate: predicate,
                limit: 1,
                sortDescriptors: [sortDescriptor]
            ) { _, samples, error in
                if let error = error {
                    print("HealthKit query error for \(type.identifier): \(error.localizedDescription)")
                    continuation.resume(returning: nil)
                    return
                }

                let sample = samples?.first as? HKQuantitySample
                continuation.resume(returning: sample)
            }

            healthStore.execute(query)
        }
    }

    // MARK: - Build Payload

    /// Build a VitalsPayload from current readings (with optional manual overrides)
    /// Note: patient_id is enforced server-side based on case credentials
    func buildPayload(
        heartRateOverride: Double? = nil,
        spo2Override: Double? = nil,
        systolicBPOverride: Double? = nil,
        diastolicBPOverride: Double? = nil,
        respiratoryRateOverride: Double? = nil,
        temperatureOverride: Double? = nil
    ) -> VitalsPayload {
        var payload = VitalsPayload()

        payload.heartRate = heartRateOverride ?? heartRate?.value
        payload.spo2 = spo2Override ?? spo2?.value
        payload.systolicBP = systolicBPOverride ?? bloodPressureSystolic?.value
        payload.diastolicBP = diastolicBPOverride ?? bloodPressureDiastolic?.value
        payload.respiratoryRate = respiratoryRateOverride ?? respiratoryRate?.value
        payload.temperature = temperatureOverride ?? bodyTemperature?.value

        return payload
    }
}
