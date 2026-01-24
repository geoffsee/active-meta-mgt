/**
 * Patient data loader.
 *
 * Source: data/ingest.jsonl (same format users POST to /api/ingest)
 */

import { getIngestedPatients } from "../ingest";

export interface Patient {
  patient_id: string;
  age: number;
  age_bucket: string;
  gender: "M" | "F" | "U";
  blood_type: string;
  primary_diagnosis: string;
  icd9_code: string;
  secondary_diagnoses: string[];
  condition_category: string;
  insurance: string;
  admission_type: string;
  vitals: {
    spo2: number | null;
    heart_rate: number | null;
    systolic_bp: number | null;
    diastolic_bp: number | null;
    oxygen_flow: number | null;
    temperature: number | null;
    respiratory_rate: number | null;
    respiratory_status: string;
  };
  labs: {
    hemoglobin: number | null;
    wbc: number | null;
    rbc: number | null;
    platelets: number | null;
    hematocrit: number | null;
    mcv: number | null;
    mch: number | null;
    mchc: number | null;
    rdw: number | null;
    neutrophils: number | null;
    lymphocytes: number | null;
    monocytes: number | null;
    eosinophils: number | null;
    basophils: number | null;
    creatinine: number | null;
    bun: number | null;
    glucose: number | null;
    sodium: number | null;
    potassium: number | null;
    lactate: number | null;
  };
  medications: string[];
  allergies: string[];
  severity_score: number;
  critical_flag: boolean;
}

let patientsCache: Patient[] | null = null;
let lastCheck = 0;

/**
 * Load all patients from ingest.jsonl.
 */
export function loadPatients(): Patient[] {
  const now = Date.now();
  if (patientsCache && now - lastCheck < 5000) {
    return patientsCache;
  }
  lastCheck = now;

  patientsCache = getIngestedPatients();
  return patientsCache;
}

/**
 * Get a patient by ID.
 */
export function getPatient(patientId: string): Patient | null {
  return loadPatients().find((p) => p.patient_id === patientId) || null;
}

/**
 * List all patient IDs.
 */
export function listPatientIds(): string[] {
  return loadPatients().map((p) => p.patient_id);
}

/**
 * Get patients filtered by criteria.
 */
export function filterPatients(criteria: {
  category?: string;
  critical?: boolean;
  minSeverity?: number;
  maxSeverity?: number;
}): Patient[] {
  let patients = loadPatients();

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

/**
 * Get summary statistics about the patient dataset.
 */
export function getDatasetStats(): {
  total: number;
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
  critical: number;
} {
  const patients = loadPatients();

  const byCategory: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  let critical = 0;

  for (const p of patients) {
    byCategory[p.condition_category] = (byCategory[p.condition_category] || 0) + 1;
    const sevKey = p.severity_score <= 3 ? "low" : p.severity_score <= 6 ? "medium" : "high";
    bySeverity[sevKey] = (bySeverity[sevKey] || 0) + 1;
    if (p.critical_flag) critical++;
  }

  return {
    total: patients.length,
    byCategory,
    bySeverity,
    critical,
  };
}
