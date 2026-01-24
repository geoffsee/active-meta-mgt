/**
 * Prepare unified patient dataset from multiple Kaggle sources.
 *
 * Matching signature: (age_bucket, gender, condition_category)
 * - Age buckets: 18-30, 31-45, 46-60, 61-75, 76+
 * - Gender: normalized to M/F
 * - Condition category: respiratory, cardiac, metabolic, infectious, oncology, etc.
 *
 * Sources:
 * - MIMIC-III: Core patient records with diagnoses, labs, prescriptions
 * - Oxygen Dataset: Vitals (SpO2, HR, oxygen flow)
 * - Healthcare Dataset: Patient demographics, conditions, medications
 * - CBC Dataset: Complete blood count with diagnoses
 *
 * Output: data/patients.csv
 */

import { readFileSync, writeFileSync } from "fs";
import { parse } from "csv-parse/sync";

// ============================================================================
// Types
// ============================================================================

interface UnifiedPatient {
  patient_id: string;
  age: number;
  age_bucket: string;
  gender: string;
  blood_type: string;
  primary_diagnosis: string;
  icd9_code: string;
  secondary_diagnoses: string;
  condition_category: string;
  insurance: string;
  admission_type: string;
  // Vitals
  spo2: number | null;
  heart_rate: number | null;
  systolic_bp: number | null;
  diastolic_bp: number | null;
  oxygen_flow: number | null;
  temperature: number | null;
  respiratory_rate: number | null;
  respiratory_status: string;
  // CBC Labs
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
  // Chemistry
  creatinine: number | null;
  bun: number | null;
  glucose: number | null;
  sodium: number | null;
  potassium: number | null;
  lactate: number | null;
  // Other
  medications: string;
  allergies: string;
  severity_score: number;
  critical_flag: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

function loadCsv<T>(path: string): T[] {
  const content = readFileSync(path, "utf-8");
  return parse(content, { columns: true, skip_empty_lines: true }) as T[];
}

function getAgeBucket(age: number): string {
  if (age < 18) return "0-17";
  if (age <= 30) return "18-30";
  if (age <= 45) return "31-45";
  if (age <= 60) return "46-60";
  if (age <= 75) return "61-75";
  return "76+";
}

function normalizeGender(g: string | number): string {
  if (typeof g === "number") return g === 0 ? "M" : "F";
  const s = String(g).toUpperCase().trim();
  if (s === "M" || s === "MALE" || s === "0") return "M";
  if (s === "F" || s === "FEMALE" || s === "1") return "F";
  return "U";
}

// Map conditions to categories
const conditionCategories: Record<string, string> = {
  // Infectious
  sepsis: "infectious",
  septicemia: "infectious",
  pneumonia: "infectious",
  "hepatitis b": "infectious",
  uti: "infectious",
  infection: "infectious",

  // Cardiac
  "heart failure": "cardiac",
  "atrial fibrillation": "cardiac",
  "coronary artery": "cardiac",
  "myocardial infarction": "cardiac",
  hypertension: "cardiac",
  "chest pain": "cardiac",

  // Respiratory
  copd: "respiratory",
  asthma: "respiratory",
  "respiratory failure": "respiratory",
  "pulmonary embolism": "respiratory",

  // Metabolic
  diabetes: "metabolic",
  hypoglycemia: "metabolic",
  hyperglycemia: "metabolic",
  obesity: "metabolic",
  "diabetic ketoacidosis": "metabolic",

  // Neurological
  stroke: "neurological",
  seizure: "neurological",
  "altered mental status": "neurological",

  // Trauma/Orthopedic
  fracture: "trauma",
  fall: "trauma",
  injury: "trauma",

  // Oncology
  cancer: "oncology",
  tumor: "oncology",
  malignancy: "oncology",
  leukemia: "oncology",

  // GI
  "gi bleed": "gi",
  pancreatitis: "gi",
  cirrhosis: "gi",

  // Renal
  "kidney disease": "renal",
  "renal failure": "renal",
  aki: "renal",
};

function categorizeCondition(condition: string): string {
  const lower = condition.toLowerCase();
  for (const [key, category] of Object.entries(conditionCategories)) {
    if (lower.includes(key)) return category;
  }
  return "other";
}

function parseFloat2(v: any): number | null {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function calculateAge(dob: string, refDate: string): number {
  const birth = new Date(dob);
  const ref = new Date(refDate);
  let age = ref.getFullYear() - birth.getFullYear();
  const m = ref.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < birth.getDate())) age--;
  return Math.max(0, Math.min(120, age)); // Clamp to reasonable range
}

// ============================================================================
// Load and Index Data
// ============================================================================

console.log("Loading datasets...");

const basePath = new URL("..", import.meta.url).pathname;

// MIMIC-III
const mimicPatients = loadCsv<any>(
  `${basePath}data/mimic-iii/PATIENTS.csv`
);
const mimicAdmissions = loadCsv<any>(
  `${basePath}data/mimic-iii/ADMISSIONS.csv`
);
const mimicDiagnoses = loadCsv<any>(
  `${basePath}data/mimic-iii/DIAGNOSES_ICD.csv`
);
const mimicIcdCodes = loadCsv<any>(
  `${basePath}data/mimic-iii/D_ICD_DIAGNOSES.csv`
);
const mimicPrescriptions = loadCsv<any>(
  `${basePath}data/mimic-iii/PRESCRIPTIONS.csv`
);
const mimicLabEvents = loadCsv<any>(
  `${basePath}data/mimic-iii/LABEVENTS.csv`
);
const mimicChartEvents = loadCsv<any>(
  `${basePath}data/mimic-iii/CHARTEVENTS.csv`
);

// Lab item IDs (from D_LABITEMS)
const LAB_ITEMS = {
  creatinine: "50912",
  glucose: "50931",
  potassium: "50971",
  sodium: "50983",
  lactate: "50813",
  platelets: "51265",
  bun: "51006", // Blood Urea Nitrogen
};

// Chart item IDs (from D_ITEMS) - using NBP (non-invasive BP) as primary
const CHART_ITEMS = {
  systolic_bp: ["455", "51", "442", "6"], // NBP, Arterial, Manual, ABP
  diastolic_bp: ["8368", "8441", "8555"], // NBP Diastolic variants
  temperature: ["678", "676"], // Temperature F, C
  respiratory_rate: ["618", "220210"], // RR
};

// Index labs by hadm_id
const labsByAdmission = new Map<string, Map<string, number>>();
for (const lab of mimicLabEvents) {
  if (!lab.hadm_id || lab.valuenum === "" || lab.valuenum === null) continue;
  const hadmId = lab.hadm_id;
  if (!labsByAdmission.has(hadmId)) labsByAdmission.set(hadmId, new Map());
  const labs = labsByAdmission.get(hadmId)!;
  // Store first non-null value for each lab type
  for (const [name, itemId] of Object.entries(LAB_ITEMS)) {
    if (lab.itemid === itemId && !labs.has(name)) {
      labs.set(name, parseFloat(lab.valuenum));
    }
  }
}

// Index chart events by hadm_id for vitals
const vitalsByAdmission = new Map<string, Map<string, number>>();
for (const chart of mimicChartEvents) {
  if (!chart.hadm_id || chart.valuenum === "" || chart.valuenum === null) continue;
  const hadmId = chart.hadm_id;
  if (!vitalsByAdmission.has(hadmId)) vitalsByAdmission.set(hadmId, new Map());
  const vitals = vitalsByAdmission.get(hadmId)!;
  // Check each vital type
  for (const [name, itemIds] of Object.entries(CHART_ITEMS)) {
    if (itemIds.includes(chart.itemid) && !vitals.has(name)) {
      vitals.set(name, parseFloat(chart.valuenum));
    }
  }
}

// Build lookup maps
const icdLookup = new Map<string, { short: string; long: string }>();
for (const icd of mimicIcdCodes) {
  icdLookup.set(icd.icd9_code, {
    short: icd.short_title,
    long: icd.long_title,
  });
}

const patientLookup = new Map<
  string,
  { gender: string; dob: string; dod: string | null }
>();
for (const p of mimicPatients) {
  patientLookup.set(p.subject_id, {
    gender: normalizeGender(p.gender),
    dob: p.dob,
    dod: p.dod || null,
  });
}

// Healthcare dataset
const healthcareRecords = loadCsv<any>(`${basePath}data/source/healthcare_dataset.csv`);

// Oxygen dataset
const oxygenRecords = loadCsv<any>(`${basePath}data/source/Oxygen Dataset Final.csv`);

// CBC dataset
const cbcRecords = loadCsv<any>(
  `${basePath}data/source/final_cbc_diagnoses_dataset_with_labels.csv`
);

console.log(
  `  MIMIC: ${mimicPatients.length} patients, ${mimicAdmissions.length} admissions`
);
console.log(`  Healthcare: ${healthcareRecords.length} records`);
console.log(`  Oxygen: ${oxygenRecords.length} records`);
console.log(`  CBC: ${cbcRecords.length} records`);

// ============================================================================
// Index source data by matching signature
// ============================================================================

// Index oxygen records by (age_bucket, gender)
const oxygenIndex = new Map<string, any[]>();
for (const r of oxygenRecords) {
  const age = parseInt(r.age);
  if (isNaN(age)) continue;
  const bucket = getAgeBucket(age);
  const gender = normalizeGender(r.gender);
  const key = `${bucket}:${gender}`;
  if (!oxygenIndex.has(key)) oxygenIndex.set(key, []);
  oxygenIndex.get(key)!.push(r);
}

// Index healthcare records by (age_bucket, gender, category)
const healthcareIndex = new Map<string, any[]>();
for (const r of healthcareRecords) {
  const age = parseInt(r.Age);
  if (isNaN(age)) continue;
  const bucket = getAgeBucket(age);
  const gender = normalizeGender(r.Gender);
  const category = categorizeCondition(r["Medical Condition"] || "");
  const key = `${bucket}:${gender}:${category}`;
  if (!healthcareIndex.has(key)) healthcareIndex.set(key, []);
  healthcareIndex.get(key)!.push(r);
}

// Index CBC records by (gender, diagnosis category)
const cbcIndex = new Map<string, any[]>();
for (const r of cbcRecords) {
  const gender = normalizeGender(r.gender);
  const category = categorizeCondition(r.short_title || r.long_title || "");
  const key = `${gender}:${category}`;
  if (!cbcIndex.has(key)) cbcIndex.set(key, []);
  cbcIndex.get(key)!.push(r);
}

// ============================================================================
// Build unified patients from MIMIC admissions
// ============================================================================

console.log("\nBuilding unified patient records...");

const unifiedPatients: UnifiedPatient[] = [];

for (const adm of mimicAdmissions) {
  const patient = patientLookup.get(adm.subject_id);
  if (!patient) continue;

  const age = calculateAge(patient.dob, adm.admittime);
  const ageBucket = getAgeBucket(age);
  const gender = patient.gender;

  // Get diagnoses for this admission
  const diagsForAdm = mimicDiagnoses.filter((d: any) => d.hadm_id === adm.hadm_id);
  diagsForAdm.sort((a: any, b: any) => parseInt(a.seq_num) - parseInt(b.seq_num));

  const primaryDiagCode = diagsForAdm[0]?.icd9_code || "";
  const primaryDiagInfo = icdLookup.get(primaryDiagCode);
  const primaryDiagnosis = primaryDiagInfo?.short || adm.diagnosis || "Unknown";

  const secondaryDiags = diagsForAdm
    .slice(1, 5)
    .map((d: any) => icdLookup.get(d.icd9_code)?.short || d.icd9_code)
    .join("|");

  const conditionCategory = categorizeCondition(primaryDiagnosis);

  // Get prescriptions
  const rxForAdm = mimicPrescriptions.filter((p: any) => p.hadm_id === adm.hadm_id);
  const medications = [
    ...new Set(rxForAdm.map((p: any) => p.drug).filter(Boolean)),
  ]
    .slice(0, 10)
    .join("|");

  // Find matching oxygen vitals
  const oxygenKey = `${ageBucket}:${gender}`;
  const oxygenMatches = oxygenIndex.get(oxygenKey) || [];
  const oxygenRecord = oxygenMatches[Math.floor(Math.random() * oxygenMatches.length)];

  // Find matching healthcare record
  const healthcareKey = `${ageBucket}:${gender}:${conditionCategory}`;
  const healthcareMatches = healthcareIndex.get(healthcareKey) || [];
  const healthcareRecord =
    healthcareMatches[Math.floor(Math.random() * healthcareMatches.length)];

  // Find matching CBC
  const cbcKey = `${gender}:${conditionCategory}`;
  const cbcMatches = cbcIndex.get(cbcKey) || [];
  const cbcRecord = cbcMatches[Math.floor(Math.random() * cbcMatches.length)];

  // Get MIMIC labs for this admission
  const mimicLabs = labsByAdmission.get(adm.hadm_id) || new Map();

  // Get MIMIC vitals for this admission
  const mimicVitals = vitalsByAdmission.get(adm.hadm_id) || new Map();

  // Determine critical flag and severity
  const isCritical =
    oxygenRecord?.["c/nc"] === "1.0" ||
    oxygenRecord?.["c/nc"] === 1 ||
    (oxygenRecord?.spo2 && parseFloat(oxygenRecord.spo2) < 90) ||
    conditionCategory === "infectious";

  // Calculate severity score (1-10)
  let severityScore = 3; // baseline
  if (isCritical) severityScore += 3;
  if (conditionCategory === "infectious") severityScore += 2;
  if (conditionCategory === "cardiac") severityScore += 1;
  if (age > 75) severityScore += 1;
  severityScore = Math.min(10, severityScore);

  const unified: UnifiedPatient = {
    patient_id: `P${adm.hadm_id}`,
    age,
    age_bucket: ageBucket,
    gender,
    blood_type: healthcareRecord?.["Blood Type"] || "Unknown",
    primary_diagnosis: primaryDiagnosis,
    icd9_code: primaryDiagCode,
    secondary_diagnoses: secondaryDiags,
    condition_category: conditionCategory,
    insurance: adm.insurance || healthcareRecord?.["Insurance Provider"] || "Unknown",
    admission_type: adm.admission_type || "Unknown",

    // Vitals: prefer MIMIC chart events, fallback to oxygen dataset
    spo2: parseFloat2(oxygenRecord?.spo2),
    heart_rate: parseFloat2(oxygenRecord?.pr),
    systolic_bp: mimicVitals.get("systolic_bp") ?? null,
    diastolic_bp: mimicVitals.get("diastolic_bp") ?? null,
    oxygen_flow: parseFloat2(oxygenRecord?.oxy_flow),
    temperature: mimicVitals.get("temperature") ?? null,
    respiratory_rate: mimicVitals.get("respiratory_rate") ?? null,
    respiratory_status: isCritical ? "critical" : "stable",

    // CBC Labs from external dataset
    hemoglobin: parseFloat2(cbcRecord?.Hemoglobin),
    wbc: parseFloat2(cbcRecord?.["White Blood Cells"]),
    rbc: parseFloat2(cbcRecord?.["Red Blood Cells"]),
    platelets: mimicLabs.get("platelets") ?? null,
    hematocrit: parseFloat2(cbcRecord?.Hematocrit),
    mcv: parseFloat2(cbcRecord?.MCV),
    mch: parseFloat2(cbcRecord?.MCH),
    mchc: parseFloat2(cbcRecord?.MCHC),
    rdw: parseFloat2(cbcRecord?.RDW),
    neutrophils: parseFloat2(cbcRecord?.Neutrophils),
    lymphocytes: parseFloat2(cbcRecord?.Lymphocytes),
    monocytes: parseFloat2(cbcRecord?.Monocytes),
    eosinophils: parseFloat2(cbcRecord?.Eosinophils),
    basophils: parseFloat2(cbcRecord?.Basophils),

    // Chemistry from MIMIC LABEVENTS
    creatinine: mimicLabs.get("creatinine") ?? null,
    bun: mimicLabs.get("bun") ?? null,
    glucose: mimicLabs.get("glucose") ?? null,
    sodium: mimicLabs.get("sodium") ?? null,
    potassium: mimicLabs.get("potassium") ?? null,
    lactate: mimicLabs.get("lactate") ?? null,

    // Other
    medications,
    allergies: "", // Not available
    severity_score: severityScore,
    critical_flag: isCritical,
  };

  unifiedPatients.push(unified);
}

console.log(`Built ${unifiedPatients.length} unified patient records`);

// ============================================================================
// Output CSV
// ============================================================================

const headers = Object.keys(unifiedPatients[0] || {});
const csvLines = [
  headers.join(","),
  ...unifiedPatients.map((p) =>
    headers
      .map((h) => {
        const val = (p as any)[h];
        if (val === null || val === undefined) return "";
        if (typeof val === "string" && (val.includes(",") || val.includes('"')))
          return `"${val.replace(/"/g, '""')}"`;
        return String(val);
      })
      .join(",")
  ),
];

const outputPath = `${basePath}data/patients.csv`;
writeFileSync(outputPath, csvLines.join("\n"));

console.log(`\nWrote unified dataset to: ${outputPath}`);
console.log(`  Total patients: ${unifiedPatients.length}`);
console.log(
  `  Categories: ${[...new Set(unifiedPatients.map((p) => p.condition_category))].join(", ")}`
);
console.log(
  `  Critical: ${unifiedPatients.filter((p) => p.critical_flag).length}`
);
