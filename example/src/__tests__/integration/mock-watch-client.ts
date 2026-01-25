/**
 * TypeScript replica of the Swift APIClient from VitalsWatch.
 * Used for API contract testing without needing the actual watchOS app.
 */

export interface VitalsPayload {
  heart_rate?: number;
  spo2?: number;
  systolic_bp?: number;
  diastolic_bp?: number;
  respiratory_rate?: number;
  temperature?: number;
}

export interface SubmitResult {
  success: boolean;
  ingested?: number;
  records?: unknown[];
  error?: string;
}

/**
 * Mock implementation of VitalsWatch Swift APIClient.
 * Replicates the exact behavior of the Swift client for testing.
 */
export class MockWatchClient {
  private baseURL: string;
  private username: string;
  private password: string;

  // State tracking (mirrors Swift @Published properties)
  isSubmitting = false;
  lastResult: SubmitResult | null = null;
  lastError: string | null = null;

  constructor(baseURL: string, username: string, password: string) {
    this.baseURL = baseURL;
    this.username = username;
    this.password = password;
  }

  /**
   * Generate Basic Auth header matching Swift's Config.basicAuthHeader
   */
  get basicAuthHeader(): string {
    const credentials = `${this.username}:${this.password}`;
    const base64 = Buffer.from(credentials, "utf-8").toString("base64");
    return `Basic ${base64}`;
  }

  /**
   * Check if client is configured (password is not placeholder).
   * Matches Swift's Config.isConfigured
   */
  get isConfigured(): boolean {
    return this.password !== "YOUR_PASSWORD_HERE" && this.password.length > 0;
  }

  /**
   * Check if payload has at least one vital sign.
   * Matches Swift's VitalsPayload.hasVitals
   */
  static hasVitals(payload: VitalsPayload): boolean {
    return (
      payload.heart_rate !== undefined ||
      payload.spo2 !== undefined ||
      payload.systolic_bp !== undefined ||
      payload.diastolic_bp !== undefined ||
      payload.respiratory_rate !== undefined ||
      payload.temperature !== undefined
    );
  }

  /**
   * Submit vitals to the server.
   * Replicates Swift APIClient.submitVitals() behavior exactly.
   */
  async submitVitals(payload: VitalsPayload): Promise<SubmitResult> {
    this.isSubmitting = true;
    this.lastError = null;

    try {
      // Validation: Check if configured
      if (!this.isConfigured) {
        const result: SubmitResult = {
          success: false,
          error: "API not configured - update Config.swift with your credentials",
        };
        this.lastResult = result;
        this.lastError = result.error!;
        return result;
      }

      // Validation: Check if payload has vitals
      if (!MockWatchClient.hasVitals(payload)) {
        const result: SubmitResult = {
          success: false,
          error: "No vitals to submit - at least one reading required",
        };
        this.lastResult = result;
        this.lastError = result.error!;
        return result;
      }

      // Make the request
      const url = `${this.baseURL}/api/ingest`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.basicAuthHeader,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (response.ok) {
        const result: SubmitResult = {
          success: true,
          ingested: data.ingested ?? 1,
          records: data.records ?? (data.record ? [data.record] : []),
        };
        this.lastResult = result;
        return result;
      } else {
        const errorMsg = data.error || data.message || `Server error: ${response.status}`;
        const result: SubmitResult = {
          success: false,
          error: errorMsg,
        };
        this.lastResult = result;
        this.lastError = errorMsg;
        return result;
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Network error";
      const result: SubmitResult = {
        success: false,
        error: errorMsg,
      };
      this.lastResult = result;
      this.lastError = errorMsg;
      return result;
    } finally {
      this.isSubmitting = false;
    }
  }

  /**
   * Submit raw payload without vitals validation.
   * For testing edge cases and server-side validation.
   */
  async submitRaw(body: unknown): Promise<Response> {
    const url = `${this.baseURL}/api/ingest`;
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.basicAuthHeader,
      },
      body: JSON.stringify(body),
    });
  }

  /**
   * Submit with custom headers for auth testing.
   */
  async submitWithAuth(
    payload: VitalsPayload,
    authHeader?: string,
    customHeaders?: Record<string, string>
  ): Promise<Response> {
    const url = `${this.baseURL}/api/ingest`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...customHeaders,
    };

    if (authHeader !== undefined) {
      if (authHeader) {
        headers["Authorization"] = authHeader;
      }
      // If authHeader is empty string, don't add Authorization header
    } else {
      headers["Authorization"] = this.basicAuthHeader;
    }

    return fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  }
}

/**
 * Helper to create an authenticated client with case credentials.
 * Mirrors the setup flow from VitalsWatch app configuration.
 */
export function createAuthenticatedClient(
  baseURL: string,
  caseData: { username: string; password: string }
): MockWatchClient {
  return new MockWatchClient(baseURL, caseData.username, caseData.password);
}

/**
 * Helper to import a test case and get credentials.
 * Returns a configured client ready for testing.
 *
 * The /api/import endpoint expects:
 *   { content: string, format?: "json" | "csv" }
 * where content is a JSON string of the patient data.
 */
export async function importTestCase(
  baseURL: string,
  testCase: {
    patient_id: string;
    age: number;
    gender: string;
    primary_diagnosis: string;
  }
): Promise<{ client: MockWatchClient; credentials: { username: string; password: string } }> {
  // The import endpoint expects content as a JSON string
  const response = await fetch(`${baseURL}/api/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: JSON.stringify(testCase),
      format: "json",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to import test case: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  // Response format: { ingested: N, cases: [{ patientId, username, password }], ... }
  const caseData = data.cases?.[0];

  if (!caseData?.username || !caseData?.password) {
    throw new Error(`Import response missing credentials: ${JSON.stringify(data)}`);
  }

  const credentials = {
    username: caseData.username,
    password: caseData.password,
  };
  const client = createAuthenticatedClient(baseURL, credentials);

  return { client, credentials };
}
