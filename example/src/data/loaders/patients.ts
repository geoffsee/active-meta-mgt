/**
 * Patient data loader.
 *
 * Loads unified patient records from data/patients.csv.
 */

import { readFileSync } from "fs";
import { parse } from "csv-parse/sync";

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

function parseFloat2(val: string): number | null {
  if (!val || val === "") return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function parseBool(val: string): boolean {
  return val === "true" || val === "1" || val === "True";
}

function parseArray(val: string): string[] {
  if (!val || val === "") return [];
  return val.split("|").filter(Boolean);
}

let patientsCache: Patient[] | null = null;

/**
 * Load all patients from the unified CSV.
 */
export function loadPatients(): Patient[] {
  if (patientsCache) return patientsCache;

  const csvPath = new URL("../../../data/patients.csv", import.meta.url).pathname;
  const csvContent = readFileSync(csvPath, "utf-8");

  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
  }) as Record<string, string>[];

  patientsCache = records.map((r): Patient => ({
    patient_id: r.patient_id,
    age: parseInt(r.age) || 0,
    age_bucket: r.age_bucket,
    gender: (r.gender as "M" | "F" | "U") || "U",
    blood_type: r.blood_type || "Unknown",
    primary_diagnosis: r.primary_diagnosis,
    icd9_code: r.icd9_code,
    secondary_diagnoses: parseArray(r.secondary_diagnoses),
    condition_category: r.condition_category,
    insurance: r.insurance,
    admission_type: r.admission_type,
    vitals: {
      spo2: parseFloat2(r.spo2),
      heart_rate: parseFloat2(r.heart_rate),
      systolic_bp: parseFloat2(r.systolic_bp),
      diastolic_bp: parseFloat2(r.diastolic_bp),
      oxygen_flow: parseFloat2(r.oxygen_flow),
      temperature: parseFloat2(r.temperature),
      respiratory_rate: parseFloat2(r.respiratory_rate),
      respiratory_status: r.respiratory_status || "unknown",
    },
    labs: {
      hemoglobin: parseFloat2(r.hemoglobin),
      wbc: parseFloat2(r.wbc),
      rbc: parseFloat2(r.rbc),
      platelets: parseFloat2(r.platelets),
      hematocrit: parseFloat2(r.hematocrit),
      mcv: parseFloat2(r.mcv),
      mch: parseFloat2(r.mch),
      mchc: parseFloat2(r.mchc),
      rdw: parseFloat2(r.rdw),
      neutrophils: parseFloat2(r.neutrophils),
      lymphocytes: parseFloat2(r.lymphocytes),
      monocytes: parseFloat2(r.monocytes),
      eosinophils: parseFloat2(r.eosinophils),
      basophils: parseFloat2(r.basophils),
      creatinine: parseFloat2(r.creatinine),
      bun: parseFloat2(r.bun),
      glucose: parseFloat2(r.glucose),
      sodium: parseFloat2(r.sodium),
      potassium: parseFloat2(r.potassium),
      lactate: parseFloat2(r.lactate),
    },
    medications: parseArray(r.medications),
    allergies: parseArray(r.allergies),
    severity_score: parseInt(r.severity_score) || 5,
    critical_flag: parseBool(r.critical_flag),
  }));

  return patientsCache;
}

/**
 * Get a patient by ID.
 */
export function getPatient(patientId: string): Patient | null {
  const patients = loadPatients();
  return patients.find((p) => p.patient_id === patientId) || null;
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
