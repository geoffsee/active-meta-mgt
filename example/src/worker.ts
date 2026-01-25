/**
 * Cloudflare Worker entry point for active-meta-mgt example.
 *
 * Replaces Bun.serve() with Hono router and KV storage.
 */

/// <reference types="@cloudflare/workers-types" />

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { makeDefaultActiveMetaContext } from "active-meta-mgt";
import { SPECIALISTS, type Specialist } from "./specialists";
import {
  detectConflicts,
  makeSpecialistCoordinator,
  snapshotRuns,
  snapshotConflicts,
  snapshotFindings,
  snapshotFollowUps,
  structureSpecialistResponse,
  makeRunId,
} from "./specialistCoordinator";
import {
  listScenarios,
  createContextForScenario,
  type AvailableScenarioId,
} from "./scenarios";
import { labRanges, getLabNames } from "./data/reference/labRanges";
import { icdToScenario, getMappedIcdCodes } from "./data/reference/icdMapping";
import { drugConstraints } from "./data/reference/drugRules";
import type { Patient } from "./data/loaders/patients";
import OpenAI from "openai";
import { parseAndAlignCases } from "./data/importer";
import { Buffer } from "node:buffer";

// Polyfill Buffer for the Workers runtime (used by third-party libs)
// Cloudflare Workers doesn’t expose Buffer globally.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
if (typeof globalThis.Buffer === "undefined") {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  globalThis.Buffer = Buffer;
}

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

interface Env {
  PATIENTS_KV: KVNamespace;
  OPENAI_API_KEY: string;
  INGEST_API_KEY: string;
  INGEST_API_SECRET: string;
}

type Bindings = Env;

type Variables = {
  openai: OpenAI;
};

// --------------------------------------------------------------------------
// App
// --------------------------------------------------------------------------

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Middleware
app.use("*", cors());
app.use("*", logger());

// --------------------------------------------------------------------------
// KV-based Patient Storage
// --------------------------------------------------------------------------

const INGEST_LOG_KEY = "ingest:log";
const PATIENTS_INDEX_KEY = "patients:index";
const PATIENTS_CACHE_KEY = "patients:all"; // Denormalized cache of all patients
const EVAL_CACHE_PREFIX = "eval:"; // Prefix for evaluation cache keys
const EVAL_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const EVAL_COOLDOWN_PREFIX = "cooldown:"; // Prefix for rate limit cooldown keys
const PATIENT_EVAL_COOLDOWN_SECONDS = 4 * 60 * 60; // 4 hours cooldown per patient
const EVAL_LOG_KEY = "evaluations:log"; // Permanent evaluation audit log
const MAX_EVAL_LOG_ENTRIES = 10000; // Maximum evaluation records to keep

async function checkPatientCooldown(
  kv: Env["PATIENTS_KV"],
  patientId: string
): Promise<{ allowed: boolean; remainingSeconds: number }> {
  const key = `${EVAL_COOLDOWN_PREFIX}${patientId}`;
  const record = await kv.get<{ timestamp: number }>(key, "json");

  if (!record) {
    return { allowed: true, remainingSeconds: 0 };
  }

  const now = Math.floor(Date.now() / 1000);
  const elapsed = now - record.timestamp;

  if (elapsed >= PATIENT_EVAL_COOLDOWN_SECONDS) {
    return { allowed: true, remainingSeconds: 0 };
  }

  return {
    allowed: false,
    remainingSeconds: PATIENT_EVAL_COOLDOWN_SECONDS - elapsed,
  };
}

async function recordPatientEvaluation(
  kv: Env["PATIENTS_KV"],
  patientId: string
): Promise<void> {
  const key = `${EVAL_COOLDOWN_PREFIX}${patientId}`;
  await kv.put(
    key,
    JSON.stringify({ timestamp: Math.floor(Date.now() / 1000) }),
    { expirationTtl: PATIENT_EVAL_COOLDOWN_SECONDS }
  );
}

// =============================================================================
// Medical-Grade Authentication (HIPAA Compliant)
// API Key + HMAC-SHA256 signature verification with replay protection
// =============================================================================

const AUTH_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes
const AUDIT_LOG_KEY = "audit:log";
const MAX_AUDIT_ENTRIES = 10000;

interface AuditLogEntry {
  timestamp: string;
  action: "ingest_auth_success" | "ingest_auth_failure";
  apiKeyPrefix: string;
  ip: string;
  userAgent: string;
  path: string;
  method: string;
  reason?: string;
  recordCount?: number;
}

async function logAudit(kv: Env["PATIENTS_KV"], entry: AuditLogEntry): Promise<void> {
  try {
    const existing = await kv.get<AuditLogEntry[]>(AUDIT_LOG_KEY, "json");
    const log = existing || [];
    log.push(entry);
    // Rotate to prevent storage bloat
    const trimmed = log.length > MAX_AUDIT_ENTRIES ? log.slice(-MAX_AUDIT_ENTRIES) : log;
    await kv.put(AUDIT_LOG_KEY, JSON.stringify(trimmed));
  } catch {
    // Don't fail the request if audit logging fails
    console.error("[AUDIT ERROR]", entry);
  }
}

// =============================================================================
// Evaluation Persistence (Permanent Audit Trail)
// =============================================================================

interface EvaluationRecord {
  _id: string;
  _ts: string;
  patientId: string;
  patient: {
    summary: string;
    diagnosis: string;
    category: string;
    severity: number;
    critical: boolean;
  };
  scenario: {
    id: string;
    title: string;
  };
  structured: {
    runs: unknown[];
    findings: unknown[];
    conflicts: unknown[];
    followUps: unknown[];
  };
  timestamp: string;
}

async function appendEvaluation(
  kv: Env["PATIENTS_KV"],
  data: Omit<EvaluationRecord, "_id" | "_ts">
): Promise<EvaluationRecord> {
  const record: EvaluationRecord = {
    _id: `eval-${data.patientId}-${Date.now().toString(36)}`,
    _ts: new Date().toISOString(),
    ...data,
  };

  try {
    const existing = await kv.get<EvaluationRecord[]>(EVAL_LOG_KEY, "json");
    const log = existing || [];
    log.push(record);
    // Rotate to prevent storage bloat
    const trimmed = log.length > MAX_EVAL_LOG_ENTRIES ? log.slice(-MAX_EVAL_LOG_ENTRIES) : log;
    await kv.put(EVAL_LOG_KEY, JSON.stringify(trimmed));
  } catch (err) {
    console.error("[EVAL LOG ERROR]", err);
  }

  return record;
}

async function getEvaluationLog(kv: Env["PATIENTS_KV"]): Promise<EvaluationRecord[]> {
  try {
    const log = await kv.get<EvaluationRecord[]>(EVAL_LOG_KEY, "json");
    return log || [];
  } catch {
    return [];
  }
}

async function getPatientEvaluations(
  kv: Env["PATIENTS_KV"],
  patientId: string
): Promise<EvaluationRecord[]> {
  const log = await getEvaluationLog(kv);
  return log.filter((e) => e.patientId === patientId);
}

async function getLatestEvaluation(
  kv: Env["PATIENTS_KV"],
  patientId: string
): Promise<EvaluationRecord | null> {
  const evals = await getPatientEvaluations(kv, patientId);
  if (evals.length === 0) return null;
  return evals.sort((a, b) =>
    new Date(b._ts).getTime() - new Date(a._ts).getTime()
  )[0];
}

async function getEvaluationStats(kv: Env["PATIENTS_KV"]): Promise<{
  total: number;
  byPatient: Record<string, number>;
  recent24h: number;
}> {
  const evals = await getEvaluationLog(kv);
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const byPatient: Record<string, number> = {};
  let recent24h = 0;

  for (const e of evals) {
    byPatient[e.patientId] = (byPatient[e.patientId] || 0) + 1;
    if (now - new Date(e._ts).getTime() < day) {
      recent24h++;
    }
  }

  return { total: evals.length, byPatient, recent24h };
}

function getClientIP(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

// Timing-safe comparison for Workers (no crypto.timingSafeEqual)
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function computeHmacSha256(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, messageData);
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface AuthResult {
  authenticated: boolean;
  error?: string;
  statusCode?: number;
}

async function verifyIngestAuth(
  env: Env,
  req: Request,
  body: string
): Promise<AuthResult> {
  if (!env.INGEST_API_KEY || !env.INGEST_API_SECRET) {
    return {
      authenticated: false,
      error: "Ingest authentication not configured. Set INGEST_API_KEY and INGEST_API_SECRET secrets.",
      statusCode: 503,
    };
  }

  const apiKey = req.headers.get("X-API-Key");
  const signature = req.headers.get("X-Signature");
  const timestamp = req.headers.get("X-Timestamp");

  if (!apiKey || !signature || !timestamp) {
    return {
      authenticated: false,
      error: "Missing required authentication headers: X-API-Key, X-Signature, X-Timestamp",
      statusCode: 401,
    };
  }

  if (!timingSafeEqual(apiKey, env.INGEST_API_KEY)) {
    return {
      authenticated: false,
      error: "Invalid API key",
      statusCode: 401,
    };
  }

  const requestTime = parseInt(timestamp, 10);
  if (isNaN(requestTime)) {
    return {
      authenticated: false,
      error: "Invalid timestamp format",
      statusCode: 401,
    };
  }

  const now = Date.now();
  if (Math.abs(now - requestTime) > AUTH_TIMESTAMP_TOLERANCE_MS) {
    return {
      authenticated: false,
      error: "Request timestamp expired or invalid (must be within 5 minutes)",
      statusCode: 401,
    };
  }

  const url = new URL(req.url);
  const signaturePayload = `${timestamp}${req.method}${url.pathname}${body}`;
  const expectedSignature = await computeHmacSha256(env.INGEST_API_SECRET, signaturePayload);

  if (!timingSafeEqual(signature, expectedSignature)) {
    return {
      authenticated: false,
      error: "Invalid signature",
      statusCode: 401,
    };
  }

  return { authenticated: true };
}

// In-memory cache for the worker instance (survives across requests in same isolate)
let patientsCache: { data: Patient[]; ts: number } | null = null;
let statsCache: { data: ReturnType<typeof getDatasetStats>; ts: number } | null = null;
const CACHE_TTL_MS = 30_000; // 30 seconds

interface IngestRecord {
  _ts: string;
  _type: "patient" | "vitals" | "labs" | "meds" | "note" | "unknown";
  _id: string;
  [key: string]: unknown;
}

async function appendToKV(
  kv: Env["PATIENTS_KV"],
  data: Record<string, unknown>
): Promise<IngestRecord> {
  const record: IngestRecord = {
    _ts: new Date().toISOString(),
    _type: inferType(data),
    _id: inferId(data),
    ...data,
  };

  // Get existing log
  const existing = await kv.get<IngestRecord[]>(INGEST_LOG_KEY, "json");
  const log = existing || [];
  log.push(record);

  // Store updated log
  await kv.put(INGEST_LOG_KEY, JSON.stringify(log));

  // Update patient index
  if (record._type === "patient") {
    const patient = toPatient(record);
    await kv.put(`patient:${patient.patient_id}`, JSON.stringify(patient));

    // Update index
    const index = (await kv.get<string[]>(PATIENTS_INDEX_KEY, "json")) || [];
    if (!index.includes(patient.patient_id)) {
      index.push(patient.patient_id);
      await kv.put(PATIENTS_INDEX_KEY, JSON.stringify(index));
    }

    // Invalidate caches
    patientsCache = null;
    statsCache = null;
    kv.delete(PATIENTS_CACHE_KEY).catch(() => {});
  }

  return record;
}

async function readLogFromKV(kv: Env["PATIENTS_KV"]): Promise<IngestRecord[]> {
  return (await kv.get<IngestRecord[]>(INGEST_LOG_KEY, "json")) || [];
}

async function loadPatientsFromKV(kv: Env["PATIENTS_KV"]): Promise<Patient[]> {
  // Check in-memory cache first
  if (patientsCache && Date.now() - patientsCache.ts < CACHE_TTL_MS) {
    return patientsCache.data;
  }

  // Try denormalized cache in KV (single read for all patients)
  const cached = await kv.get<Patient[]>(PATIENTS_CACHE_KEY, "json");
  if (cached) {
    patientsCache = { data: cached, ts: Date.now() };
    return cached;
  }

  // Fallback: parallel reads from individual keys
  const index = (await kv.get<string[]>(PATIENTS_INDEX_KEY, "json")) || [];
  if (index.length === 0) return [];

  // Parallel fetch all patients at once
  const results = await Promise.all(
    index.map((id) => kv.get<Patient>(`patient:${id}`, "json"))
  );
  const patients = results.filter((p): p is Patient => p !== null);

  // Update caches
  patientsCache = { data: patients, ts: Date.now() };
  // Store denormalized cache for future requests (fire and forget)
  kv.put(PATIENTS_CACHE_KEY, JSON.stringify(patients)).catch(() => {});

  return patients;
}

async function getPatientFromKV(
  kv: Env["PATIENTS_KV"],
  id: string
): Promise<Patient | null> {
  return await kv.get<Patient>(`patient:${id}`, "json");
}

// --------------------------------------------------------------------------
// Data transformation helpers (from ingest.ts)
// --------------------------------------------------------------------------

function inferType(data: Record<string, unknown>): IngestRecord["_type"] {
  const hasId =
    data.patient_id || data.id || data.mrn || data.patientId || data.subject_id;
  const hasClinical =
    data.diagnosis ||
    data.primary_diagnosis ||
    data.dx ||
    data.chief_complaint ||
    data.age;
  if (hasId && hasClinical) return "patient";
  if (data.note || data.text || data.narrative) return "note";
  if (data.medications || data.meds) return "meds";
  const onlyVitals =
    (data.vitals || data.spo2 || data.heart_rate || data.bp) && !hasClinical;
  if (onlyVitals) return "vitals";
  const onlyLabs =
    (data.labs || data.hemoglobin || data.wbc || data.creatinine) &&
    !hasClinical;
  if (onlyLabs) return "labs";
  if (hasId) return "patient";
  return "unknown";
}

function inferId(data: Record<string, unknown>): string {
  return str(
    data.patient_id ||
      data.id ||
      data.mrn ||
      data.patientId ||
      data.subject_id ||
      data.encounter_id ||
      `auto-${Date.now()}`
  );
}

function str(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val);
}

function num(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function toBool(val: unknown): boolean {
  if (typeof val === "boolean") return val;
  if (typeof val === "string")
    return val.toLowerCase() === "true" || val === "1";
  if (typeof val === "number") return val !== 0;
  return false;
}

function toArray(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === "string") {
    if (val.includes("|")) return val.split("|").filter(Boolean);
    if (val.includes(","))
      return val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    return [val];
  }
  return [];
}

function ageToBucket(age: number | null): string {
  if (!age) return "unknown";
  if (age < 18) return "0-17";
  if (age <= 30) return "18-30";
  if (age <= 45) return "31-45";
  if (age <= 60) return "46-60";
  if (age <= 75) return "61-75";
  return "76+";
}

function normalizeGender(val: unknown): "M" | "F" | "U" {
  const s = str(val).toUpperCase();
  if (s === "M" || s === "MALE" || s === "1") return "M";
  if (s === "F" || s === "FEMALE" || s === "0" || s === "2") return "F";
  return "U";
}

function inferCategory(data: Record<string, unknown>): string {
  const dx = str(data.primary_diagnosis || data.diagnosis || "").toLowerCase();
  if (
    dx.includes("sepsis") ||
    dx.includes("pneumonia") ||
    dx.includes("infection")
  )
    return "infectious";
  if (
    dx.includes("heart") ||
    dx.includes("cardiac") ||
    dx.includes("mi") ||
    dx.includes("chf")
  )
    return "cardiac";
  if (
    dx.includes("respiratory") ||
    dx.includes("copd") ||
    dx.includes("asthma")
  )
    return "respiratory";
  if (dx.includes("diabetes") || dx.includes("metabolic")) return "metabolic";
  if (dx.includes("liver") || dx.includes("gi") || dx.includes("bowel"))
    return "gi";
  if (dx.includes("stroke") || dx.includes("neuro")) return "neuro";
  if (
    dx.includes("trauma") ||
    dx.includes("fracture") ||
    dx.includes("injury")
  )
    return "trauma";
  if (
    dx.includes("cancer") ||
    dx.includes("malignant") ||
    dx.includes("tumor")
  )
    return "oncology";
  return "other";
}

function extractVitals(data: Record<string, unknown>): Patient["vitals"] {
  const v = (data.vitals as Record<string, unknown>) || data;
  return {
    spo2: num(v.spo2 || v.o2sat || v.oxygen_saturation),
    heart_rate: num(v.heart_rate || v.hr || v.pulse),
    systolic_bp: num(
      v.systolic_bp || v.sbp || v.systolic || parseBpSystolic(v.bp)
    ),
    diastolic_bp: num(
      v.diastolic_bp || v.dbp || v.diastolic || parseBpDiastolic(v.bp)
    ),
    oxygen_flow: num(v.oxygen_flow || v.o2_flow || v.fio2),
    temperature: num(v.temperature || v.temp),
    respiratory_rate: num(v.respiratory_rate || v.rr || v.resp_rate),
    respiratory_status: str(v.respiratory_status || v.resp_status) || "unknown",
  };
}

function extractLabs(data: Record<string, unknown>): Patient["labs"] {
  const l = (data.labs as Record<string, unknown>) || data;
  return {
    hemoglobin: num(l.hemoglobin || l.hgb || l.hb),
    wbc: num(l.wbc || l.white_blood_cells),
    rbc: num(l.rbc || l.red_blood_cells),
    platelets: num(l.platelets || l.plt),
    hematocrit: num(l.hematocrit || l.hct),
    mcv: num(l.mcv),
    mch: num(l.mch),
    mchc: num(l.mchc),
    rdw: num(l.rdw),
    neutrophils: num(l.neutrophils || l.neut),
    lymphocytes: num(l.lymphocytes || l.lymph),
    monocytes: num(l.monocytes || l.mono),
    eosinophils: num(l.eosinophils || l.eos),
    basophils: num(l.basophils || l.baso),
    creatinine: num(l.creatinine || l.cr),
    bun: num(l.bun),
    glucose: num(l.glucose || l.glu || l.bg),
    sodium: num(l.sodium || l.na),
    potassium: num(l.potassium || l.k),
    lactate: num(l.lactate || l.lac),
  };
}

function parseBpSystolic(bp: unknown): number | null {
  const s = str(bp);
  const match = s.match(/(\d+)\s*\/\s*\d+/);
  return match ? num(match[1]) : null;
}

function parseBpDiastolic(bp: unknown): number | null {
  const s = str(bp);
  const match = s.match(/\d+\s*\/\s*(\d+)/);
  return match ? num(match[1]) : null;
}

function toPatient(data: Record<string, unknown>): Patient {
  return {
    patient_id: str(
      data.patient_id ||
        data.id ||
        data.mrn ||
        data.patientId ||
        `P${Date.now()}`
    ),
    age: num(data.age) || 0,
    age_bucket: str(data.age_bucket) || ageToBucket(num(data.age)),
    gender: normalizeGender(data.gender || data.sex),
    blood_type: str(data.blood_type || data.bloodType) || "Unknown",
    primary_diagnosis:
      str(
        data.primary_diagnosis ||
          data.diagnosis ||
          data.dx ||
          data.chief_complaint
      ) || "Unknown",
    icd9_code: str(data.icd9_code || data.icd9 || data.icd || data.code) || "",
    secondary_diagnoses: toArray(
      data.secondary_diagnoses || data.diagnoses || data.comorbidities
    ),
    condition_category:
      str(data.condition_category || data.category) || inferCategory(data),
    insurance: str(data.insurance || data.payer) || "Unknown",
    admission_type: str(data.admission_type || data.admit_type) || "UNKNOWN",
    vitals: extractVitals(data),
    labs: extractLabs(data),
    medications: toArray(data.medications || data.meds || data.drugs),
    allergies: toArray(data.allergies),
    severity_score:
      num(data.severity_score || data.severity || data.acuity) || 5,
    critical_flag: toBool(data.critical_flag || data.critical || data.icu),
  };
}

// --------------------------------------------------------------------------
// Scenario generation (simplified - works with KV patients)
// --------------------------------------------------------------------------

function generateScenarioFromPatient(patient: Patient, config?: any) {
  const id = `generated-${patient.patient_id}`;
  const title = `${patient.primary_diagnosis} - ${patient.age}${patient.gender}`;
  const description = `Automated scenario for patient ${patient.patient_id}`;

  // Generate knowledge objects from patient data
  const goals = [
    {
      id: `${id}-goal-1`,
      title: `Manage ${patient.primary_diagnosis}`,
      description: `Primary treatment goal for ${patient.primary_diagnosis}`,
      priority: "p0" as const,
      tags: [{ key: "lane", value: "task" }],
    },
  ];

  const constraints = patient.allergies.map((allergy, i) => ({
    id: `${id}-constraint-${i}`,
    statement: `Allergy: ${allergy} - Patient has documented allergy to ${allergy}`,
    tags: [{ key: "lane", value: "medications" }],
  }));

  const assumptions = [
    {
      id: `${id}-assumption-1`,
      statement: `Patient demographics: ${patient.age}${patient.gender}, ${patient.admission_type}`,
      confidence: "high" as const,
      tags: [{ key: "lane", value: "task" }],
    },
  ];

  const evidence: any[] = [];

  // Add vitals as evidence
  const v = patient.vitals;
  if (v.spo2 != null) {
    evidence.push({
      id: `${id}-ev-spo2`,
      summary: `SpO2: ${v.spo2}%`,
      severity: v.spo2 < 90 ? "critical" : v.spo2 < 94 ? "high" : "low",
      confidence: 0.95,
      tags: [{ key: "lane", value: "monitoring" }],
    });
  }
  if (v.heart_rate != null) {
    evidence.push({
      id: `${id}-ev-hr`,
      summary: `Heart rate: ${v.heart_rate} bpm`,
      severity: v.heart_rate > 120 ? "critical" : v.heart_rate > 100 ? "high" : "low",
      confidence: 0.95,
      tags: [{ key: "lane", value: "monitoring" }],
    });
  }
  if (v.systolic_bp != null && v.diastolic_bp != null) {
    evidence.push({
      id: `${id}-ev-bp`,
      summary: `BP: ${Math.round(v.systolic_bp)}/${Math.round(v.diastolic_bp)} mmHg`,
      severity: v.systolic_bp < 90 ? "critical" : v.systolic_bp < 100 ? "high" : "low",
      confidence: 0.95,
      tags: [{ key: "lane", value: "monitoring" }],
    });
  }

  // Add critical labs as evidence
  const l = patient.labs;
  if (l.lactate != null) {
    evidence.push({
      id: `${id}-ev-lactate`,
      summary: `Lactate: ${l.lactate} mmol/L`,
      severity: l.lactate > 4 ? "critical" : l.lactate > 2 ? "high" : "low",
      confidence: 0.9,
      tags: [
        { key: "lane", value: "differential" },
        { key: "lane", value: "threat-model" },
      ],
    });
  }
  if (l.creatinine != null) {
    evidence.push({
      id: `${id}-ev-creat`,
      summary: `Creatinine: ${l.creatinine} mg/dL`,
      severity: l.creatinine > 2 ? "critical" : l.creatinine > 1.3 ? "high" : "low",
      confidence: 0.9,
      tags: [{ key: "lane", value: "differential" }],
    });
  }

  const questions = [
    {
      id: `${id}-q-1`,
      question: `What is the optimal treatment approach for ${patient.primary_diagnosis}?`,
      tags: [{ key: "lane", value: "task" }],
    },
  ];

  const decisions: any[] = [];

  return {
    id,
    title,
    description,
    patient: {
      id: patient.patient_id,
      age: patient.age,
      gender: patient.gender,
      diagnosis: patient.primary_diagnosis,
      category: patient.condition_category,
      severity: patient.severity_score,
      critical: patient.critical_flag,
    },
    goals,
    constraints,
    assumptions,
    evidence,
    questions,
    decisions,
  };
}

function getPatientSummary(p: Patient) {
  return {
    id: p.patient_id,
    age: p.age,
    gender: p.gender,
    primaryDiagnosis: p.primary_diagnosis,
    category: p.condition_category,
    severityScore: p.severity_score,
    criticalFlag: p.critical_flag,
  };
}

function getDatasetStats(patients: Patient[]) {
  // Return cached stats if available and patients haven't changed
  if (statsCache && Date.now() - statsCache.ts < CACHE_TTL_MS) {
    return statsCache.data;
  }

  const byCategory: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  let critical = 0;

  for (const p of patients) {
    byCategory[p.condition_category] =
      (byCategory[p.condition_category] || 0) + 1;
    const sevKey =
      p.severity_score <= 3 ? "low" : p.severity_score <= 6 ? "medium" : "high";
    bySeverity[sevKey] = (bySeverity[sevKey] || 0) + 1;
    if (p.critical_flag) critical++;
  }

  const stats = {
    total: patients.length,
    byCategory,
    bySeverity,
    critical,
  };

  statsCache = { data: stats, ts: Date.now() };
  return stats;
}

function filterPatients(
  patients: Patient[],
  criteria: {
    category?: string;
    critical?: boolean;
    minSeverity?: number;
    maxSeverity?: number;
  }
): Patient[] {
  // Single-pass filter for all criteria
  return patients.filter((p) => {
    if (criteria.category && p.condition_category !== criteria.category) return false;
    if (criteria.critical !== undefined && p.critical_flag !== criteria.critical) return false;
    if (criteria.minSeverity !== undefined && p.severity_score < criteria.minSeverity) return false;
    if (criteria.maxSeverity !== undefined && p.severity_score > criteria.maxSeverity) return false;
    return true;
  });
}

// --------------------------------------------------------------------------
// OpenAI client helper
// --------------------------------------------------------------------------

function makeOpenAI(apiKey: string): OpenAI {
  return new OpenAI({ apiKey });
}

// --------------------------------------------------------------------------
// Routes
// --------------------------------------------------------------------------

// Health check
app.get("/api/health", async (c) => {
  const patients = await loadPatientsFromKV(c.env.PATIENTS_KV);
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    patients: patients.length,
    runtime: "cloudflare-workers",
  });
});

// Scenarios (hardcoded)
app.get("/scenarios", (c) => {
  return c.json(listScenarios());
});

app.get("/scenarios/:id/context", (c) => {
  const id = c.req.param("id") as AvailableScenarioId;
  try {
    const { ctx, scenario } = createContextForScenario(id);
    return c.json({
      scenario: {
        id: scenario.id,
        title: scenario.title,
        description: scenario.description,
      },
      workingMemory: ctx.workingMemory,
      lanes: Array.from(ctx.lanes.entries()).map(([laneId, lane]) => ({
        id: laneId,
        name: lane.name,
        selected: lane.window.selected,
      })),
      activeWindow: ctx.activeWindow.selected,
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 404);
  }
});

app.post("/scenarios/:id/llm", async (c) => {
  const id = c.req.param("id") as AvailableScenarioId;
  let ctx, scenario;
  try {
    ({ ctx, scenario } = createContextForScenario(id));
  } catch (err) {
    return c.json({ error: (err as Error).message }, 404);
  }

  try {
    const openai = makeOpenAI(c.env.OPENAI_API_KEY);
    const system =
      "You are a clinical decision support assistant. Ground responses strictly in the provided working memory.";
    const user = `Working memory for scenario "${scenario.title}":\n${ctx.workingMemory.text}\n\nReturn a concise plan and cite which lane items you used.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    return c.json({
      scenario: scenario.id,
      workingMemory: ctx.workingMemory,
      response: completion.choices[0]?.message?.content,
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Patients
app.get("/api/patients", async (c) => {
  const url = new URL(c.req.url);
  const category = url.searchParams.get("category") || undefined;
  const critical = url.searchParams.get("critical");
  const minSeverity = url.searchParams.get("minSeverity");
  const maxSeverity = url.searchParams.get("maxSeverity");
  const limit = url.searchParams.get("limit");

  const allPatients = await loadPatientsFromKV(c.env.PATIENTS_KV);
  const patients = filterPatients(allPatients, {
    category,
    critical: critical ? critical === "true" : undefined,
    minSeverity: minSeverity ? parseInt(minSeverity) : undefined,
    maxSeverity: maxSeverity ? parseInt(maxSeverity) : undefined,
  });

  const limitNum = limit ? parseInt(limit) : 50;
  const summaries = patients.slice(0, limitNum).map(getPatientSummary);

  return c.json({
    patients: summaries,
    total: patients.length,
    stats: getDatasetStats(allPatients),
  });
});

app.get("/api/patients/:id", async (c) => {
  const id = c.req.param("id");
  const patient = await getPatientFromKV(c.env.PATIENTS_KV, id);
  if (!patient) {
    return c.json({ error: `Patient ${id} not found` }, 404);
  }
  return c.json(patient);
});

// Specialists
app.get("/api/specialists", (c) => {
  return c.json({
    specialists: SPECIALISTS.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      color: s.color,
      icon: s.icon,
    })),
  });
});

// Scenario generation
app.get("/api/scenarios/generate/:patientId", async (c) => {
  const patientId = c.req.param("patientId");
  const patient = await getPatientFromKV(c.env.PATIENTS_KV, patientId);
  if (!patient) {
    return c.json({ error: `Patient ${patientId} not found` }, 404);
  }
  const scenario = generateScenarioFromPatient(patient);
  return c.json(scenario);
});

app.get("/api/scenarios/generate/:patientId/context", async (c) => {
  const patientId = c.req.param("patientId");
  const patient = await getPatientFromKV(c.env.PATIENTS_KV, patientId);
  if (!patient) {
    return c.json({ error: `Patient ${patientId} not found` }, 404);
  }

  const scenario = generateScenarioFromPatient(patient);
  const ctx = makeDefaultActiveMetaContext(`generated-${patientId}`);

  scenario.goals.forEach((g) => ctx.upsertGoal(g));
  scenario.constraints.forEach((c) => ctx.upsertConstraint(c));
  scenario.assumptions.forEach((a) => ctx.upsertAssumption(a));
  scenario.evidence.forEach((e) => ctx.upsertEvidence(e));
  scenario.questions.forEach((q) => ctx.upsertQuestion(q));
  scenario.decisions.forEach((d) => ctx.upsertDecision(d));

  ctx.refreshAllLanes();
  ctx.mergeLanesToActiveWindow();
  ctx.synthesizeWorkingMemory({ tokenBudget: 700, archiveRawItems: false });

  return c.json({
    scenario: {
      id: scenario.id,
      title: scenario.title,
      description: scenario.description,
      patient: scenario.patient,
    },
    workingMemory: ctx.workingMemory,
    lanes: Array.from(ctx.lanes.entries()).map(([laneId, lane]) => ({
      id: laneId,
      name: lane.name,
      selected: lane.window.selected,
    })),
    activeWindow: ctx.activeWindow.selected,
  });
});

// Multi-specialist evaluation
app.post("/api/scenarios/generate/:patientId/evaluate", async (c) => {
  const patientId = c.req.param("patientId");
  const patient = await getPatientFromKV(c.env.PATIENTS_KV, patientId);
  if (!patient) {
    return c.json({ error: `Patient ${patientId} not found` }, 404);
  }

  // Check per-patient rate limit (cooldown)
  const cooldown = await checkPatientCooldown(c.env.PATIENTS_KV, patientId);
  if (!cooldown.allowed) {
    return c.json(
      {
        error: "Rate limited",
        message: `Patient ${patientId} was recently evaluated. Please wait ${cooldown.remainingSeconds} seconds before re-evaluating.`,
        retryAfter: cooldown.remainingSeconds,
        patientId,
      },
      {
        status: 429,
        headers: { "Retry-After": String(cooldown.remainingSeconds) },
      }
    );
  }

  let requestedSpecialists: string[] | undefined;
  let forceRefresh = false;
  try {
    const body = await c.req.json();
    requestedSpecialists = body.specialists;
    forceRefresh = body.refresh === true;
  } catch {
    // No body or invalid JSON
  }

  // Check URL param for refresh
  const url = new URL(c.req.url);
  if (url.searchParams.get("refresh") === "true") {
    forceRefresh = true;
  }

  // Generate cache key based on patient and specialists
  const specialistIds = (requestedSpecialists || SPECIALISTS.map((s) => s.id)).sort().join(",");
  const cacheKey = `${EVAL_CACHE_PREFIX}${patientId}:${specialistIds}`;

  // Check cache unless forced refresh
  if (!forceRefresh) {
    const cached = await c.env.PATIENTS_KV.get(cacheKey, "json");
    if (cached) {
      return c.json({ ...cached as object, cached: true });
    }
  }

  let openai: OpenAI;
  try {
    openai = makeOpenAI(c.env.OPENAI_API_KEY);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }

  const scenario = generateScenarioFromPatient(patient);
  const patientSummary = `${patient.age}${patient.gender} with ${patient.primary_diagnosis}`;

  const activeSpecialists = requestedSpecialists
    ? SPECIALISTS.filter((s) => requestedSpecialists!.includes(s.id))
    : SPECIALISTS;

  async function evaluateSpecialist(specialist: Specialist) {
    const ctx = makeDefaultActiveMetaContext(`${patientId}-${specialist.id}`);

    const lane = ctx.lanes.get("task");
    if (lane) {
      lane.setWindowPolicy({
        wSeverity: specialist.policy.wSeverity,
        wConfidence: specialist.policy.wConfidence,
        wPriority: specialist.policy.wPriority,
        wRecency: specialist.policy.wRecency,
        maxItems: specialist.policy.maxItems,
      });
      lane.setIncludeTagsAny(specialist.laneTags);
    }

    scenario.goals.forEach((g) => {
      const tags = [...g.tags];
      if (specialist.id === "monitoring") {
        tags.push({ key: "lane", value: "monitoring" });
      }
      ctx.upsertGoal({ ...g, tags });
    });

    scenario.constraints.forEach((c) => {
      const tags = [...c.tags];
      if (specialist.id === "medications") {
        tags.push({ key: "lane", value: "medications" });
      }
      ctx.upsertConstraint({ ...c, tags });
    });

    scenario.assumptions.forEach((a) => ctx.upsertAssumption(a));

    scenario.evidence.forEach((e) => {
      const tags = [...e.tags];
      if (specialist.id === "differential") {
        tags.push({ key: "lane", value: "differential" });
      }
      if (specialist.id === "risk") {
        tags.push({ key: "lane", value: "threat-model" });
      }
      ctx.upsertEvidence({ ...e, tags });
    });

    scenario.questions.forEach((q) => ctx.upsertQuestion(q));
    scenario.decisions.forEach((d) => ctx.upsertDecision(d));

    ctx.refreshAllLanes();
    ctx.mergeLanesToActiveWindow();
    ctx.synthesizeWorkingMemory({
      tokenBudget: specialist.tokenBudget,
      archiveRawItems: false,
    });

    const workingMemory = ctx.workingMemory.text;

    try {
      const userPrompt = specialist.userPromptTemplate
        .replace("{patient}", patientSummary)
        .replace("{workingMemory}", workingMemory);

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: specialist.systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      return {
        id: specialist.id,
        name: specialist.name,
        icon: specialist.icon,
        color: specialist.color,
        status: "success" as const,
        workingMemory,
        response: completion.choices[0]?.message?.content,
      };
    } catch (err) {
      return {
        id: specialist.id,
        name: specialist.name,
        icon: specialist.icon,
        color: specialist.color,
        status: "error" as const,
        workingMemory,
        error: (err as Error).message,
      };
    }
  }

  const results = await Promise.all(activeSpecialists.map(evaluateSpecialist));

  // Post-process
  const coordinator = makeSpecialistCoordinator();

  for (const result of results) {
    if (result.status !== "success") continue;
    try {
      const specialist = SPECIALISTS.find((s) => s.id === result.id);
      if (!specialist) continue;
      const findings = await structureSpecialistResponse({
        openai,
        specialist,
        patientId,
        patientSummary,
        workingMemory: result.workingMemory,
        rawResponse: result.response ?? "",
        maxItems: 8,
      });
      coordinator.addRun({
        id: makeRunId(patientId, result.id, result.response ?? ""),
        specialistId: result.id,
        workingMemory: result.workingMemory,
        rawText: result.response ?? "",
        findings,
      });
    } catch {
      coordinator.addRun({
        id: `${patientId}-${result.id}-${Date.now().toString(36)}-err`,
        specialistId: result.id,
        workingMemory: result.workingMemory,
        rawText: result.response ?? "",
        findings: [],
      });
    }
  }

  try {
    const conflicts = await detectConflicts({
      openai,
      findings: snapshotFindings(coordinator),
      maxItems: 6,
    });
    coordinator.setConflicts(conflicts);
  } catch {
    // leave conflicts empty
  }

  const response = {
    patientId,
    patient: {
      summary: patientSummary,
      diagnosis: patient.primary_diagnosis,
      category: patient.condition_category,
      severity: patient.severity_score,
      critical: patient.critical_flag,
    },
    scenario: {
      id: scenario.id,
      title: scenario.title,
    },
    specialists: results,
    structured: {
      runs: snapshotRuns(coordinator.runs),
      findings: snapshotFindings(coordinator),
      conflicts: snapshotConflicts(coordinator),
      followUps: snapshotFollowUps(coordinator),
    },
    timestamp: new Date().toISOString(),
  };

  // Record evaluation for rate limiting and cache the result (fire and forget)
  recordPatientEvaluation(c.env.PATIENTS_KV, patientId).catch(() => {});
  c.env.PATIENTS_KV.put(cacheKey, JSON.stringify(response), {
    expirationTtl: EVAL_CACHE_TTL_SECONDS,
  }).catch(() => {});

  // Persist evaluation to permanent audit log (fire and forget)
  appendEvaluation(c.env.PATIENTS_KV, response).catch((err) => {
    console.error("Failed to persist evaluation:", err);
  });

  return c.json({ ...response, cached: false });
});

// Ingest (protected with HIPAA-compliant authentication)
app.post("/api/ingest", async (c) => {
  const clientIP = getClientIP(c.req.raw);
  const userAgent = c.req.header("user-agent") || "unknown";
  const apiKeyPrefix = (c.req.header("X-API-Key") || "").slice(0, 8) || "none";

  // Read body for signature verification
  let bodyText: string;
  try {
    bodyText = await c.req.text();
  } catch {
    return c.json({ error: "Failed to read request body" }, 400);
  }

  // Verify authentication
  const authResult = await verifyIngestAuth(c.env, c.req.raw, bodyText);
  if (!authResult.authenticated) {
    logAudit(c.env.PATIENTS_KV, {
      timestamp: new Date().toISOString(),
      action: "ingest_auth_failure",
      apiKeyPrefix,
      ip: clientIP,
      userAgent,
      path: "/api/ingest",
      method: "POST",
      reason: authResult.error,
    }).catch(() => {});

    return c.json(
      {
        error: "Authentication failed",
        message: authResult.error,
        documentation: "https://docs.example.com/api/authentication",
      },
      {
        status: authResult.statusCode || 401,
        headers: { "WWW-Authenticate": 'HMAC-SHA256 realm="ingest"' },
      }
    );
  }

  try {
    const contentType = c.req.header("content-type") || "";
    let recordCount = 0;

    if (
      contentType.includes("application/x-ndjson") ||
      contentType.includes("text/plain")
    ) {
      const lines = bodyText.split("\n").filter(Boolean);
      const records = [];
      for (const line of lines) {
        records.push(await appendToKV(c.env.PATIENTS_KV, JSON.parse(line)));
      }
      recordCount = records.length;

      logAudit(c.env.PATIENTS_KV, {
        timestamp: new Date().toISOString(),
        action: "ingest_auth_success",
        apiKeyPrefix,
        ip: clientIP,
        userAgent,
        path: "/api/ingest",
        method: "POST",
        recordCount,
      }).catch(() => {});

      return c.json({ ingested: records.length, records });
    }

    const body = JSON.parse(bodyText);

    if (Array.isArray(body)) {
      const records = [];
      for (const item of body) {
        records.push(await appendToKV(c.env.PATIENTS_KV, item));
      }
      recordCount = records.length;

      logAudit(c.env.PATIENTS_KV, {
        timestamp: new Date().toISOString(),
        action: "ingest_auth_success",
        apiKeyPrefix,
        ip: clientIP,
        userAgent,
        path: "/api/ingest",
        method: "POST",
        recordCount,
      }).catch(() => {});

      return c.json({ ingested: records.length, records });
    }

    const record = await appendToKV(c.env.PATIENTS_KV, body);
    recordCount = 1;

    logAudit(c.env.PATIENTS_KV, {
      timestamp: new Date().toISOString(),
      action: "ingest_auth_success",
      apiKeyPrefix,
      ip: clientIP,
      userAgent,
      path: "/api/ingest",
      method: "POST",
      recordCount,
    }).catch(() => {});

    return c.json({ ingested: 1, record });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// Import (align + ingest) - no auth, intended for demo UI
app.post("/api/import", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const content = body?.content;
  const format = body?.format as "json" | "csv" | undefined;

  if (!content || typeof content !== "string") {
    return c.json({ error: "content (string) is required" }, 400);
  }

  try {
    const aligned = parseAndAlignCases(content, format);
    const records = [];

    for (const cased of aligned) {
      records.push(await appendToKV(c.env.PATIENTS_KV, cased.aligned));
    }

    return c.json({
      ingested: records.length,
      cases: aligned.map((cased, idx) => ({
        patientId: cased.aligned.patient_id,
        username: cased.credentials.username,
        password: cased.credentials.password,
        timestamp: records[idx]?._ts,
      })),
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.get("/api/ingest/log", async (c) => {
  const url = new URL(c.req.url);
  const limit = parseInt(url.searchParams.get("limit") || "100");
  const log = await readLogFromKV(c.env.PATIENTS_KV);
  return c.json({
    total: log.length,
    records: log.slice(-limit),
  });
});

app.get("/api/ingest/patients", async (c) => {
  const patients = await loadPatientsFromKV(c.env.PATIENTS_KV);
  return c.json({
    total: patients.length,
    patients: patients.map((p) => ({
      id: p.patient_id,
      age: p.age,
      gender: p.gender,
      diagnosis: p.primary_diagnosis,
      category: p.condition_category,
      severity: p.severity_score,
      critical: p.critical_flag,
    })),
  });
});

// Audit log access (requires API key)
app.get("/api/ingest/audit", async (c) => {
  const apiKey = c.req.header("X-API-Key");
  if (!c.env.INGEST_API_KEY || apiKey !== c.env.INGEST_API_KEY) {
    return c.json(
      { error: "Unauthorized - API key required to access audit logs" },
      401
    );
  }

  const url = new URL(c.req.url);
  const limit = parseInt(url.searchParams.get("limit") || "100");
  const action = url.searchParams.get("action") as AuditLogEntry["action"] | null;

  const log = await c.env.PATIENTS_KV.get<AuditLogEntry[]>(AUDIT_LOG_KEY, "json");
  let filtered = log || [];

  if (action) {
    filtered = filtered.filter((e) => e.action === action);
  }

  return c.json({
    total: filtered.length,
    entries: filtered.slice(-limit),
  });
});

// Reference data
app.get("/api/reference/lab-ranges", (c) => {
  return c.json({
    ranges: labRanges,
    labs: getLabNames(),
  });
});

app.get("/api/reference/lab-ranges/:labName", (c) => {
  const labName = c.req.param("labName");
  const range = labRanges[labName];
  if (!range) {
    return c.json({ error: `Lab ${labName} not found` }, 404);
  }
  return c.json(range);
});

app.get("/api/reference/conditions", (c) => {
  const codes = getMappedIcdCodes();
  const conditions = codes.map((code) => ({
    icd9_code: code,
    ...icdToScenario[code],
  }));
  return c.json({
    conditions,
    total: conditions.length,
  });
});

app.get("/api/reference/conditions/:code", (c) => {
  const code = c.req.param("code");
  const mapping = icdToScenario[code];
  if (!mapping) {
    return c.json({ error: `ICD code ${code} not mapped` }, 404);
  }
  return c.json({
    icd9_code: code,
    ...mapping,
  });
});

app.get("/api/reference/medications", (c) => {
  const medications = Object.entries(drugConstraints).map(([name, rules]) => ({
    name,
    ...rules,
  }));
  return c.json({
    medications,
    total: medications.length,
  });
});

app.get("/api/reference/medications/:name", (c) => {
  const name = c.req.param("name")?.toLowerCase();
  if (!name) {
    return c.json({ error: "Medication name required" }, 400);
  }
  const rules = drugConstraints[name];
  if (!rules) {
    return c.json({ error: `Medication ${name} not found` }, 404);
  }
  return c.json({
    name,
    ...rules,
  });
});

app.get("/api/scenarios/stats", async (c) => {
  const patients = await loadPatientsFromKV(c.env.PATIENTS_KV);
  return c.json({
    totalPatients: patients.length,
    categories: Array.from(new Set(patients.map((p) => p.condition_category))),
  });
});

// --- Evaluation history ---

app.get("/api/evaluations", async (c) => {
  const stats = await getEvaluationStats(c.env.PATIENTS_KV);
  return c.json(stats);
});

app.get("/api/evaluations/:patientId", async (c) => {
  const patientId = c.req.param("patientId");
  if (!patientId) {
    return c.json({ error: "Patient ID required" }, 400);
  }

  const evals = await getPatientEvaluations(c.env.PATIENTS_KV, patientId);
  return c.json({
    patientId,
    evaluations: evals,
    count: evals.length,
  });
});

app.get("/api/evaluations/:patientId/latest", async (c) => {
  const patientId = c.req.param("patientId");
  if (!patientId) {
    return c.json({ error: "Patient ID required" }, 400);
  }

  const latest = await getLatestEvaluation(c.env.PATIENTS_KV, patientId);
  if (!latest) {
    return c.json({ error: `No evaluations found for patient ${patientId}` }, 404);
  }

  return c.json(latest);
});

// Catch-all for 404
app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

export default app;
