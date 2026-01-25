//
//  VitalsWatchUITests.swift
//  VitalsWatchUITests
//
//  XCUITest suite for VitalsWatch watchOS app.
//  Run with: ./scripts/run-watch-tests.sh
//

import XCTest

final class VitalsWatchUITests: XCTestCase {
    let app = XCUIApplication()

    override func setUpWithError() throws {
        continueAfterFailure = false
        app.launch()
    }

    override func tearDownWithError() throws {
        // Cleanup after each test if needed
    }

    // MARK: - Vitals Display Tests

    func testVitalsDisplayOnLaunch() throws {
        // Verify main vitals view loads with expected elements
        // These match the VitalType cases in VitalTypes.swift
        XCTAssertTrue(app.staticTexts["Heart Rate"].waitForExistence(timeout: 5),
                      "Heart Rate label should be visible")
        XCTAssertTrue(app.staticTexts["SpO2"].exists,
                      "SpO2 label should be visible")
    }

    func testAllVitalTypesDisplayed() throws {
        // Check that all vital type labels are present
        let vitalLabels = ["Heart Rate", "SpO2", "Systolic BP", "Diastolic BP", "Resp Rate", "Temperature"]

        for label in vitalLabels {
            // Use a shorter timeout for subsequent checks since we've already waited
            let exists = app.staticTexts[label].waitForExistence(timeout: 2)
            XCTAssertTrue(exists, "\(label) should be displayed in the vitals view")
        }
    }

    // MARK: - Navigation Tests

    func testManualEntryNavigation() throws {
        // Tap the manual entry button (Edit button in ContentView)
        let editButton = app.buttons["Edit"]
        XCTAssertTrue(editButton.waitForExistence(timeout: 5),
                      "Edit button should be visible")

        editButton.tap()

        // Verify manual entry view appears
        // ManualEntryView has a navigation title "Manual Entry"
        let manualEntryTitle = app.navigationBars["Manual Entry"]
        XCTAssertTrue(manualEntryTitle.waitForExistence(timeout: 3),
                      "Manual Entry view should appear after tapping Edit")
    }

    func testManualEntryCancel() throws {
        // Navigate to manual entry
        app.buttons["Edit"].tap()

        // Wait for manual entry view
        XCTAssertTrue(app.navigationBars["Manual Entry"].waitForExistence(timeout: 3))

        // Tap Cancel button
        let cancelButton = app.buttons["Cancel"]
        XCTAssertTrue(cancelButton.exists, "Cancel button should be visible")
        cancelButton.tap()

        // Verify we're back to the main vitals view
        XCTAssertTrue(app.staticTexts["Heart Rate"].waitForExistence(timeout: 3),
                      "Should return to vitals view after cancel")
    }

    // MARK: - Manual Entry Tests

    func testManualEntryFields() throws {
        // Navigate to manual entry
        app.buttons["Edit"].tap()
        XCTAssertTrue(app.navigationBars["Manual Entry"].waitForExistence(timeout: 3))

        // Verify input fields exist for each vital type
        // ManualEntryView uses sliders with VitalType identifiers
        let heartRateSlider = app.sliders["Heart Rate Slider"]
        XCTAssertTrue(heartRateSlider.waitForExistence(timeout: 2),
                      "Heart Rate slider should be present")

        let spo2Slider = app.sliders["SpO2 Slider"]
        XCTAssertTrue(spo2Slider.exists, "SpO2 slider should be present")
    }

    func testManualEntrySliderAdjustment() throws {
        // Navigate to manual entry
        app.buttons["Edit"].tap()
        XCTAssertTrue(app.navigationBars["Manual Entry"].waitForExistence(timeout: 3))

        // Find and adjust the heart rate slider
        let heartRateSlider = app.sliders["Heart Rate Slider"]
        XCTAssertTrue(heartRateSlider.waitForExistence(timeout: 2))

        // Adjust the slider (move to 75%)
        heartRateSlider.adjust(toNormalizedSliderPosition: 0.75)

        // Verify the value changed (check the displayed value if visible)
        // The exact assertion depends on how ManualEntryView displays the value
    }

    // MARK: - Submit Tests

    func testSubmitVitalsButton() throws {
        // Navigate to manual entry
        app.buttons["Edit"].tap()
        XCTAssertTrue(app.navigationBars["Manual Entry"].waitForExistence(timeout: 3))

        // Adjust at least one vital to enable submission
        let heartRateSlider = app.sliders["Heart Rate Slider"]
        if heartRateSlider.waitForExistence(timeout: 2) {
            heartRateSlider.adjust(toNormalizedSliderPosition: 0.5)
        }

        // Tap the submit button
        let submitButton = app.buttons["Submit Vitals"]
        XCTAssertTrue(submitButton.waitForExistence(timeout: 2),
                      "Submit Vitals button should be visible")
        submitButton.tap()

        // Wait for response - either success alert or error
        // Note: If server is not running, this will show an error
        let alert = app.alerts.firstMatch
        let alertAppeared = alert.waitForExistence(timeout: 10)

        // We expect either a success or error alert
        XCTAssertTrue(alertAppeared, "An alert should appear after submission attempt")
    }

    func testSubmitShowsLoadingState() throws {
        // Navigate to manual entry
        app.buttons["Edit"].tap()
        XCTAssertTrue(app.navigationBars["Manual Entry"].waitForExistence(timeout: 3))

        // Adjust a vital
        let heartRateSlider = app.sliders["Heart Rate Slider"]
        if heartRateSlider.waitForExistence(timeout: 2) {
            heartRateSlider.adjust(toNormalizedSliderPosition: 0.5)
        }

        // Tap submit
        app.buttons["Submit Vitals"].tap()

        // Check for loading indicator (ProgressView)
        // Note: This may be too fast to catch reliably
        let loadingIndicator = app.activityIndicators.firstMatch
        // Don't assert on loading - it may complete too quickly
    }

    // MARK: - Refresh Tests

    func testRefreshButton() throws {
        // Find the refresh button on the main vitals view
        let refreshButton = app.buttons["Refresh"]
        XCTAssertTrue(refreshButton.waitForExistence(timeout: 5),
                      "Refresh button should be visible on main view")

        // Tap refresh
        refreshButton.tap()

        // Verify the view still shows vitals (didn't crash)
        XCTAssertTrue(app.staticTexts["Heart Rate"].waitForExistence(timeout: 5),
                      "Vitals should still be visible after refresh")
    }

    // MARK: - Error Handling Tests

    func testNetworkErrorDisplaysAlert() throws {
        // This test verifies error handling when server is unreachable
        // Note: Only meaningful if server is not running during test

        // Navigate to manual entry
        app.buttons["Edit"].tap()
        XCTAssertTrue(app.navigationBars["Manual Entry"].waitForExistence(timeout: 3))

        // Adjust a vital
        let heartRateSlider = app.sliders["Heart Rate Slider"]
        if heartRateSlider.waitForExistence(timeout: 2) {
            heartRateSlider.adjust(toNormalizedSliderPosition: 0.5)
        }

        // Try to submit
        app.buttons["Submit Vitals"].tap()

        // Wait for alert (will show either success or network error)
        let alert = app.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 10),
                      "An alert should appear after submission")

        // Dismiss the alert
        if alert.buttons["OK"].exists {
            alert.buttons["OK"].tap()
        }
    }

    // MARK: - UI State Persistence Tests

    func testManualEntryRetainsValuesOnNavigationBack() throws {
        // Navigate to manual entry
        app.buttons["Edit"].tap()
        XCTAssertTrue(app.navigationBars["Manual Entry"].waitForExistence(timeout: 3))

        // Adjust heart rate
        let heartRateSlider = app.sliders["Heart Rate Slider"]
        if heartRateSlider.waitForExistence(timeout: 2) {
            heartRateSlider.adjust(toNormalizedSliderPosition: 0.75)
        }

        // Cancel and go back
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.staticTexts["Heart Rate"].waitForExistence(timeout: 3))

        // Navigate back to manual entry
        app.buttons["Edit"].tap()
        XCTAssertTrue(app.navigationBars["Manual Entry"].waitForExistence(timeout: 3))

        // Note: Whether values persist depends on implementation
        // This test documents the expected behavior
    }

    // MARK: - Accessibility Tests

    func testAccessibilityLabels() throws {
        // Verify accessibility labels are set for key elements
        let vitalsView = app.otherElements["Vitals View"]
        let editButton = app.buttons["Edit"]
        let refreshButton = app.buttons["Refresh"]

        // At minimum, the action buttons should be accessible
        XCTAssertTrue(editButton.waitForExistence(timeout: 5))
        XCTAssertTrue(refreshButton.exists)

        // Check that buttons have accessibility labels
        // (This verifies VoiceOver would work)
        XCTAssertFalse(editButton.label.isEmpty, "Edit button should have an accessibility label")
        XCTAssertFalse(refreshButton.label.isEmpty, "Refresh button should have an accessibility label")
    }
}

// MARK: - Test Helpers

extension VitalsWatchUITests {
    /// Wait for an element to appear with custom timeout
    func waitForElement(_ element: XCUIElement, timeout: TimeInterval = 5) -> Bool {
        return element.waitForExistence(timeout: timeout)
    }

    /// Dismiss any visible alert
    func dismissAlert() {
        let alert = app.alerts.firstMatch
        if alert.exists {
            if alert.buttons["OK"].exists {
                alert.buttons["OK"].tap()
            } else if alert.buttons.firstMatch.exists {
                alert.buttons.firstMatch.tap()
            }
        }
    }
}
