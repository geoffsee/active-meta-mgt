/**
 * VitalsWatch API Contract Tests
 *
 * These tests verify the server behaves correctly for the VitalsWatch app integration.
 * Run with: bun test src/__tests__/integration/vitals-watch.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  MockWatchClient,
  createAuthenticatedClient,
  importTestCase,
  type VitalsPayload,
} from "./mock-watch-client";

type ApiResponse = {
  error?: string;
  message?: string;
  ingested?: number;
  record?: Record<string, unknown>;
  records?: Array<Record<string, unknown>>;
};

const BASE_URL = process.env.TEST_API_URL || "http://localhost:3333";

// Track created test data for cleanup
let testClient: MockWatchClient;
let testCredentials: { username: string; password: string };

// Unique patient ID for this test run
const TEST_PATIENT_ID = `test-vitals-${Date.now()}`;

describe("VitalsWatch API Contract Tests", () => {
  beforeAll(async () => {
    // Import a test case to get valid credentials
    const imported = await importTestCase(BASE_URL, {
      patient_id: TEST_PATIENT_ID,
      age: 45,
      gender: "M",
      primary_diagnosis: "Test case for VitalsWatch integration",
    });
    testClient = imported.client;
    testCredentials = imported.credentials;
  });

  describe("Authentication", () => {
    test("valid Basic Auth credentials succeed", async () => {
      const payload: VitalsPayload = { heart_rate: 72 };
      const result = await testClient.submitVitals(payload);

      expect(result.success).toBe(true);
      expect(result.ingested).toBe(1);
    });

    test("missing Authorization header returns 401", async () => {
      const payload: VitalsPayload = { heart_rate: 75 };
      const response = await testClient.submitWithAuth(payload, "");

      expect(response.status).toBe(401);
      const data = (await response.json()) as ApiResponse;
      // Server returns { error: "Authentication failed", message: "specific reason" }
      expect(data.error).toBe("Authentication failed");
      expect(data.message).toContain("Authentication required");
    });

    test("invalid credentials return 401", async () => {
      const badClient = createAuthenticatedClient(BASE_URL, {
        username: testCredentials.username,
        password: "wrong-password",
      });

      const payload: VitalsPayload = { heart_rate: 80 };
      const response = await badClient.submitWithAuth(payload);

      expect(response.status).toBe(401);
      const data = (await response.json()) as ApiResponse;
      // Server returns { error: "Authentication failed", message: "Invalid password" }
      expect(data.error).toBe("Authentication failed");
      expect(data.message).toContain("Invalid password");
    });

    test("unknown username returns 401", async () => {
      const badClient = createAuthenticatedClient(BASE_URL, {
        username: "nonexistent-user",
        password: "any-password",
      });

      const payload: VitalsPayload = { heart_rate: 85 };
      const response = await badClient.submitWithAuth(payload);

      expect(response.status).toBe(401);
      const data = (await response.json()) as ApiResponse;
      // Server returns { error: "Authentication failed", message: "Unknown case username" }
      expect(data.error).toBe("Authentication failed");
      expect(data.message).toContain("Unknown case username");
    });

    test("X-Case-Username/X-Case-Password headers work", async () => {
      const payload: VitalsPayload = { heart_rate: 90 };
      const response = await testClient.submitWithAuth(payload, "", {
        "X-Case-Username": testCredentials.username,
        "X-Case-Password": testCredentials.password,
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as ApiResponse;
      expect(data.ingested).toBe(1);
    });
  });

  describe("Payload Validation", () => {
    test("empty payload without vitals fails client-side validation", async () => {
      const payload: VitalsPayload = {};
      const result = await testClient.submitVitals(payload);

      expect(result.success).toBe(false);
      expect(result.error).toContain("No vitals to submit");
    });

    test("hasVitals correctly identifies valid payloads", () => {
      expect(MockWatchClient.hasVitals({})).toBe(false);
      expect(MockWatchClient.hasVitals({ heart_rate: 72 })).toBe(true);
      expect(MockWatchClient.hasVitals({ spo2: 98 })).toBe(true);
      expect(MockWatchClient.hasVitals({ systolic_bp: 120, diastolic_bp: 80 })).toBe(true);
      expect(MockWatchClient.hasVitals({ respiratory_rate: 16 })).toBe(true);
      expect(MockWatchClient.hasVitals({ temperature: 37.0 })).toBe(true);
    });

    test("single vital sign is accepted", async () => {
      const testCases: VitalsPayload[] = [
        { heart_rate: 72 },
        { spo2: 98 },
        { systolic_bp: 120 },
        { diastolic_bp: 80 },
        { respiratory_rate: 16 },
        { temperature: 37.0 },
      ];

      for (const payload of testCases) {
        const result = await testClient.submitVitals(payload);
        expect(result.success).toBe(true);
        expect(result.ingested).toBe(1);
      }
    });

    test("complete vitals payload is accepted", async () => {
      const payload: VitalsPayload = {
        heart_rate: 72,
        spo2: 98,
        systolic_bp: 120,
        diastolic_bp: 80,
        respiratory_rate: 16,
        temperature: 37.0,
      };

      const result = await testClient.submitVitals(payload);

      expect(result.success).toBe(true);
      expect(result.ingested).toBe(1);
      expect(result.records).toBeDefined();
      expect(result.records!.length).toBe(1);
    });

    test("invalid JSON returns 400", async () => {
      const response = await fetch(`${BASE_URL}/api/ingest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: testClient.basicAuthHeader,
        },
        body: "not valid json",
      });

      expect(response.status).toBe(400);
    });
  });

  describe("Patient ID Enforcement", () => {
    test("submitted records have correct patient_id from credentials", async () => {
      const payload: VitalsPayload = { heart_rate: 70 };
      const result = await testClient.submitVitals(payload);

      expect(result.success).toBe(true);
      expect(result.records).toBeDefined();

      const record = result.records![0] as Record<string, unknown>;
      expect(record.patient_id).toBe(TEST_PATIENT_ID);
    });

    test("patient_id in payload is overridden by credentials", async () => {
      // Try to submit with a different patient_id
      const response = await testClient.submitRaw({
        patient_id: "attempted-override",
        heart_rate: 65,
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as ApiResponse;

      // The record should have the authenticated patient_id, not the one in payload
      const record = data.record || data.records?.[0];
      expect(record?.patient_id).toBe(TEST_PATIENT_ID);
    });
  });

  describe("End-to-End Flow", () => {
    test("import -> submit -> verify in log", async () => {
      // 1. Import a new test case
      const uniquePatientId = `e2e-test-${Date.now()}`;
      const imported = await importTestCase(BASE_URL, {
        patient_id: uniquePatientId,
        age: 30,
        gender: "F",
        primary_diagnosis: "E2E test case",
      });

      // 2. Submit vitals using the credentials
      const payload: VitalsPayload = {
        heart_rate: 68,
        spo2: 99,
      };
      const result = await imported.client.submitVitals(payload);

      expect(result.success).toBe(true);
      expect(result.ingested).toBe(1);

      // 3. Verify the vitals appear in the log
      const logResponse = await fetch(`${BASE_URL}/api/ingest/log?limit=50`);
      const logData = (await logResponse.json()) as { records: Array<Record<string, unknown>> };

      // Find our submitted record
      const submitted = logData.records.find(
        (r: Record<string, unknown>) =>
          r.patient_id === uniquePatientId && r.heart_rate === 68 && r.spo2 === 99
      );

      expect(submitted).toBeDefined();
      if (!submitted) {
        throw new Error("Submitted record not found in log");
      }
      expect(submitted._type).toBe("vitals");
    });
  });

  describe("Client State Management", () => {
    test("client tracks isSubmitting state", async () => {
      expect(testClient.isSubmitting).toBe(false);

      const submitPromise = testClient.submitVitals({ heart_rate: 72 });
      // Note: Due to async nature, we can't reliably check isSubmitting during
      // But we verify it's false after completion
      await submitPromise;

      expect(testClient.isSubmitting).toBe(false);
    });

    test("client stores lastResult on success", async () => {
      await testClient.submitVitals({ heart_rate: 73 });

      expect(testClient.lastResult).toBeDefined();
      expect(testClient.lastResult!.success).toBe(true);
      expect(testClient.lastError).toBeNull();
    });

    test("client stores lastError on failure", async () => {
      const badClient = createAuthenticatedClient(BASE_URL, {
        username: "bad-user",
        password: "bad-pass",
      });

      await badClient.submitVitals({ heart_rate: 74 });

      expect(badClient.lastError).toBeDefined();
      expect(badClient.lastResult!.success).toBe(false);
    });

    test("isConfigured is false for placeholder password", () => {
      const unconfiguredClient = createAuthenticatedClient(BASE_URL, {
        username: "test",
        password: "YOUR_PASSWORD_HERE",
      });

      expect(unconfiguredClient.isConfigured).toBe(false);

      const configuredClient = createAuthenticatedClient(BASE_URL, {
        username: "test",
        password: "real-password",
      });

      expect(configuredClient.isConfigured).toBe(true);
    });

    test("unconfigured client returns error without network call", async () => {
      const unconfiguredClient = createAuthenticatedClient(BASE_URL, {
        username: "test",
        password: "YOUR_PASSWORD_HERE",
      });

      const result = await unconfiguredClient.submitVitals({ heart_rate: 75 });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not configured");
    });
  });

  describe("Batch Submission", () => {
    test("array of vitals records is accepted", async () => {
      const records = [
        { heart_rate: 70, spo2: 98 },
        { heart_rate: 72, spo2: 97 },
        { heart_rate: 74, spo2: 99 },
      ];

      const response = await testClient.submitRaw(records);

      expect(response.status).toBe(200);
      const data = (await response.json()) as ApiResponse;
      expect(data.ingested).toBe(3);
      expect(data.records?.length).toBe(3);

      // All records should have the authenticated patient_id
      for (const record of data.records || []) {
        expect(record.patient_id).toBe(TEST_PATIENT_ID);
      }
    });
  });
});
