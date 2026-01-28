/**
 * Tests for the repository abstraction layer.
 */

import { describe, test, expect, beforeEach } from "vitest";
import { resolve } from "path";
import { mkdirSync, rmSync, existsSync } from "fs";
import {
  createRepoContext,
  type IRepoContext,
  DEFAULT_PATIENT_COOLDOWN_MS,
} from "./index";

import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DATA_DIR = resolve(__dirname, "../../../data/test-repo");

describe("Repository Abstraction - Bun Implementation", () => {
  let repo: IRepoContext;

  beforeEach(() => {
    // Clean up test directory
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });

    repo = createRepoContext({
      runtime: "bun",
      dataDir: TEST_DATA_DIR,
    });
  });

  describe("IngestRepo", () => {
    test("append and readLog work correctly", async () => {
      const record = await repo.ingest.append({
        patient_id: "P001",
        age: 45,
        gender: "M",
        primary_diagnosis: "Pneumonia",
      });

      expect(record._id).toBe("P001");
      expect(record._type).toBe("patient");
      expect(record._ts).toBeDefined();

      const log = await repo.ingest.readLog();
      expect(log).toHaveLength(1);
      expect(log[0]!._id).toBe("P001");
    });

    test("getPatientStates folds records correctly", async () => {
      // Initial record
      await repo.ingest.append({
        patient_id: "P001",
        age: 45,
        primary_diagnosis: "Pneumonia",
      });

      // Update with new vitals
      await repo.ingest.append({
        patient_id: "P001",
        vitals: { spo2: 92 },
      });

      const states = await repo.ingest.getPatientStates();
      const patient = states.get("P001");

      expect(patient).toBeDefined();
      expect(patient!.age).toBe(45);
      expect((patient!.vitals as any).spo2).toBe(92);
    });
  });

  describe("PatientRepo", () => {
    beforeEach(async () => {
      await repo.ingest.append({
        patient_id: "P001",
        age: 45,
        gender: "M",
        primary_diagnosis: "Pneumonia",
        condition_category: "infectious",
        severity_score: 7,
        critical_flag: false,
      });

      await repo.ingest.append({
        patient_id: "P002",
        age: 72,
        gender: "F",
        primary_diagnosis: "Heart Failure",
        condition_category: "cardiac",
        severity_score: 9,
        critical_flag: true,
      });

      repo.patients.invalidateCache();
    });

    test("loadAll returns all patients", async () => {
      const patients = await repo.patients.loadAll();
      expect(patients).toHaveLength(2);
    });

    test("getById returns correct patient", async () => {
      const patient = await repo.patients.getById("P001");
      expect(patient).toBeDefined();
      expect(patient!.patient_id).toBe("P001");
      expect(patient!.age).toBe(45);
    });

    test("filter by category works", async () => {
      const infectious = await repo.patients.filter({ category: "infectious" });
      expect(infectious).toHaveLength(1);
      expect(infectious[0]!.patient_id).toBe("P001");
    });

    test("filter by critical works", async () => {
      const critical = await repo.patients.filter({ critical: true });
      expect(critical).toHaveLength(1);
      expect(critical[0]!.patient_id).toBe("P002");
    });

    test("filter by severity works", async () => {
      const highSeverity = await repo.patients.filter({ minSeverity: 8 });
      expect(highSeverity).toHaveLength(1);
      expect(highSeverity[0]!.patient_id).toBe("P002");
    });

    test("getStats returns correct statistics", async () => {
      const stats = await repo.patients.getStats();
      expect(stats.total).toBe(2);
      expect(stats.critical).toBe(1);
      expect(stats.byCategory["infectious"]).toBe(1);
      expect(stats.byCategory["cardiac"]).toBe(1);
    });
  });

  describe("EvaluationRepo", () => {
    test("append and readAll work correctly", async () => {
      const eval1 = await repo.evaluations.append({
        patientId: "P001",
        patient: {
          summary: "45M with Pneumonia",
          diagnosis: "Pneumonia",
          category: "infectious",
          severity: 7,
          critical: false,
        },
        scenario: { id: "scn-1", title: "Test Scenario" },
        structured: { runs: [], findings: [], conflicts: [], followUps: [] },
        timestamp: new Date().toISOString(),
      });

      expect(eval1._id).toContain("eval-P001");
      expect(eval1._ts).toBeDefined();

      const all = await repo.evaluations.readAll();
      expect(all).toHaveLength(1);
    });

    test("getByPatient filters correctly", async () => {
      await repo.evaluations.append({
        patientId: "P001",
        patient: { summary: "", diagnosis: "", category: "", severity: 0, critical: false },
        scenario: { id: "s1", title: "Test" },
        structured: { runs: [], findings: [], conflicts: [], followUps: [] },
        timestamp: new Date().toISOString(),
      });

      await repo.evaluations.append({
        patientId: "P002",
        patient: { summary: "", diagnosis: "", category: "", severity: 0, critical: false },
        scenario: { id: "s2", title: "Test 2" },
        structured: { runs: [], findings: [], conflicts: [], followUps: [] },
        timestamp: new Date().toISOString(),
      });

      const p1Evals = await repo.evaluations.getByPatient("P001");
      expect(p1Evals).toHaveLength(1);
      expect(p1Evals[0]!.patientId).toBe("P001");
    });

    test("getLatest returns most recent evaluation", async () => {
      await repo.evaluations.append({
        patientId: "P001",
        patient: { summary: "First", diagnosis: "", category: "", severity: 0, critical: false },
        scenario: { id: "s1", title: "First" },
        structured: { runs: [], findings: [], conflicts: [], followUps: [] },
        timestamp: new Date().toISOString(),
      });

      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));

      await repo.evaluations.append({
        patientId: "P001",
        patient: { summary: "Second", diagnosis: "", category: "", severity: 0, critical: false },
        scenario: { id: "s2", title: "Second" },
        structured: { runs: [], findings: [], conflicts: [], followUps: [] },
        timestamp: new Date().toISOString(),
      });

      const latest = await repo.evaluations.getLatest("P001");
      expect(latest).toBeDefined();
      expect(latest!.scenario.title).toBe("Second");
    });
  });

  describe("CooldownRepo", () => {
    const cooldownMs = 1000; // 1 second for testing

    test("check allows first action", async () => {
      const result = await repo.cooldown.check("test-key", cooldownMs);
      expect(result.allowed).toBe(true);
      expect(result.remainingMs).toBe(0);
    });

    test("check blocks after record", async () => {
      await repo.cooldown.record("test-key", cooldownMs);
      const result = await repo.cooldown.check("test-key", cooldownMs);
      expect(result.allowed).toBe(false);
      expect(result.remainingMs).toBeGreaterThan(0);
      expect(result.remainingMs).toBeLessThanOrEqual(cooldownMs);
    });

    test("check allows after cooldown expires", async () => {
      const shortCooldown = 50; // 50ms
      await repo.cooldown.record("test-key-2", shortCooldown);

      // Wait for cooldown to expire
      await new Promise((r) => setTimeout(r, shortCooldown + 10));

      const result = await repo.cooldown.check("test-key-2", shortCooldown);
      expect(result.allowed).toBe(true);
    });
  });

  describe("CredentialsRepo", () => {
    test("set and get work correctly", async () => {
      await repo.credentials.set("user1", { password: "pass123", patientId: "P001" });

      const cred = await repo.credentials.get("user1");
      expect(cred).toBeDefined();
      expect(cred!.password).toBe("pass123");
      expect(cred!.patientId).toBe("P001");
    });

    test("has returns correct values", async () => {
      expect(await repo.credentials.has("nonexistent")).toBe(false);
      await repo.credentials.set("user2", { password: "pass", patientId: "P002" });
      expect(await repo.credentials.has("user2")).toBe(true);
    });

    test("loadAll returns all credentials", async () => {
      await repo.credentials.set("user1", { password: "pass1", patientId: "P001" });
      await repo.credentials.set("user2", { password: "pass2", patientId: "P002" });

      const all = await repo.credentials.loadAll();
      expect(all.size).toBe(2);
    });
  });

  describe("AuditLogRepo", () => {
    test("log and getEntries work correctly", async () => {
      await repo.auditLog.log({
        timestamp: new Date().toISOString(),
        action: "ingest_auth_success",
        apiKeyPrefix: "abc12345",
        ip: "127.0.0.1",
        userAgent: "test",
        path: "/api/ingest",
        method: "POST",
        recordCount: 1,
      });

      const entries = await repo.auditLog.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.action).toBe("ingest_auth_success");
    });

    test("filter by action works", async () => {
      await repo.auditLog.log({
        timestamp: new Date().toISOString(),
        action: "ingest_auth_success",
        apiKeyPrefix: "abc",
        ip: "127.0.0.1",
        userAgent: "test",
        path: "/api/ingest",
        method: "POST",
      });

      await repo.auditLog.log({
        timestamp: new Date().toISOString(),
        action: "ingest_auth_failure",
        apiKeyPrefix: "xyz",
        ip: "127.0.0.1",
        userAgent: "test",
        path: "/api/ingest",
        method: "POST",
        reason: "Invalid key",
      });

      const failures = await repo.auditLog.getEntries({ action: "ingest_auth_failure" });
      expect(failures).toHaveLength(1);
      expect(failures[0]!.reason).toBe("Invalid key");
    });
  });

  describe("RequestLogRepo", () => {
    test("log and getEntries work correctly", async () => {
      await repo.requestLog.log({
        timestamp: new Date().toISOString(),
        method: "GET",
        path: "/api/patients",
        status: 200,
        durationMs: 15,
        ip: "127.0.0.1",
        userAgent: "test",
      });

      const entries = await repo.requestLog.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.path).toBe("/api/patients");
    });

    test("filter by method works", async () => {
      await repo.requestLog.log({
        timestamp: new Date().toISOString(),
        method: "GET",
        path: "/api/patients",
        status: 200,
        durationMs: 15,
        ip: "127.0.0.1",
        userAgent: "test",
      });

      await repo.requestLog.log({
        timestamp: new Date().toISOString(),
        method: "POST",
        path: "/api/ingest",
        status: 201,
        durationMs: 50,
        ip: "127.0.0.1",
        userAgent: "test",
      });

      const posts = await repo.requestLog.getEntries({ method: "POST" });
      expect(posts).toHaveLength(1);
      expect(posts[0]!.path).toBe("/api/ingest");
    });

    test("getStats calculates correctly", async () => {
      await repo.requestLog.log({
        timestamp: new Date().toISOString(),
        method: "GET",
        path: "/api/patients",
        status: 200,
        durationMs: 10,
        ip: "127.0.0.1",
        userAgent: "test",
      });

      await repo.requestLog.log({
        timestamp: new Date().toISOString(),
        method: "GET",
        path: "/api/patients",
        status: 200,
        durationMs: 20,
        ip: "127.0.0.1",
        userAgent: "test",
      });

      const stats = await repo.requestLog.getStats();
      expect(stats.total).toBe(2);
      expect(stats.avgDurationMs).toBe(15);
      expect(stats.byMethod["GET"]).toBe(2);
      expect(stats.byStatus["2xx"]).toBe(2);
    });
  });
});

describe("createRepoContext", () => {
  test("creates Bun context with default data dir", () => {
    const repo = createRepoContext({ runtime: "bun" });
    expect(repo.ingest).toBeDefined();
    expect(repo.patients).toBeDefined();
    expect(repo.evaluations).toBeDefined();
    expect(repo.cooldown).toBeDefined();
    expect(repo.credentials).toBeDefined();
    expect(repo.auditLog).toBeDefined();
    expect(repo.requestLog).toBeDefined();
  });

  test("throws for unknown runtime", () => {
    expect(() => {
      createRepoContext({ runtime: "unknown" as any });
    }).toThrow("Unknown runtime");
  });
});

describe("Constants", () => {
  test("DEFAULT_PATIENT_COOLDOWN_MS is 4 hours", () => {
    expect(DEFAULT_PATIENT_COOLDOWN_MS).toBe(4 * 60 * 60 * 1000);
  });
});
