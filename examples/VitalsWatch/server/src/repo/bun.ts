/**
 * Bun/Node.js repository implementation using file-based storage.
 *
 * Uses append-only JSONL files for ingest and evaluation logs,
 * and in-memory Maps for caches, cooldowns, and credentials.
 */

import { appendFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
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
  BunRepoConfig,
} from "./types";

// =============================================================================
// Helper Functions
// =============================================================================

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, "utf-8");
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function appendJsonl<T>(path: string, record: T): void {
  ensureDir(path);
  appendFileSync(path, JSON.stringify(record) + "\n");
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
// Bun Ingest Repository
// =============================================================================

export class BunIngestRepo implements IIngestRepo {
  private readonly logPath: string;

  constructor(dataDir: string) {
    this.logPath = resolve(dataDir, "ingest.jsonl");
  }

  async append(data: Record<string, unknown>): Promise<IngestRecord> {
    const record: IngestRecord = {
      _ts: new Date().toISOString(),
      _type: inferType(data),
      _id: inferId(data),
      ...data,
    };
    appendJsonl(this.logPath, record);
    return record;
  }

  async readLog(): Promise<IngestRecord[]> {
    return readJsonl<IngestRecord>(this.logPath);
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
// Bun Evaluation Repository
// =============================================================================

export class BunEvaluationRepo implements IEvaluationRepo {
  private readonly logPath: string;

  constructor(dataDir: string) {
    this.logPath = resolve(dataDir, "evaluations.jsonl");
  }

  async append(data: Omit<EvaluationRecord, "_id" | "_ts">): Promise<EvaluationRecord> {
    const record: EvaluationRecord = {
      _id: `eval-${data.patientId}-${Date.now().toString(36)}`,
      _ts: new Date().toISOString(),
      ...data,
    };
    appendJsonl(this.logPath, record);
    return record;
  }

  async readAll(): Promise<EvaluationRecord[]> {
    return readJsonl<EvaluationRecord>(this.logPath);
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
// Bun Patient Repository
// =============================================================================

export class BunPatientRepo implements IPatientRepo {
  private readonly ingestRepo: IIngestRepo;
  private cache: Patient[] | null = null;
  private cacheTs = 0;
  private readonly cacheTtlMs = 5000;

  constructor(ingestRepo: IIngestRepo) {
    this.ingestRepo = ingestRepo;
  }

  invalidateCache(): void {
    this.cache = null;
    this.cacheTs = 0;
  }

  async loadAll(): Promise<Patient[]> {
    const now = Date.now();
    if (this.cache && now - this.cacheTs < this.cacheTtlMs) {
      return this.cache;
    }

    const states = await this.ingestRepo.getPatientStates();
    const patients = Array.from(states.values())
      .filter((s) => s._type === "patient")
      .map(toPatient);

    this.cache = patients;
    this.cacheTs = now;
    return patients;
  }

  async getById(patientId: string): Promise<Patient | null> {
    const patients = await this.loadAll();
    return patients.find((p) => p.patient_id === patientId) || null;
  }

  async filter(criteria: PatientFilterCriteria): Promise<Patient[]> {
    let patients = await this.loadAll();

    if (criteria.category) {
      patients = patients.filter((p) => p.condition_category === criteria.category);
    }
    if (criteria.critical !== undefined) {
      patients = patients.filter((p) => p.critical_flag === criteria.critical);
    }
    if (criteria.minSeverity !== undefined) {
      patients = patients.filter((p) => p.severity_score >= criteria.minSeverity!);
    }
    if (criteria.maxSeverity !== undefined) {
      patients = patients.filter((p) => p.severity_score <= criteria.maxSeverity!);
    }

    return patients;
  }

  async getStats(): Promise<DatasetStats> {
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

    return { total: patients.length, byCategory, bySeverity, critical };
  }
}

// =============================================================================
// Bun Cooldown Repository (In-Memory)
// =============================================================================

export class BunCooldownRepo implements ICooldownRepo {
  private readonly timestamps = new Map<string, number>();

  async check(key: string, cooldownMs: number): Promise<CooldownResult> {
    const now = Date.now();
    const lastAction = this.timestamps.get(key);

    if (!lastAction) {
      return { allowed: true, remainingMs: 0 };
    }

    const elapsed = now - lastAction;
    if (elapsed >= cooldownMs) {
      return { allowed: true, remainingMs: 0 };
    }

    return { allowed: false, remainingMs: cooldownMs - elapsed };
  }

  async record(key: string, _cooldownMs: number): Promise<void> {
    this.timestamps.set(key, Date.now());
  }

  cleanup(maxEntries: number): void {
    if (this.timestamps.size <= maxEntries) return;

    const entries = [...this.timestamps.entries()];
    entries.sort((a, b) => a[1] - b[1]);
    const toRemove = entries.slice(0, entries.length - maxEntries);
    toRemove.forEach(([id]) => this.timestamps.delete(id));
  }
}

// =============================================================================
// Bun Credentials Repository (In-Memory, loaded from ingest log)
// =============================================================================

export class BunCredentialsRepo implements ICredentialsRepo {
  private readonly credentials = new Map<string, CaseCredential>();
  private readonly ingestRepo: IIngestRepo;
  private loaded = false;

  constructor(ingestRepo: IIngestRepo) {
    this.ingestRepo = ingestRepo;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    const log = await this.ingestRepo.readLog();
    for (const record of log) {
      const username = record.username as string | undefined;
      const password = record.password as string | undefined;
      const patientId = record.patient_id as string | undefined;
      if (username && password && patientId) {
        this.credentials.set(username, { password, patientId });
      }
    }
    this.loaded = true;
  }

  async get(username: string): Promise<CaseCredential | null> {
    await this.ensureLoaded();
    return this.credentials.get(username) || null;
  }

  async set(username: string, credential: CaseCredential): Promise<void> {
    await this.ensureLoaded();
    this.credentials.set(username, credential);
  }

  async loadAll(): Promise<Map<string, CaseCredential>> {
    await this.ensureLoaded();
    return new Map(this.credentials);
  }

  async has(username: string): Promise<boolean> {
    await this.ensureLoaded();
    return this.credentials.has(username);
  }

  async hasCredentialsForPatient(patientId: string): Promise<boolean> {
    await this.ensureLoaded();
    for (const cred of this.credentials.values()) {
      if (cred.patientId === patientId) return true;
    }
    return false;
  }
}

// =============================================================================
// Bun Audit Log Repository (In-Memory)
// =============================================================================

export class BunAuditLogRepo implements IAuditLogRepo {
  private readonly entries: AuditLogEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 10000) {
    this.maxEntries = maxEntries;
  }

  async log(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
    // Also log to console for external aggregation
    console.log(`[AUDIT] ${JSON.stringify(entry)}`);
  }

  async getEntries(options?: { limit?: number; action?: AuditLogEntry["action"] }): Promise<AuditLogEntry[]> {
    let filtered = [...this.entries];

    if (options?.action) {
      filtered = filtered.filter((e) => e.action === options.action);
    }

    if (options?.limit) {
      filtered = filtered.slice(-options.limit);
    }

    return filtered;
  }

  async count(): Promise<number> {
    return this.entries.length;
  }
}

// =============================================================================
// Bun Request Log Repository (In-Memory)
// =============================================================================

export class BunRequestLogRepo implements IRequestLogRepo {
  private readonly logs: RequestLog[] = [];
  private readonly maxLogs: number;

  constructor(maxLogs = 10000) {
    this.maxLogs = maxLogs;
  }

  async log(entry: RequestLog): Promise<void> {
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.splice(0, this.logs.length - this.maxLogs);
    }
  }

  async getEntries(options?: RequestLogFilter): Promise<RequestLog[]> {
    let logs = [...this.logs];

    if (options?.path) {
      logs = logs.filter((l) => l.path.includes(options.path!));
    }
    if (options?.method) {
      logs = logs.filter((l) => l.method === options.method!.toUpperCase());
    }
    if (options?.minStatus) {
      logs = logs.filter((l) => l.status >= options.minStatus!);
    }

    // Return most recent first
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
    const now = Date.now();
    const hour = 60 * 60 * 1000;
    const day = 24 * hour;

    const lastHour = this.logs.filter((l) => now - new Date(l.timestamp).getTime() < hour);
    const last24h = this.logs.filter((l) => now - new Date(l.timestamp).getTime() < day);

    const byStatus: Record<string, number> = {};
    const byMethod: Record<string, number> = {};
    const byPath: Record<string, number> = {};
    let totalDuration = 0;

    for (const log of this.logs) {
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
      total: this.logs.length,
      lastHour: lastHour.length,
      last24h: last24h.length,
      avgDurationMs: this.logs.length > 0 ? Math.round(totalDuration / this.logs.length) : 0,
      byStatus,
      byMethod,
      topPaths,
    };
  }
}

// =============================================================================
// Bun Repository Context Factory
// =============================================================================

export function createBunRepoContext(config: BunRepoConfig): IRepoContext {
  const dataDir = config.dataDir || resolve(process.cwd(), "data");

  const ingest = new BunIngestRepo(dataDir);
  const evaluations = new BunEvaluationRepo(dataDir);
  const patients = new BunPatientRepo(ingest);
  const cooldown = new BunCooldownRepo();
  const credentials = new BunCredentialsRepo(ingest);
  const auditLog = new BunAuditLogRepo();
  const requestLog = new BunRequestLogRepo();

  return {
    ingest,
    evaluations,
    patients,
    cooldown,
    credentials,
    auditLog,
    requestLog,
  };
}
