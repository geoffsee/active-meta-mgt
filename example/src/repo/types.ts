/**
 * Repository interface definitions for portable persistence.
 *
 * These interfaces abstract storage operations to work with both
 * Bun (file-based) and Cloudflare Workers (KV-based) runtimes.
 */

import type { Patient } from "../data/loaders/patients";

// =============================================================================
// Core Types
// =============================================================================

export interface IngestRecord {
  _ts: string;
  _type: "patient" | "vitals" | "labs" | "meds" | "note" | "unknown";
  _id: string;
  [key: string]: unknown;
}

export interface EvaluationRecord {
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
  specialists?: Array<{
    id: string;
    name: string;
    icon: string;
    color: string;
    status: string;
    workingMemory: string;
    response?: string | null;
    error?: string;
  }>;
  structured: {
    runs: unknown[];
    findings: unknown[];
    conflicts: unknown[];
    followUps: unknown[];
  };
  timestamp: string;
}

export interface AuditLogEntry {
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

export interface RequestLog {
  timestamp: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  ip: string;
  userAgent: string;
}

export interface CaseCredential {
  password: string;
  patientId: string;
}

export interface CooldownResult {
  allowed: boolean;
  remainingMs: number;
}

export interface DatasetStats {
  total: number;
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
  critical: number;
}

export interface EvaluationStats {
  total: number;
  byPatient: Record<string, number>;
  recent24h: number;
}

export interface PatientFilterCriteria {
  category?: string;
  critical?: boolean;
  minSeverity?: number;
  maxSeverity?: number;
}

export interface RequestLogFilter {
  limit?: number;
  path?: string;
  method?: string;
  minStatus?: number;
}

// =============================================================================
// Repository Interfaces
// =============================================================================

/**
 * Ingest log storage - append-only log of all ingested data.
 */
export interface IIngestRepo {
  /** Append a raw record to the ingest log */
  append(data: Record<string, unknown>): Promise<IngestRecord>;

  /** Read all records from the log */
  readLog(): Promise<IngestRecord[]>;

  /** Get folded patient states (latest state per patient ID) */
  getPatientStates(): Promise<Map<string, Record<string, unknown>>>;
}

/**
 * Evaluation results storage - audit trail of CDS evaluations.
 */
export interface IEvaluationRepo {
  /** Append an evaluation result */
  append(data: Omit<EvaluationRecord, "_id" | "_ts">): Promise<EvaluationRecord>;

  /** Read all evaluation records */
  readAll(): Promise<EvaluationRecord[]>;

  /** Get evaluations for a specific patient */
  getByPatient(patientId: string): Promise<EvaluationRecord[]>;

  /** Get the most recent evaluation for a patient */
  getLatest(patientId: string): Promise<EvaluationRecord | null>;

  /** Check for cached evaluation within time window */
  getCached(patientId: string, maxAgeMs?: number): Promise<EvaluationRecord | null>;

  /** Get evaluation statistics */
  getStats(): Promise<EvaluationStats>;
}

/**
 * Patient data access - derived from ingest log.
 */
export interface IPatientRepo {
  /** Load all patients */
  loadAll(): Promise<Patient[]>;

  /** Get a patient by ID */
  getById(patientId: string): Promise<Patient | null>;

  /** Filter patients by criteria */
  filter(criteria: PatientFilterCriteria): Promise<Patient[]>;

  /** Get dataset statistics */
  getStats(): Promise<DatasetStats>;

  /** Invalidate any caches (called after ingest) */
  invalidateCache(): void;
}

/**
 * Rate limiting via cooldown tracking.
 */
export interface ICooldownRepo {
  /** Check if an action is allowed for the given key */
  check(key: string, cooldownMs: number): Promise<CooldownResult>;

  /** Record that an action was performed */
  record(key: string, cooldownMs: number): Promise<void>;

  /** Clean up expired entries (for in-memory implementations) */
  cleanup?(maxEntries: number): void;
}

/**
 * Case credentials for wearable device authentication.
 */
export interface ICredentialsRepo {
  /** Get credential by username */
  get(username: string): Promise<CaseCredential | null>;

  /** Register a new credential */
  set(username: string, credential: CaseCredential): Promise<void>;

  /** Load all credentials (for initialization) */
  loadAll(): Promise<Map<string, CaseCredential>>;

  /** Check if credentials exist for a username */
  has(username: string): Promise<boolean>;

  /** Check if a patient has assigned credentials */
  hasCredentialsForPatient(patientId: string): Promise<boolean>;
}

/**
 * HIPAA-compliant audit logging.
 */
export interface IAuditLogRepo {
  /** Log an audit entry */
  log(entry: AuditLogEntry): Promise<void>;

  /** Get audit log entries */
  getEntries(options?: { limit?: number; action?: AuditLogEntry["action"] }): Promise<AuditLogEntry[]>;

  /** Get total count of entries */
  count(): Promise<number>;
}

/**
 * Request logging for performance monitoring.
 */
export interface IRequestLogRepo {
  /** Log a request */
  log(entry: RequestLog): Promise<void>;

  /** Get request logs with optional filtering */
  getEntries(options?: RequestLogFilter): Promise<RequestLog[]>;

  /** Get request statistics */
  getStats(): Promise<{
    total: number;
    lastHour: number;
    last24h: number;
    avgDurationMs: number;
    byStatus: Record<string, number>;
    byMethod: Record<string, number>;
    topPaths: Array<{ path: string; count: number }>;
  }>;
}

/**
 * Unified repository container - provides access to all stores.
 */
export interface IRepoContext {
  ingest: IIngestRepo;
  evaluations: IEvaluationRepo;
  patients: IPatientRepo;
  cooldown: ICooldownRepo;
  credentials: ICredentialsRepo;
  auditLog: IAuditLogRepo;
  requestLog: IRequestLogRepo;
}

// =============================================================================
// Factory Types
// =============================================================================

export type RepoRuntime = "bun" | "cloudflare";

export interface BunRepoConfig {
  runtime: "bun";
  dataDir?: string; // defaults to example/data
}

export interface CloudflareRepoConfig {
  runtime: "cloudflare";
  kv: KVNamespace;
}

export type RepoConfig = BunRepoConfig | CloudflareRepoConfig;
