import Foundation

/// API client for submitting vitals to the clinical server
/// Uses case-based Basic Auth authentication
@MainActor
class APIClient: ObservableObject {
    @Published var isSubmitting = false
    @Published var lastResult: SubmissionResult?
    @Published var lastError: String?

    // MARK: - Submission

    /// Submit vitals to the server
    func submitVitals(_ payload: VitalsPayload) async -> SubmissionResult {
        isSubmitting = true
        lastError = nil

        defer {
            isSubmitting = false
        }

        // Check if credentials are configured
        guard Config.isConfigured else {
            let result = SubmissionResult(
                success: false,
                message: "Case credentials not configured. Update Config.swift with your username and password from the /api/import response.",
                timestamp: Date()
            )
            lastResult = result
            lastError = result.message
            return result
        }

        // Check if payload has vitals
        guard payload.hasVitals else {
            let result = SubmissionResult(
                success: false,
                message: "No vitals to submit. Refresh from HealthKit or enter values manually.",
                timestamp: Date()
            )
            lastResult = result
            lastError = result.message
            return result
        }

        // Encode the payload
        let encoder = JSONEncoder()

        guard let bodyData = try? encoder.encode(payload) else {
            let result = SubmissionResult(
                success: false,
                message: "Failed to encode vitals payload",
                timestamp: Date()
            )
            lastResult = result
            lastError = result.message
            return result
        }

        // Build the request with Basic Auth
        var request = URLRequest(url: Config.ingestURL)
        request.httpMethod = "POST"
        request.httpBody = bodyData
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(Config.basicAuthHeader, forHTTPHeaderField: "Authorization")

        // Add timeout
        request.timeoutInterval = 30

        // Execute the request
        do {
            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                let result = SubmissionResult(
                    success: false,
                    message: "Invalid server response",
                    timestamp: Date()
                )
                lastResult = result
                lastError = result.message
                return result
            }

            // Parse response
            if httpResponse.statusCode == 200 || httpResponse.statusCode == 201 {
                // Success - try to parse the response
                var message = "Vitals submitted successfully"
                if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let ingested = json["ingested"] as? Int {
                    message = "Submitted \(ingested) record(s) successfully"
                }

                let result = SubmissionResult(
                    success: true,
                    message: message,
                    timestamp: Date()
                )
                lastResult = result
                return result
            } else {
                // Error response
                var errorMessage = "Server error (HTTP \(httpResponse.statusCode))"

                if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    if let message = json["message"] as? String {
                        errorMessage = message
                    } else if let error = json["error"] as? String {
                        errorMessage = error
                    }
                }

                let result = SubmissionResult(
                    success: false,
                    message: errorMessage,
                    timestamp: Date()
                )
                lastResult = result
                lastError = errorMessage
                return result
            }
        } catch let error as URLError {
            let message: String
            switch error.code {
            case .notConnectedToInternet:
                message = "No internet connection"
            case .timedOut:
                message = "Request timed out"
            case .cannotConnectToHost:
                message = "Cannot connect to server at \(Config.apiBaseURL)"
            default:
                message = "Network error: \(error.localizedDescription)"
            }

            let result = SubmissionResult(
                success: false,
                message: message,
                timestamp: Date()
            )
            lastResult = result
            lastError = message
            return result
        } catch {
            let result = SubmissionResult(
                success: false,
                message: "Unexpected error: \(error.localizedDescription)",
                timestamp: Date()
            )
            lastResult = result
            lastError = result.message
            return result
        }
    }

    // MARK: - Utilities

    /// Clear the last result/error state
    func clearState() {
        lastResult = nil
        lastError = nil
    }
}
