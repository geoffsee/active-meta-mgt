/**
 * Evaluation results persistence with append-only log storage.
 *
 * Stores CDS evaluation results for audit trail and retrieval.
 */

import { appendFileSync, readFileSync, existsSync } from "fs";

const LOG_PATH = new URL("../../data/evaluations.jsonl", import.meta.url).pathname;

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
  specialists: Array<{
    id: string;
    name: string;
    icon: string;
    color: string;
    status: string;
    workingMemory: string;
    response?: string;
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

/**
 * Append an evaluation result to the log.
 */
export function appendEvaluation(data: Omit<EvaluationRecord, "_id" | "_ts">): EvaluationRecord {
  const record: EvaluationRecord = {
    _id: `eval-${data.patientId}-${Date.now().toString(36)}`,
    _ts: new Date().toISOString(),
    ...data,
  };

  appendFileSync(LOG_PATH, JSON.stringify(record) + "\n");
  return record;
}

/**
 * Read all evaluation records from the log.
 */
export function readEvaluations(): EvaluationRecord[] {
  if (!existsSync(LOG_PATH)) return [];

  const content = readFileSync(LOG_PATH, "utf-8");
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EvaluationRecord);
}

/**
 * Get evaluations for a specific patient.
 */
export function getPatientEvaluations(patientId: string): EvaluationRecord[] {
  return readEvaluations().filter((e) => e.patientId === patientId);
}

/**
 * Get the most recent evaluation for a patient.
 */
export function getLatestEvaluation(patientId: string): EvaluationRecord | null {
  const evals = getPatientEvaluations(patientId);
  if (evals.length === 0) return null;

  // Sort by timestamp descending, return most recent
  const latest = evals.sort((a, b) =>
    new Date(b._ts).getTime() - new Date(a._ts).getTime()
  )[0];
  return latest ?? null;
}

/**
 * Check if a cached evaluation exists within the given time window.
 */
export function getCachedEvaluation(
  patientId: string,
  maxAgeMs: number = 4 * 60 * 60 * 1000 // 4 hours default
): EvaluationRecord | null {
  const latest = getLatestEvaluation(patientId);
  if (!latest) return null;

  const age = Date.now() - new Date(latest._ts).getTime();
  if (age > maxAgeMs) return null;

  return latest;
}

/**
 * Get evaluation statistics.
 */
export function getEvaluationStats(): {
  total: number;
  byPatient: Record<string, number>;
  recent24h: number;
} {
  const evals = readEvaluations();
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

  return {
    total: evals.length,
    byPatient,
    recent24h,
  };
}
