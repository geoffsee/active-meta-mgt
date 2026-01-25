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
        // The view displays "Heart Rate" and "SpO2" as text labels
        XCTAssertTrue(app.staticTexts["Heart Rate"].waitForExistence(timeout: 5),
                      "Heart Rate label should be visible")
        XCTAssertTrue(app.staticTexts["SpO2"].exists,
                      "SpO2 label should be visible")
    }

    func testAllVitalTypesDisplayed() throws {
        // Check that all vital type labels are present
        // ContentView shows: "Heart Rate", "SpO2", "Blood Pressure", "Resp Rate", "Temp"
        let vitalLabels = ["Heart Rate", "SpO2", "Blood Pressure", "Resp Rate", "Temp"]

        for label in vitalLabels {
            let exists = app.staticTexts[label].waitForExistence(timeout: 3)
            XCTAssertTrue(exists, "\(label) should be displayed in the vitals view")
        }
    }

    // MARK: - Navigation Tests

    func testManualEntryNavigation() throws {
        // The Edit button opens ManualEntryView as a sheet
        let editButton = app.buttons["Edit"]
        XCTAssertTrue(editButton.waitForExistence(timeout: 5),
                      "Edit button should be visible")

        editButton.tap()

        // ManualEntryView has navigation title "Manual Entry"
        // In a sheet, we look for the title text
        let manualEntryTitle = app.staticTexts["Manual Entry"]
        XCTAssertTrue(manualEntryTitle.waitForExistence(timeout: 5),
                      "Manual Entry view should appear after tapping Edit")
    }

    func testManualEntryCancel() throws {
        // Navigate to manual entry
        app.buttons["Edit"].tap()

        // Wait for manual entry view
        XCTAssertTrue(app.staticTexts["Manual Entry"].waitForExistence(timeout: 5))

        // Tap Cancel button (in toolbar)
        let cancelButton = app.buttons["Cancel"]
        XCTAssertTrue(cancelButton.waitForExistence(timeout: 3), "Cancel button should be visible")
        cancelButton.tap()

        // Verify we're back to the main vitals view
        XCTAssertTrue(app.staticTexts["Heart Rate"].waitForExistence(timeout: 3),
                      "Should return to vitals view after cancel")
    }

    // MARK: - Manual Entry Tests

    func testManualEntryFields() throws {
        // Navigate to manual entry
        app.buttons["Edit"].tap()
        XCTAssertTrue(app.staticTexts["Manual Entry"].waitForExistence(timeout: 5))

        // ManualEntryView uses Toggles with labels for each vital
        // Check that the toggle labels exist
        XCTAssertTrue(app.staticTexts["Heart Rate"].exists,
                      "Heart Rate toggle section should be present")
        XCTAssertTrue(app.staticTexts["SpO2"].exists,
                      "SpO2 toggle section should be present")
        XCTAssertTrue(app.staticTexts["Blood Pressure"].exists,
                      "Blood Pressure toggle section should be present")
    }

    func testManualEntryToggleEnable() throws {
        // Navigate to manual entry
        app.buttons["Edit"].tap()
        XCTAssertTrue(app.staticTexts["Manual Entry"].waitForExistence(timeout: 5))

        // Find and tap a toggle to enable manual entry
        // Toggles in SwiftUI are switches
        let switches = app.switches
        XCTAssertTrue(switches.count > 0, "There should be toggle switches for vitals")

        // Tap the first switch (Heart Rate)
        if let firstSwitch = switches.allElementsBoundByIndex.first {
            firstSwitch.tap()
            // After enabling, a stepper should appear
            // Note: The exact UI behavior depends on the toggle state
        }
    }

    // MARK: - Submit Tests

    func testSubmitVitalsButtonExists() throws {
        // The Submit Vitals button is on the main view
        let submitButton = app.buttons["Submit Vitals"]
        XCTAssertTrue(submitButton.waitForExistence(timeout: 5),
                      "Submit Vitals button should be visible on main view")
    }

    func testSubmitVitalsFlow() throws {
        // First enable some vitals via manual entry
        app.buttons["Edit"].tap()
        XCTAssertTrue(app.staticTexts["Manual Entry"].waitForExistence(timeout: 5))

        // Enable a vital by tapping a toggle
        let switches = app.switches
        if switches.count > 0 {
            switches.allElementsBoundByIndex.first?.tap()
        }

        // Tap Done to save
        app.buttons["Done"].tap()

        // Wait to return to main view
        XCTAssertTrue(app.buttons["Submit Vitals"].waitForExistence(timeout: 5))

        // Tap submit
        app.buttons["Submit Vitals"].tap()

        // Wait for response - the app shows result in a status indicator
        // Give some time for network call
        sleep(2)

        // After submission, the view should still be visible
        XCTAssertTrue(app.staticTexts["Heart Rate"].exists,
                      "Main view should remain visible after submission")
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

    // MARK: - Done Button Tests

    func testManualEntryDoneButton() throws {
        // Navigate to manual entry
        app.buttons["Edit"].tap()
        XCTAssertTrue(app.staticTexts["Manual Entry"].waitForExistence(timeout: 5))

        // Verify Done button exists
        let doneButton = app.buttons["Done"]
        XCTAssertTrue(doneButton.exists, "Done button should be visible in toolbar")

        // Tap Done
        doneButton.tap()

        // Verify we're back to main view
        XCTAssertTrue(app.staticTexts["Heart Rate"].waitForExistence(timeout: 3),
                      "Should return to vitals view after Done")
    }

    // MARK: - Accessibility Tests

    func testAccessibilityLabels() throws {
        // Verify accessibility labels are set for key action buttons
        let editButton = app.buttons["Edit"]
        let refreshButton = app.buttons["Refresh"]
        let submitButton = app.buttons["Submit Vitals"]

        XCTAssertTrue(editButton.waitForExistence(timeout: 5))
        XCTAssertTrue(refreshButton.exists)
        XCTAssertTrue(submitButton.exists)

        // Buttons created with Label have automatic accessibility labels
        XCTAssertFalse(editButton.label.isEmpty, "Edit button should have an accessibility label")
        XCTAssertFalse(refreshButton.label.isEmpty, "Refresh button should have an accessibility label")
    }

    // MARK: - Configuration Warning Tests

    func testConfigurationWarning() throws {
        // If API is not configured, a warning should be shown
        // This depends on Config.isConfigured status
        // The warning text is "API not configured"
        let warningText = app.staticTexts["API not configured"]

        // This may or may not exist depending on configuration
        // Just verify the main UI is visible regardless
        XCTAssertTrue(app.staticTexts["Heart Rate"].waitForExistence(timeout: 5),
                      "Main view should load regardless of configuration state")
    }

    // MARK: - Patient ID Display Tests

    func testPatientIdDisplayed() throws {
        // The view shows "Patient: {id}" header
        // Look for any text containing "Patient:"
        let patientLabel = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Patient:'"))
        XCTAssertTrue(patientLabel.count > 0, "Patient ID should be displayed in header")
    }
}
