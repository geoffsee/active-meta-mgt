# VitalsWatch - Apple Watch Clinical Vitals App

An Apple Watch app for submitting patient vitals to the clinical decision support server. Reads from HealthKit (heart rate, SpO2, blood pressure, respiratory rate, temperature) and supports manual entry.

## Features

- **HealthKit Integration**: Automatically reads vitals from Apple Watch sensors
- **Manual Entry**: Override or enter values manually when HealthKit data is unavailable
- **Case-Based Auth**: Each watch is tied to a specific case via username/password
- **Server-Enforced Patient ID**: Patient identity is controlled server-side, not client-side

## Authentication Model

The watch uses **case-based authentication**:
1. Import a patient case via `/api/import` - returns username and password
2. Configure the watch with these credentials
3. When submitting vitals, the server enforces the patient_id based on credentials

This ensures the watch can only submit data for its assigned patient.

## Project Structure

```
examples/VitalsWatch/client/
├── VitalsWatch Watch App/          # watchOS app (main)
│   ├── VitalsWatchApp.swift        # App entry point
│   ├── ContentView.swift           # Main vitals display
│   ├── ManualEntryView.swift       # Manual vital entry
│   ├── HealthKitManager.swift      # HealthKit queries
│   ├── APIClient.swift             # Basic Auth API calls
│   └── Info.plist                  # HealthKit usage description
├── VitalsWatch/                    # iOS companion app
│   ├── VitalsWatchApp.swift        # iOS app entry
│   ├── ContentView.swift           # Configuration display
│   └── Info.plist
├── Shared/                         # Shared code (both targets)
│   ├── Config.swift                # Case credentials, API settings
│   └── VitalTypes.swift            # Data models
└── README.md
```

## Setup Instructions

### 1. Import a Patient Case

First, import a case to get credentials:

```bash
curl -X POST http://localhost:3333/api/import \
  -H "Content-Type: application/json" \
  -d '{
    "content": "{\"patient_id\": \"P001\", \"age\": 65, \"gender\": \"M\", \"diagnosis\": \"CHF\"}"
  }'
```

Response:
```json
{
  "ingested": 1,
  "cases": [{
    "patientId": "P001",
    "username": "case-p001",
    "password": "aB3dEf9Gh1Jk"
  }]
}
```

Save the `username` and `password` for the watch configuration.

### 2. Create Xcode Project

1. Open Xcode and select **File > New > Project**
2. Choose **watchOS > App** template
3. Configure:
   - Product Name: `VitalsWatch`
   - Organization Identifier: `com.yourorg`
   - Interface: **SwiftUI**
   - Language: **Swift**
   - Watch-only App: **No** (we want iOS companion)
4. Save to `examples/VitalsWatch/client/`

### 3. Add Source Files

After creating the project, add the existing source files:

1. Right-click on **VitalsWatch Watch App** folder in Project Navigator
2. Select **Add Files to "VitalsWatch"**
3. Add all files from `VitalsWatch Watch App/`:
   - `ContentView.swift` (replace existing)
   - `HealthKitManager.swift`
   - `APIClient.swift`
   - `ManualEntryView.swift`
4. Right-click on **VitalsWatch** (iOS) folder
5. Add files from `VitalsWatch/`:
   - `ContentView.swift` (replace existing)
6. Create a **Shared** group and add:
   - `Shared/Config.swift`
   - `Shared/VitalTypes.swift`

**Important**: When adding Shared files, ensure they are added to **both targets** (VitalsWatch and VitalsWatch Watch App) in the file inspector.

### 4. Configure Case Credentials

Update `Shared/Config.swift` with credentials from the import response:

```swift
struct Config {
    // Case credentials from /api/import response
    static let username = "case-p001"
    static let password = "aB3dEf9Gh1Jk"  // Your actual password

    // Server URL
    static let apiBaseURL = "http://localhost:3333"
}
```

### 5. Configure HealthKit Capability

1. Select the project in Project Navigator
2. Select **VitalsWatch Watch App** target
3. Go to **Signing & Capabilities** tab
4. Click **+ Capability** and add **HealthKit**

### 6. Build and Run

1. Select **VitalsWatch Watch App** scheme
2. Choose an Apple Watch simulator (e.g., Apple Watch Series 9 - 45mm)
3. Build and run (Cmd + R)

## Testing

### Automated Testing

VitalsWatch includes two layers of automated testing:

#### Layer 1: API Contract Tests (TypeScript/Bun)

Fast, CI-friendly tests that verify the server API behaves correctly:

```bash
cd examples/VitalsWatch/server

# Start the server (in one terminal)
bun run src/server.ts

# Run API contract tests (in another terminal)
bun test src/__tests__/integration
```

The tests cover:
- Authentication flows (valid/invalid credentials, missing headers)
- Payload validation (hasVitals check, required fields)
- Patient ID enforcement from credentials
- End-to-end flow: import → submit → verify in log

#### Layer 2: watchOS Simulator UI Tests

End-to-end tests that run on the actual watchOS simulator:

```bash
cd examples/VitalsWatch/client

# Run automated watchOS UI tests
./scripts/run-watch-tests.sh
```

The script handles:
- Finding and booting a watchOS simulator
- Optionally starting the backend server
- Building and running XCUITests
- Cleanup (simulator shutdown, server stop)

Options:
- `--no-server` - Skip starting the backend server
- `--keep-sim` - Don't shutdown simulator after tests
- `--verbose` - Show detailed output

**Prerequisites for UI tests:**
1. Xcode with watchOS SDK
2. watchOS runtime: `xcodebuild -downloadPlatform watchOS`
3. VitalsWatch.xcodeproj (see Setup Instructions below)
4. UI test target added to project (see Step 7)

#### One-Time: Add UI Test Target to Xcode Project

After creating the VitalsWatch project:

1. **File → New → Target → watchOS → UI Testing Bundle**
2. Name: `VitalsWatchUITests`
3. Target to Test: `VitalsWatch Watch App`
4. Add `VitalsWatchUITests/VitalsWatchUITests.swift` to the test target

### Manual Testing in Simulator

The watchOS simulator doesn't have real HealthKit data, but you can:

1. Use **Manual Entry** to input test values
2. Submit to verify API connectivity
3. Check server logs for received data

### Manual Testing on Physical Device

1. Pair your Apple Watch with the development Mac
2. Build to the physical watch
3. Grant HealthKit permissions when prompted
4. Wait for sensors to collect data
5. Tap **Refresh** to load current vitals
6. Tap **Submit Vitals** to send to server

### Verify Server Integration

1. Start the example server:
   ```bash
   cd examples/VitalsWatch/server
   bun run src/server.ts
   ```

2. Check ingestion log after submission:
   ```bash
   curl http://localhost:3333/api/ingest/log
   ```

3. Verify patient data:
   ```bash
   curl http://localhost:3333/api/ingest/patients
   ```

## API Authentication

The app uses **Basic Auth** with case credentials:

```
Authorization: Basic <base64(username:password)>
```

The server:
1. Looks up the username to find the associated case
2. Verifies the password
3. Enforces the patient_id from the case record
4. Any patient_id in the request payload is overwritten with the case's patient_id

This prevents a misconfigured watch from accidentally submitting data for the wrong patient.

## Supported Vitals

| Vital | HealthKit Type | Unit |
|-------|---------------|------|
| Heart Rate | `HKQuantityTypeIdentifier.heartRate` | BPM |
| SpO2 | `HKQuantityTypeIdentifier.oxygenSaturation` | % |
| Systolic BP | `HKQuantityTypeIdentifier.bloodPressureSystolic` | mmHg |
| Diastolic BP | `HKQuantityTypeIdentifier.bloodPressureDiastolic` | mmHg |
| Respiratory Rate | `HKQuantityTypeIdentifier.respiratoryRate` | breaths/min |
| Temperature | `HKQuantityTypeIdentifier.bodyTemperature` | °C |

## Payload Format

The watch submits vitals in this JSON format:

```json
{
  "heart_rate": 72,
  "spo2": 98,
  "systolic_bp": 120,
  "diastolic_bp": 80,
  "respiratory_rate": 16,
  "temperature": 37.0
}
```

The server adds `patient_id` based on the authenticated case credentials.

## Troubleshooting

### "Case credentials not configured" warning
Update `Shared/Config.swift` with valid username and password from the `/api/import` response.

### "Unknown case username" error
The username doesn't exist on the server. Either:
- The case wasn't imported via `/api/import`
- The server was restarted (credentials are in-memory; re-import the case)

### "Invalid password" error
The password doesn't match. Get the correct password from the original `/api/import` response.

### HealthKit permissions denied
The app gracefully falls back to manual entry only. Users can re-enable in Settings > Privacy > Health.

### "Cannot connect to server"
- Verify the server is running
- Check `Config.apiBaseURL` matches your server
- For simulators connecting to localhost, use `http://localhost:3333`
- For physical devices, ensure the server is accessible on the network

## Security Notes

- Credentials should be stored securely in production (e.g., Keychain)
- The current implementation uses hardcoded credentials for development
- Patient ID is enforced server-side - the watch cannot submit to other patients
- HealthKit data is only read, never written
- All transmissions should use HTTPS in production

## Alternative: HMAC Authentication

The server also supports HMAC-SHA256 authentication for non-case-specific clients. See the main server documentation for details on using `X-API-Key`, `X-Signature`, and `X-Timestamp` headers.

## Dependencies

- **watchOS 10.0+**
- **iOS 17.0+** (companion app)
- **HealthKit** framework
- **Foundation** (built-in)
