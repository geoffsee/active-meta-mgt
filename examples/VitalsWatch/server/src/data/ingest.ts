/**
 * Flexible data ingestion with append-only log storage.
 *
 * Accept any patient data shape, normalize on read.
 * Users pipe in whatever they have - we figure it out.
 */

import { appendFileSync, readFileSync, existsSync } from "fs";
import type { Patient } from "./loaders/patients";

const LOG_PATH = new URL("../../data/ingest.jsonl", import.meta.url).pathname;

export interface IngestRecord {
  _ts: string;
  _type: "patient" | "vitals" | "labs" | "meds" | "note" | "unknown";
  _id: string;
  [key: string]: unknown;
}

/**
 * Append a record to the ingest log.
 */
export function append(data: Record<string, unknown>): IngestRecord {
  const record: IngestRecord = {
    _ts: new Date().toISOString(),
    _type: inferType(data),
    _id: inferId(data),
    ...data,
  };

  appendFileSync(LOG_PATH, JSON.stringify(record) + "\n");
  return record;
}

/**
 * Read all records from the log.
 */
export function readLog(): IngestRecord[] {
  if (!existsSync(LOG_PATH)) return [];

  const content = readFileSync(LOG_PATH, "utf-8");
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as IngestRecord);
}

/**
 * Get latest state per patient ID (fold the log).
 */
export function getPatientStates(): Map<string, Record<string, unknown>> {
  const states = new Map<string, Record<string, unknown>>();

  for (const record of readLog()) {
    const id = record._id;
    const existing = states.get(id) || {};

    // Merge: later records override earlier ones
    states.set(id, deepMerge(existing, record));
  }

  return states;
}

/**
 * Convert ingested data to Patient format (best effort).
 */
export function toPatient(data: Record<string, unknown>): Patient {
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

/**
 * Get all patients from the ingest log as Patient objects.
 */
export function getIngestedPatients(): Patient[] {
  const states = getPatientStates();
  return Array.from(states.values())
    .filter((s) => s._type === "patient")
    .map(toPatient);
}

// --- Helpers ---

function inferType(data: Record<string, unknown>): IngestRecord["_type"] {
  // Check for patient first - if it has identifying info + clinical data, it's a patient
  const hasId = data.patient_id || data.id || data.mrn || data.patientId || data.subject_id;
  const hasClinical = data.diagnosis || data.primary_diagnosis || data.dx || data.chief_complaint || data.age;
  if (hasId && hasClinical) return "patient";

  // Then check for specific record types
  if (data.note || data.text || data.narrative) return "note";
  if (data.medications || data.meds) return "meds";

  // Vitals/labs only if it's clearly just that data
  const onlyVitals = (data.vitals || data.spo2 || data.heart_rate || data.bp) && !hasClinical;
  if (onlyVitals) return "vitals";

  const onlyLabs = (data.labs || data.hemoglobin || data.wbc || data.creatinine) && !hasClinical;
  if (onlyLabs) return "labs";

  // Default to patient if has any identifier
  if (hasId) return "patient";

  return "unknown";
}

function inferId(data: Record<string, unknown>): string {
  return str(
    data.patient_id || data.id || data.mrn || data.patientId ||
    data.subject_id || data.encounter_id || `auto-${Date.now()}`
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
