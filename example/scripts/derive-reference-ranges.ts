/**
 * Derive lab reference ranges from CDC NHANES population data.
 *
 * Methodology:
 *   - Normal range: 2.5th to 97.5th percentile (covers 95% of healthy population)
 *   - Critical range: 0.5th and 99.5th percentile (extreme outliers)
 *
 * Source: CDC National Health and Nutrition Examination Survey (NHANES)
 * Output: data/reference-ranges.json
 */

import { readFileSync, writeFileSync } from "fs";
import { parse } from "csv-parse/sync";

// NHANES column mapping (from CDC codebook)
const NHANES_COLUMNS: Record<
  string,
  { column: string; label: string; unit: string }
> = {
  // CBC
  hemoglobin: { column: "LBXHGB", label: "Hemoglobin", unit: "g/dL" },
  hematocrit: { column: "LBXHCT", label: "Hematocrit", unit: "%" },
  rbc: { column: "LBXRBCSI", label: "Red Blood Cells", unit: "M/uL" },
  wbc: { column: "LBXWBCSI", label: "White Blood Cells", unit: "K/uL" },
  platelets: { column: "LBXPLTSI", label: "Platelets", unit: "K/uL" },
  mcv: { column: "LBXMCVSI", label: "MCV", unit: "fL" },
  mch: { column: "LBXMCHSI", label: "MCH", unit: "pg" },
  mchc: { column: "LBXMC", label: "MCHC", unit: "g/dL" },
  rdw: { column: "LBXRDW", label: "RDW", unit: "%" },

  // Differential
  neutrophils: { column: "LBXNEPCT", label: "Neutrophils", unit: "%" },
  lymphocytes: { column: "LBXLYPCT", label: "Lymphocytes", unit: "%" },
  monocytes: { column: "LBXMOPCT", label: "Monocytes", unit: "%" },
  eosinophils: { column: "LBXEOPCT", label: "Eosinophils", unit: "%" },
  basophils: { column: "LBXBAPCT", label: "Basophils", unit: "%" },

  // BMP/Chemistry
  glucose: { column: "LBXSGL", label: "Glucose", unit: "mg/dL" },
  bun: { column: "LBXSBU", label: "BUN", unit: "mg/dL" },
  creatinine: { column: "LBXSCR", label: "Creatinine", unit: "mg/dL" },
  sodium: { column: "LBXSNASI", label: "Sodium", unit: "mEq/L" },
  potassium: { column: "LBXSKSI", label: "Potassium", unit: "mEq/L" },
  chloride: { column: "LBXSCLSI", label: "Chloride", unit: "mEq/L" },
  calcium: { column: "LBXSCA", label: "Calcium", unit: "mg/dL" },

  // Lipids
  cholesterol: { column: "LBXTC", label: "Total Cholesterol", unit: "mg/dL" },
  triglycerides: { column: "LBXTR", label: "Triglycerides", unit: "mg/dL" },

  // Other
  albumin: { column: "LBXSAL", label: "Albumin", unit: "g/dL" },
  totalProtein: { column: "LBXSTP", label: "Total Protein", unit: "g/dL" },
  uricAcid: { column: "LBXSUA", label: "Uric Acid", unit: "mg/dL" },
  iron: { column: "LBXSIR", label: "Iron", unit: "ug/dL" },
};

interface LabRange {
  critLow: number;
  low: number;
  high: number;
  critHigh: number;
  unit: string;
  label: string;
  source: string;
  sampleSize: number;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return NaN;
  const sorted = arr.slice().sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

function round(value: number, decimals: number = 2): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

function deriveRange(
  values: number[],
  meta: { column: string; label: string; unit: string }
): LabRange {
  // Filter out NaN, null, undefined, and clearly invalid values
  const valid = values.filter(
    (v) => typeof v === "number" && !isNaN(v) && v > 0
  );

  if (valid.length < 100) {
    console.warn(
      `Warning: ${meta.label} has only ${valid.length} valid samples`
    );
  }

  return {
    critLow: round(percentile(valid, 0.5)),
    low: round(percentile(valid, 2.5)),
    high: round(percentile(valid, 97.5)),
    critHigh: round(percentile(valid, 99.5)),
    unit: meta.unit,
    label: meta.label,
    source: `NHANES ${meta.column}, n=${valid.length}, p0.5-p99.5`,
    sampleSize: valid.length,
  };
}

async function main() {
  console.log("Loading NHANES labs.csv...");

  const csvPath = new URL("../data/reference/labs.csv", import.meta.url).pathname;
  const csvContent = readFileSync(csvPath, "utf-8");

  console.log("Parsing CSV...");
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
  }) as Record<string, string>[];

  console.log(`Loaded ${records.length} records`);

  const ranges: Record<string, LabRange> = {};

  for (const [key, meta] of Object.entries(NHANES_COLUMNS)) {
    const values = records.map((r) => parseFloat(r[meta.column]));
    ranges[key] = deriveRange(values, meta);
    console.log(
      `  ${meta.label}: ${ranges[key].low} - ${ranges[key].high} ${meta.unit} (n=${ranges[key].sampleSize})`
    );
  }

  // Add vitals reference ranges (not in NHANES, using clinical standards)
  // These are based on published clinical guidelines since NHANES doesn't include real-time vitals
  const vitalsNote =
    "Clinical standard (not from NHANES - vitals not included in survey data)";
  ranges.spo2 = {
    critLow: 88,
    low: 95,
    high: 100,
    critHigh: 100,
    unit: "%",
    label: "Oxygen Saturation",
    source: vitalsNote,
    sampleSize: 0,
  };
  ranges.heartRate = {
    critLow: 40,
    low: 60,
    high: 100,
    critHigh: 150,
    unit: "bpm",
    label: "Heart Rate",
    source: vitalsNote,
    sampleSize: 0,
  };
  ranges.systolicBP = {
    critLow: 70,
    low: 90,
    high: 140,
    critHigh: 180,
    unit: "mmHg",
    label: "Systolic Blood Pressure",
    source: vitalsNote,
    sampleSize: 0,
  };
  ranges.diastolicBP = {
    critLow: 40,
    low: 60,
    high: 90,
    critHigh: 120,
    unit: "mmHg",
    label: "Diastolic Blood Pressure",
    source: vitalsNote,
    sampleSize: 0,
  };
  ranges.temperature = {
    critLow: 35,
    low: 36.1,
    high: 37.2,
    critHigh: 40,
    unit: "°C",
    label: "Temperature",
    source: vitalsNote,
    sampleSize: 0,
  };
  ranges.respiratoryRate = {
    critLow: 8,
    low: 12,
    high: 20,
    critHigh: 30,
    unit: "/min",
    label: "Respiratory Rate",
    source: vitalsNote,
    sampleSize: 0,
  };

  const outputPath = new URL(
    "../data/reference-ranges.json",
    import.meta.url
  ).pathname;
  writeFileSync(outputPath, JSON.stringify(ranges, null, 2));

  console.log(`\nWrote ${Object.keys(ranges).length} reference ranges to:`);
  console.log(`  ${outputPath}`);
}

main().catch(console.error);
