# Privacy Policy for VitalsWatch

**Last Updated: January 2025**

## Overview

VitalsWatch is designed with privacy as a core principle. This app helps healthcare professionals capture and submit patient vital signs from Apple Watch to clinical systems.

## Data Collection

### What We Collect

VitalsWatch accesses the following health data through Apple HealthKit:
- Heart Rate
- Blood Oxygen Saturation (SpO2)
- Blood Pressure
- Respiratory Rate
- Body Temperature

### How Data is Used

- **Local Processing**: All health data is processed locally on your device
- **User-Initiated Transmission**: Data is only sent to external servers when you explicitly tap "Submit Vitals"
- **Destination Control**: Data is sent only to the clinical API server URL you configure in the app settings

### What We Don't Collect

- No analytics or tracking
- No advertising identifiers
- No third-party data sharing
- No data collection without explicit user action

## Data Storage

### On-Device Storage

- **Health Data**: Accessed from HealthKit on-demand; not persistently stored by VitalsWatch
- **Credentials**: Stored securely in Apple Keychain
- **Server URL**: Stored in local app preferences

### External Transmission

When you submit vitals, the following is sent to your configured server:
- Patient identifier (derived from your credentials)
- Vital sign values and timestamps
- Device identifier for audit purposes

## Your Rights

- **Access**: View all stored configuration in the app's Settings
- **Deletion**: Clear all credentials and configuration via Settings > Clear Configuration
- **Control**: You decide when and where data is submitted

## HealthKit Integration

VitalsWatch requires HealthKit access to read vital signs from your Apple Watch. This access:
- Is requested only when you first use the app
- Can be revoked at any time in iOS Settings > Privacy > Health
- Does not allow VitalsWatch to write to HealthKit

## Data Security

- All credentials are encrypted using Apple Keychain
- Network transmission uses HTTPS (configurable server)
- No data is cached or logged beyond the current session

## Children's Privacy

VitalsWatch is designed for use by healthcare professionals and is not intended for use by children under 13.

## Changes to This Policy

We may update this privacy policy from time to time. Significant changes will be communicated through app updates.

## Contact

For privacy-related questions, please open an issue at:
https://github.com/geoffsee/VitalsWatch/issues

---

*VitalsWatch respects your privacy and gives you full control over your health data.*
