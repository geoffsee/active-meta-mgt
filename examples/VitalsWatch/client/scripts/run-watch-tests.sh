#!/bin/bash
#
# run-watch-tests.sh
#
# Automated test runner for VitalsWatch watchOS UI tests.
# Handles simulator boot, optional server startup, test execution, and cleanup.
#
# Usage:
#   ./scripts/run-watch-tests.sh          # Run with default settings
#   ./scripts/run-watch-tests.sh --no-server   # Skip server startup
#   ./scripts/run-watch-tests.sh --keep-sim    # Don't shutdown simulator after tests
#
# Prerequisites:
#   - Xcode installed with watchOS SDK
#   - VitalsWatch.xcodeproj exists (created manually in Xcode)
#   - watchOS runtime installed: xcodebuild -downloadPlatform watchOS
#
# One-time Xcode project setup:
#   1. File → New → Project → watchOS → App
#   2. Product Name: VitalsWatch, Interface: SwiftUI
#   3. Save to: examples/VitalsWatch/client/
#   4. Add source files from VitalsWatch Watch App/ and Shared/
#   5. Add UI Test target: File → New → Target → watchOS → UI Testing Bundle
#   6. Enable HealthKit capability
#

set -e

# Configuration
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="$PROJECT_DIR/VitalsWatch.xcodeproj"
SCHEME="VitalsWatch Watch App"
UI_TEST_SCHEME="${SCHEME}UITests"
RESULTS_DIR="$PROJECT_DIR/test-results"
SERVER_DIR="$PROJECT_DIR/.."

# Parse arguments
START_SERVER=true
KEEP_SIMULATOR=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --no-server)
            START_SERVER=false
            shift
            ;;
        --keep-sim)
            KEEP_SIMULATOR=true
            shift
            ;;
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --no-server    Skip starting the backend server"
            echo "  --keep-sim     Don't shutdown simulator after tests"
            echo "  --verbose, -v  Show detailed output"
            echo "  --help, -h     Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

echo "=== VitalsWatch Automated Test Runner ==="
echo "Project: $PROJECT"
echo ""

# Check prerequisites
if [ ! -d "$PROJECT" ]; then
    echo "ERROR: VitalsWatch.xcodeproj not found at $PROJECT"
    echo ""
    echo "The Xcode project must be created manually. Follow these steps:"
    echo ""
    echo "1. Open Xcode"
    echo "2. File → New → Project → watchOS → App"
    echo "3. Product Name: VitalsWatch"
    echo "4. Interface: SwiftUI"
    echo "5. Save to: $PROJECT_DIR"
    echo "6. Add existing source files:"
    echo "   - VitalsWatch Watch App/*.swift"
    echo "   - Shared/*.swift (add to both targets)"
    echo "7. File → New → Target → watchOS → UI Testing Bundle"
    echo "   - Name: VitalsWatchUITests"
    echo "8. Add VitalsWatchUITests/VitalsWatchUITests.swift to test target"
    echo "9. Enable HealthKit capability for Watch App target"
    echo ""
    exit 1
fi

# Check for Xcode command line tools
if ! command -v xcodebuild &> /dev/null; then
    echo "ERROR: xcodebuild not found. Install Xcode command line tools:"
    echo "  xcode-select --install"
    exit 1
fi

# Find available watchOS simulators
echo "Searching for watchOS simulator..."
WATCH_SIMULATORS=$(xcrun simctl list devices available watchOS 2>/dev/null || echo "")

if [ -z "$WATCH_SIMULATORS" ]; then
    echo "ERROR: No watchOS simulators found."
    echo ""
    echo "Install watchOS runtime with:"
    echo "  xcodebuild -downloadPlatform watchOS"
    echo ""
    echo "Or open Xcode → Settings → Platforms → +"
    exit 1
fi

# Get the first Apple Watch simulator UDID
WATCH_UDID=$(echo "$WATCH_SIMULATORS" | grep -E "Apple Watch" | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' | head -1)

if [ -z "$WATCH_UDID" ]; then
    echo "ERROR: Could not find Apple Watch simulator."
    echo "Available watchOS devices:"
    echo "$WATCH_SIMULATORS"
    exit 1
fi

WATCH_NAME=$(echo "$WATCH_SIMULATORS" | grep "$WATCH_UDID" | sed 's/(.*//' | xargs)
echo "Using simulator: $WATCH_NAME ($WATCH_UDID)"

# Boot the simulator
echo ""
echo "Booting watchOS simulator..."
xcrun simctl boot "$WATCH_UDID" 2>/dev/null || true
sleep 2

# Check simulator state
SIM_STATE=$(xcrun simctl list devices | grep "$WATCH_UDID" | grep -oE '\(Booted\)|\(Shutdown\)')
if [ "$SIM_STATE" != "(Booted)" ]; then
    echo "WARNING: Simulator may not have booted correctly. State: $SIM_STATE"
fi

# Start backend server if needed
SERVER_PID=""
if [ "$START_SERVER" = true ]; then
    echo ""
    echo "Checking backend server..."

    if curl -s http://localhost:3333/api/health > /dev/null 2>&1; then
        echo "Backend server already running."
    else
        echo "Starting backend server..."
        cd "$SERVER_DIR"

        # Check for bun
        if ! command -v bun &> /dev/null; then
            echo "ERROR: bun not found. Install from https://bun.sh"
            xcrun simctl shutdown "$WATCH_UDID" 2>/dev/null || true
            exit 1
        fi

        bun run src/server.ts &
        SERVER_PID=$!
        echo "Server started with PID $SERVER_PID"

        # Wait for server to be ready
        echo "Waiting for server to be ready..."
        for i in {1..30}; do
            if curl -s http://localhost:3333/api/health > /dev/null 2>&1; then
                echo "Server is ready."
                break
            fi
            if [ $i -eq 30 ]; then
                echo "ERROR: Server failed to start within 30 seconds."
                kill $SERVER_PID 2>/dev/null || true
                xcrun simctl shutdown "$WATCH_UDID" 2>/dev/null || true
                exit 1
            fi
            sleep 1
        done

        cd "$PROJECT_DIR"
    fi
fi

# Clean previous results
rm -rf "$RESULTS_DIR"
mkdir -p "$RESULTS_DIR"

# Build and run tests
echo ""
echo "Building and running UI tests..."
echo "This may take a few minutes on first run..."
echo ""

cd "$PROJECT_DIR"

# Determine output handling
if [ "$VERBOSE" = true ]; then
    OUTPUT_HANDLER="cat"
else
    # Use xcbeautify if available, otherwise xcpretty, otherwise cat
    if command -v xcbeautify &> /dev/null; then
        OUTPUT_HANDLER="xcbeautify"
    elif command -v xcpretty &> /dev/null; then
        OUTPUT_HANDLER="xcpretty"
    else
        OUTPUT_HANDLER="cat"
    fi
fi

# Run tests
set +e
xcodebuild test \
    -project "VitalsWatch.xcodeproj" \
    -scheme "$SCHEME" \
    -destination "platform=watchOS Simulator,id=$WATCH_UDID" \
    -resultBundlePath "$RESULTS_DIR/TestResults" \
    -only-testing:VitalsWatchUITests \
    2>&1 | $OUTPUT_HANDLER

TEST_EXIT_CODE=${PIPESTATUS[0]}
set -e

# Cleanup
echo ""
echo "Cleaning up..."

if [ "$KEEP_SIMULATOR" = false ]; then
    echo "Shutting down simulator..."
    xcrun simctl shutdown "$WATCH_UDID" 2>/dev/null || true
fi

if [ -n "$SERVER_PID" ]; then
    echo "Stopping backend server..."
    kill $SERVER_PID 2>/dev/null || true
fi

# Report results
echo ""
echo "=========================================="
if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo "SUCCESS: All watchOS UI tests passed!"
    echo "=========================================="
else
    echo "FAILED: Some tests did not pass."
    echo "=========================================="
    echo ""
    echo "Check test results at:"
    echo "  $RESULTS_DIR/TestResults.xcresult"
    echo ""
    echo "Open in Xcode:"
    echo "  open $RESULTS_DIR/TestResults.xcresult"
    echo ""
    echo "Or view logs with:"
    echo "  xcrun xcresulttool get --path $RESULTS_DIR/TestResults.xcresult --format json"
fi

exit $TEST_EXIT_CODE
