/**
 * Cloudflare Workers repository implementation using KV storage.
 *
 * Uses KV for persistent storage with automatic TTL for cooldowns.
 * Includes in-memory caching within isolate lifetime for performance.
 */

/// <reference types="@cloudflare/workers-types" />

import type { Patient } from "../data/loaders/patients";
import type {
  IRepoContext,
  IIngestRepo,
  IEvaluationRepo,
  IPatientRepo,
  ICooldownRepo,
  ICredentialsRepo,
  IAuditLogRepo,
  IRequestLogRepo,
  IngestRecord,
  EvaluationRecord,
  AuditLogEntry,
  RequestLog,
  CaseCredential,
  CooldownResult,
  DatasetStats,
  EvaluationStats,
  PatientFilterCriteria,
  RequestLogFilter,
  CloudflareRepoConfig,
} from "./types";

// =============================================================================
// KV Key Constants
// =============================================================================

const INGEST_LOG_KEY = "ingest:log";
const PATIENTS_INDEX_KEY = "patients:index";
const PATIENTS_CACHE_KEY = "patients:all";
const EVAL_LOG_KEY = "evaluations:log";
const AUDIT_LOG_KEY = "audit:log";
const REQUEST_LOG_KEY = "requests:log";
const COOLDOWN_PREFIX = "cooldown:";
const PATIENT_PREFIX = "patient:";

const MAX_INGEST_LOG_ENTRIES = 50000;
const MAX_EVAL_LOG_ENTRIES = 10000;
const MAX_AUDIT_ENTRIES = 10000;
const MAX_REQUEST_LOG_ENTRIES = 10000;

// =============================================================================
// Helper Functions
// =============================================================================

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
  if (typeof val === "string") return val.toLowerCase() === "true" || val === "1";
  if (typeof val === "number") return val !== 0;
  return false;
}

function toArray(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === "string") {
    if (val.includes("|")) return val.split("|").filter(Boolean);
    if (val.includes(",")) return val.split(",").map((s) => s.trim()).filter(Boolean);
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
  if (dx.includes("sepsis") || dx.includes("pneumonia") || dx.includes("infection")) return "infectious";
  if (dx.includes("heart") || dx.includes("cardiac") || dx.includes("mi") || dx.includes("chf")) return "cardiac";
  if (dx.includes("respiratory") || dx.includes("copd") || dx.includes("asthma")) return "respiratory";
  if (dx.includes("diabetes") || dx.includes("metabolic")) return "metabolic";
  if (dx.includes("liver") || dx.includes("gi") || dx.includes("bowel")) return "gi";
  if (dx.includes("stroke") || dx.includes("neuro")) return "neuro";
  if (dx.includes("trauma") || dx.includes("fracture") || dx.includes("injury")) return "trauma";
  if (dx.includes("cancer") || dx.includes("malignant") || dx.includes("tumor")) return "oncology";
  return "other";
}

function inferType(data: Record<string, unknown>): IngestRecord["_type"] {
  const hasId = data.patient_id || data.id || data.mrn || data.patientId || data.subject_id;
  const hasClinical = data.diagnosis || data.primary_diagnosis || data.dx || data.chief_complaint || data.age;
  if (hasId && hasClinical) return "patient";
  if (data.note || data.text || data.narrative) return "note";
  if (data.medications || data.meds) return "meds";
  const onlyVitals = (data.vitals || data.spo2 || data.heart_rate || data.bp) && !hasClinical;
  if (onlyVitals) return "vitals";
  const onlyLabs = (data.labs || data.hemoglobin || data.wbc || data.creatinine) && !hasClinical;
  if (onlyLabs) return "labs";
  if (hasId) return "patient";
  return "unknown";
}

function inferId(data: Record<string, unknown>): string {
  return str(
    data.patient_id || data.id || data.mrn || data.patientId ||
    data.subject_id || data.encounter_id || `auto-${Date.now()}`
  );
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

function extractVitals(data: Record<string, unknown>): Patient["vitals"] {
  const v = (data.vitals as Record<string, unknown>) || data;
  return {
    spo2: num(v.spo2 || v.o2sat || v.oxygen_saturation),
    heart_rate: num(v.heart_rate || v.hr || v.pulse),
    systolic_bp: num(v.systolic_bp || v.sbp || v.systolic || parseBpSystolic(v.bp || v.blood_pressure)),
    diastolic_bp: num(v.diastolic_bp || v.dbp || v.diastolic || parseBpDiastolic(v.bp || v.blood_pressure)),
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

function toPatient(data: Record<string, unknown>): Patient {
  return {
    patient_id: str(data.patient_id || data.id || data.mrn || data.patientId || `P${Date.now()}`),
    age: num(data.age) || 0,
    age_bucket: str(data.age_bucket) || ageToBucket(num(data.age)),
    gender: normalizeGender(data.gender || data.sex),
    blood_type: str(data.blood_type || data.bloodType) || "Unknown",
    primary_diagnosis: str(data.primary_diagnosis || data.diagnosis || data.dx || data.chief_complaint) || "Unknown",
    icd9_code: str(data.icd9_code || data.icd9 || data.icd || data.code) || "",
    secondary_diagnoses: toArray(data.secondary_diagnoses || data.diagnoses || data.comorbidities),
    condition_category: str(data.condition_category || data.category) || inferCategory(data),
    insurance: str(data.insurance || data.payer) || "Unknown",
    admission_type: str(data.admission_type || data.admit_type) || "UNKNOWN",
    vitals: extractVitals(data),
    labs: extractLabs(data),
    medications: toArray(data.medications || data.meds || data.drugs),
    allergies: toArray(data.allergies),
    severity_score: num(data.severity_score || data.severity || data.acuity) || 5,
    critical_flag: toBool(data.critical_flag || data.critical || data.icu),
  };
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] !== null && source[key] !== undefined && source[key] !== "") {
      if (typeof source[key] === "object" && !Array.isArray(source[key])) {
        result[key] = deepMerge(
          (result[key] as Record<string, unknown>) || {},
          source[key] as Record<string, unknown>
        );
      } else {
        result[key] = source[key];
      }
    }
  }
  return result;
}

// =============================================================================
// Cloudflare Ingest Repository
// =============================================================================

export class CloudflareIngestRepo implements IIngestRepo {
  constructor(private readonly kv: KVNamespace) {}

  async append(data: Record<string, unknown>): Promise<IngestRecord> {
    const record: IngestRecord = {
      _ts: new Date().toISOString(),
      _type: inferType(data),
      _id: inferId(data),
      ...data,
    };

    // Get existing log
    const existing = await this.kv.get<IngestRecord[]>(INGEST_LOG_KEY, "json");
    const log = existing || [];
    log.push(record);

    // Trim if needed
    const trimmed = log.length > MAX_INGEST_LOG_ENTRIES
      ? log.slice(-MAX_INGEST_LOG_ENTRIES)
      : log;

    await this.kv.put(INGEST_LOG_KEY, JSON.stringify(trimmed));

    // Update patient index and individual patient if it's a patient record
    if (record._type === "patient") {
      const patient = toPatient(record);
      await this.kv.put(`${PATIENT_PREFIX}${patient.patient_id}`, JSON.stringify(patient));

      // Update index
      const index = (await this.kv.get<string[]>(PATIENTS_INDEX_KEY, "json")) || [];
      if (!index.includes(patient.patient_id)) {
        index.push(patient.patient_id);
        await this.kv.put(PATIENTS_INDEX_KEY, JSON.stringify(index));
      }

      // Invalidate patients cache
      await this.kv.delete(PATIENTS_CACHE_KEY);
    }

    return record;
  }

  async readLog(): Promise<IngestRecord[]> {
    return (await this.kv.get<IngestRecord[]>(INGEST_LOG_KEY, "json")) || [];
  }

  async getPatientStates(): Promise<Map<string, Record<string, unknown>>> {
    const states = new Map<string, Record<string, unknown>>();
    const log = await this.readLog();

    for (const record of log) {
      const id = record._id;
      const existing = states.get(id) || {};
      states.set(id, deepMerge(existing, record));
    }

    return states;
  }
}

// =============================================================================
// Cloudflare Evaluation Repository
// =============================================================================

export class CloudflareEvaluationRepo implements IEvaluationRepo {
  constructor(private readonly kv: KVNamespace) {}

  async append(data: Omit<EvaluationRecord, "_id" | "_ts">): Promise<EvaluationRecord> {
    const record: EvaluationRecord = {
      _id: `eval-${data.patientId}-${Date.now().toString(36)}`,
      _ts: new Date().toISOString(),
      ...data,
    };

    const existing = await this.kv.get<EvaluationRecord[]>(EVAL_LOG_KEY, "json");
    const log = existing || [];
    log.push(record);

    const trimmed = log.length > MAX_EVAL_LOG_ENTRIES
      ? log.slice(-MAX_EVAL_LOG_ENTRIES)
      : log;

    await this.kv.put(EVAL_LOG_KEY, JSON.stringify(trimmed));
    return record;
  }

  async readAll(): Promise<EvaluationRecord[]> {
    return (await this.kv.get<EvaluationRecord[]>(EVAL_LOG_KEY, "json")) || [];
  }

  async getByPatient(patientId: string): Promise<EvaluationRecord[]> {
    const all = await this.readAll();
    return all.filter((e) => e.patientId === patientId);
  }

  async getLatest(patientId: string): Promise<EvaluationRecord | null> {
    const evals = await this.getByPatient(patientId);
    if (evals.length === 0) return null;
    const sorted = evals.sort((a, b) =>
      new Date(b._ts).getTime() - new Date(a._ts).getTime()
    );
    return sorted[0] ?? null;
  }

  async getCached(patientId: string, maxAgeMs: number = 4 * 60 * 60 * 1000): Promise<EvaluationRecord | null> {
    const latest = await this.getLatest(patientId);
    if (!latest) return null;

    const age = Date.now() - new Date(latest._ts).getTime();
    if (age > maxAgeMs) return null;

    return latest;
  }

  async getStats(): Promise<EvaluationStats> {
    const evals = await this.readAll();
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
}

// =============================================================================
// Cloudflare Patient Repository
// =============================================================================

// In-memory cache within isolate lifetime
let patientsCache: { data: Patient[]; ts: number } | null = null;
let statsCache: { data: DatasetStats; ts: number } | null = null;
const CACHE_TTL_MS = 30_000;

export class CloudflarePatientRepo implements IPatientRepo {
  constructor(private readonly kv: KVNamespace) {}

  invalidateCache(): void {
    patientsCache = null;
    statsCache = null;
    // Also invalidate KV cache (fire and forget)
    this.kv.delete(PATIENTS_CACHE_KEY).catch(() => {});
  }

  async loadAll(): Promise<Patient[]> {
    // Check in-memory cache first
    if (patientsCache && Date.now() - patientsCache.ts < CACHE_TTL_MS) {
      return patientsCache.data;
    }

    // Try denormalized cache in KV
    const cached = await this.kv.get<Patient[]>(PATIENTS_CACHE_KEY, "json");
    if (cached) {
      patientsCache = { data: cached, ts: Date.now() };
      return cached;
    }

    // Fallback: parallel reads from individual keys
    const index = (await this.kv.get<string[]>(PATIENTS_INDEX_KEY, "json")) || [];
    if (index.length === 0) return [];

    const results = await Promise.all(
      index.map((id) => this.kv.get<Patient>(`${PATIENT_PREFIX}${id}`, "json"))
    );
    const patients = results.filter((p): p is Patient => p !== null);

    // Update caches
    patientsCache = { data: patients, ts: Date.now() };
    // Store denormalized cache (fire and forget)
    this.kv.put(PATIENTS_CACHE_KEY, JSON.stringify(patients)).catch(() => {});

    return patients;
  }

  async getById(patientId: string): Promise<Patient | null> {
    return await this.kv.get<Patient>(`${PATIENT_PREFIX}${patientId}`, "json");
  }

  async filter(criteria: PatientFilterCriteria): Promise<Patient[]> {
    const patients = await this.loadAll();
    return patients.filter((p) => {
      if (criteria.category && p.condition_category !== criteria.category) return false;
      if (criteria.critical !== undefined && p.critical_flag !== criteria.critical) return false;
      if (criteria.minSeverity !== undefined && p.severity_score < criteria.minSeverity) return false;
      if (criteria.maxSeverity !== undefined && p.severity_score > criteria.maxSeverity) return false;
      return true;
    });
  }

  async getStats(): Promise<DatasetStats> {
    // Check cache
    if (statsCache && Date.now() - statsCache.ts < CACHE_TTL_MS) {
      return statsCache.data;
    }

    const patients = await this.loadAll();

    const byCategory: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    let critical = 0;

    for (const p of patients) {
      byCategory[p.condition_category] = (byCategory[p.condition_category] || 0) + 1;
      const sevKey = p.severity_score <= 3 ? "low" : p.severity_score <= 6 ? "medium" : "high";
      bySeverity[sevKey] = (bySeverity[sevKey] || 0) + 1;
      if (p.critical_flag) critical++;
    }

    const stats = { total: patients.length, byCategory, bySeverity, critical };
    statsCache = { data: stats, ts: Date.now() };
    return stats;
  }
}

// =============================================================================
// Cloudflare Cooldown Repository (KV with TTL)
// =============================================================================

export class CloudflareCooldownRepo implements ICooldownRepo {
  constructor(private readonly kv: KVNamespace) {}

  async check(key: string, cooldownMs: number): Promise<CooldownResult> {
    const kvKey = `${COOLDOWN_PREFIX}${key}`;
    const record = await this.kv.get<{ timestamp: number }>(kvKey, "json");

    if (!record) {
      return { allowed: true, remainingMs: 0 };
    }

    const now = Date.now();
    const elapsed = now - record.timestamp;

    if (elapsed >= cooldownMs) {
      return { allowed: true, remainingMs: 0 };
    }

    return { allowed: false, remainingMs: cooldownMs - elapsed };
  }

  async record(key: string, cooldownMs: number): Promise<void> {
    const kvKey = `${COOLDOWN_PREFIX}${key}`;
    const ttlSeconds = Math.ceil(cooldownMs / 1000);

    await this.kv.put(
      kvKey,
      JSON.stringify({ timestamp: Date.now() }),
      { expirationTtl: ttlSeconds }
    );
  }

  // Not needed for KV (TTL handles cleanup)
  cleanup(_maxEntries: number): void {}
}

// =============================================================================
// Cloudflare Credentials Repository (KV-backed)
// =============================================================================

const CREDENTIALS_KEY = "credentials:all";

export class CloudflareCredentialsRepo implements ICredentialsRepo {
  private memCache: Map<string, CaseCredential> | null = null;

  constructor(private readonly kv: KVNamespace) {}

  private async ensureLoaded(): Promise<Map<string, CaseCredential>> {
    if (this.memCache) return this.memCache;

    const stored = await this.kv.get<Record<string, CaseCredential>>(CREDENTIALS_KEY, "json");
    this.memCache = new Map(Object.entries(stored || {}));
    return this.memCache;
  }

  async get(username: string): Promise<CaseCredential | null> {
    const creds = await this.ensureLoaded();
    return creds.get(username) || null;
  }

  async set(username: string, credential: CaseCredential): Promise<void> {
    const creds = await this.ensureLoaded();
    creds.set(username, credential);

    // Persist to KV
    const obj: Record<string, CaseCredential> = {};
    creds.forEach((v, k) => { obj[k] = v; });
    await this.kv.put(CREDENTIALS_KEY, JSON.stringify(obj));
  }

  async loadAll(): Promise<Map<string, CaseCredential>> {
    return await this.ensureLoaded();
  }

  async has(username: string): Promise<boolean> {
    const creds = await this.ensureLoaded();
    return creds.has(username);
  }
}

// =============================================================================
// Cloudflare Audit Log Repository (KV-backed)
// =============================================================================

export class CloudflareAuditLogRepo implements IAuditLogRepo {
  constructor(private readonly kv: KVNamespace) {}

  async log(entry: AuditLogEntry): Promise<void> {
    try {
      const existing = await this.kv.get<AuditLogEntry[]>(AUDIT_LOG_KEY, "json");
      const log = existing || [];
      log.push(entry);

      const trimmed = log.length > MAX_AUDIT_ENTRIES
        ? log.slice(-MAX_AUDIT_ENTRIES)
        : log;

      await this.kv.put(AUDIT_LOG_KEY, JSON.stringify(trimmed));
    } catch {
      // Don't fail the request if audit logging fails
      console.error("[AUDIT ERROR]", entry);
    }
  }

  async getEntries(options?: { limit?: number; action?: AuditLogEntry["action"] }): Promise<AuditLogEntry[]> {
    const log = await this.kv.get<AuditLogEntry[]>(AUDIT_LOG_KEY, "json");
    let filtered = log || [];

    if (options?.action) {
      filtered = filtered.filter((e) => e.action === options.action);
    }

    if (options?.limit) {
      filtered = filtered.slice(-options.limit);
    }

    return filtered;
  }

  async count(): Promise<number> {
    const log = await this.kv.get<AuditLogEntry[]>(AUDIT_LOG_KEY, "json");
    return (log || []).length;
  }
}

// =============================================================================
// Cloudflare Request Log Repository (KV-backed)
// =============================================================================

export class CloudflareRequestLogRepo implements IRequestLogRepo {
  constructor(private readonly kv: KVNamespace) {}

  async log(entry: RequestLog): Promise<void> {
    try {
      const existing = await this.kv.get<RequestLog[]>(REQUEST_LOG_KEY, "json");
      const logs = existing || [];
      logs.push(entry);

      const trimmed = logs.length > MAX_REQUEST_LOG_ENTRIES
        ? logs.slice(-MAX_REQUEST_LOG_ENTRIES)
        : logs;

      await this.kv.put(REQUEST_LOG_KEY, JSON.stringify(trimmed));
    } catch {
      // Don't fail request if logging fails
      console.error("[REQUEST LOG ERROR]", entry);
    }
  }

  async getEntries(options?: RequestLogFilter): Promise<RequestLog[]> {
    const all = await this.kv.get<RequestLog[]>(REQUEST_LOG_KEY, "json");
    let logs = all || [];

    if (options?.path) {
      logs = logs.filter((l) => l.path.includes(options.path!));
    }
    if (options?.method) {
      logs = logs.filter((l) => l.method === options.method!.toUpperCase());
    }
    if (options?.minStatus) {
      logs = logs.filter((l) => l.status >= options.minStatus!);
    }

    logs.reverse();

    if (options?.limit) {
      logs = logs.slice(0, options.limit);
    }

    return logs;
  }

  async getStats(): Promise<{
    total: number;
    lastHour: number;
    last24h: number;
    avgDurationMs: number;
    byStatus: Record<string, number>;
    byMethod: Record<string, number>;
    topPaths: Array<{ path: string; count: number }>;
  }> {
    const all = await this.kv.get<RequestLog[]>(REQUEST_LOG_KEY, "json");
    const logs = all || [];

    const now = Date.now();
    const hour = 60 * 60 * 1000;
    const day = 24 * hour;

    const lastHour = logs.filter((l) => now - new Date(l.timestamp).getTime() < hour);
    const last24h = logs.filter((l) => now - new Date(l.timestamp).getTime() < day);

    const byStatus: Record<string, number> = {};
    const byMethod: Record<string, number> = {};
    const byPath: Record<string, number> = {};
    let totalDuration = 0;

    for (const log of logs) {
      const statusGroup = `${Math.floor(log.status / 100)}xx`;
      byStatus[statusGroup] = (byStatus[statusGroup] || 0) + 1;
      byMethod[log.method] = (byMethod[log.method] || 0) + 1;
      byPath[log.path] = (byPath[log.path] || 0) + 1;
      totalDuration += log.durationMs;
    }

    const topPaths = Object.entries(byPath)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([path, count]) => ({ path, count }));

    return {
      total: logs.length,
      lastHour: lastHour.length,
      last24h: last24h.length,
      avgDurationMs: logs.length > 0 ? Math.round(totalDuration / logs.length) : 0,
      byStatus,
      byMethod,
      topPaths,
    };
  }
}

// =============================================================================
// Cloudflare Repository Context Factory
// =============================================================================

export function createCloudflareRepoContext(config: CloudflareRepoConfig): IRepoContext {
  const kv = config.kv;

  return {
    ingest: new CloudflareIngestRepo(kv),
    evaluations: new CloudflareEvaluationRepo(kv),
    patients: new CloudflarePatientRepo(kv),
    cooldown: new CloudflareCooldownRepo(kv),
    credentials: new CloudflareCredentialsRepo(kv),
    auditLog: new CloudflareAuditLogRepo(kv),
    requestLog: new CloudflareRequestLogRepo(kv),
  };
}
