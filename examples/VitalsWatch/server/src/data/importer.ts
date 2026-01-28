import { parse as parseCsv } from "csv-parse/sync";

export interface AlignedCase {
  raw: Record<string, unknown>;
  aligned: Record<string, unknown>;
  credentials: {
    username: string;
    password: string;
  };
}

type DocFormat = "json" | "csv" | undefined;

/**
 * Parse an input document (JSON or CSV) into raw records.
 */
function parseDocument(content: string, format: DocFormat): Record<string, unknown>[] {
  const trimmed = content.trim();
  const fmt: DocFormat =
    format ||
    (trimmed.startsWith("{") || trimmed.startsWith("[") ? "json" : "csv");

  if (fmt === "json") {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
    if (typeof parsed === "object" && parsed !== null) {
      return [parsed as Record<string, unknown>];
    }
    throw new Error("JSON content must be an object or array");
  }

  // CSV path
  const rows = parseCsv(trimmed, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, unknown>[];
  return rows;
}

const toStr = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const toNum = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const toBool = (v: unknown) => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return ["true", "1", "yes", "y"].includes(v.toLowerCase());
  return false;
};
const toArray = (v: unknown) => {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => toStr(x)).filter(Boolean);
  const s = toStr(v);
  if (s.includes("|")) return s.split("|").map((x) => x.trim()).filter(Boolean);
  if (s.includes(",")) return s.split(",").map((x) => x.trim()).filter(Boolean);
  return s ? [s] : [];
};

function secureRandomString(length = 12) {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const bytes = new Uint8Array(length * 2);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // Fallback for non-web environments
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let output = "";
  for (let i = 0; i < bytes.length && output.length < length; i++) {
    const byte = bytes[i];
    if (byte === undefined) {
      continue;
    }
    output += alphabet.charAt(byte % alphabet.length);
  }
  return output.slice(0, length);
}

export function generateCredentials(patientId?: string) {
  const base = (patientId || "case").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const username = `case-${base || "new"}`;
  const password = secureRandomString(12);
  return { username, password };
}

function alignRecord(rec: Record<string, unknown>): Record<string, unknown> {
  const patient_id =
    toStr(rec.patient_id || rec.id || rec.mrn || rec.patientId || rec.subject_id || rec.encounter_id) ||
    `P${Date.now()}`;

  const aligned = {
    patient_id,
    age: toNum(rec.age) || 0,
    age_bucket: toStr(rec.age_bucket),
    gender: toStr(rec.gender || rec.sex || "U").toUpperCase(),
    blood_type: toStr(rec.blood_type || rec.bloodType || "Unknown"),
    primary_diagnosis: toStr(rec.primary_diagnosis || rec.diagnosis || rec.dx || "Unknown"),
    icd9_code: toStr(rec.icd9_code || rec.icd9 || rec.code || ""),
    secondary_diagnoses: toArray(rec.secondary_diagnoses || rec.diagnoses || rec.comorbidities),
    condition_category: toStr(rec.condition_category || rec.category || "other"),
    insurance: toStr(rec.insurance || rec.payer || "Unknown"),
    admission_type: toStr(rec.admission_type || rec.admit_type || "UNKNOWN"),
    vitals: {
      spo2: toNum((rec.vitals as any)?.spo2 ?? rec.spo2 ?? (rec as any)?.oxygen_saturation),
      heart_rate: toNum((rec.vitals as any)?.heart_rate ?? rec.heart_rate ?? rec.hr ?? rec.pulse),
      systolic_bp: toNum((rec.vitals as any)?.systolic_bp ?? rec.systolic_bp ?? rec.sbp ?? rec.systolic),
      diastolic_bp: toNum((rec.vitals as any)?.diastolic_bp ?? rec.diastolic_bp ?? rec.dbp ?? rec.diastolic),
      oxygen_flow: toNum((rec.vitals as any)?.oxygen_flow ?? rec.oxygen_flow ?? rec.o2_flow ?? rec.fio2),
      temperature: toNum((rec.vitals as any)?.temperature ?? rec.temperature ?? rec.temp),
      respiratory_rate: toNum((rec.vitals as any)?.respiratory_rate ?? rec.respiratory_rate ?? rec.rr),
      respiratory_status: toStr((rec.vitals as any)?.respiratory_status ?? rec.respiratory_status ?? "unknown"),
    },
    labs: {
      hemoglobin: toNum((rec.labs as any)?.hemoglobin ?? rec.hemoglobin ?? rec.hgb ?? rec.hb),
      wbc: toNum((rec.labs as any)?.wbc ?? rec.wbc ?? (rec as any)?.white_blood_cells),
      rbc: toNum((rec.labs as any)?.rbc ?? rec.rbc ?? (rec as any)?.red_blood_cells),
      platelets: toNum((rec.labs as any)?.platelets ?? rec.platelets ?? rec.plt),
      hematocrit: toNum((rec.labs as any)?.hematocrit ?? rec.hematocrit ?? rec.hct),
      mcv: toNum((rec.labs as any)?.mcv ?? rec.mcv),
      mch: toNum((rec.labs as any)?.mch ?? rec.mch),
      mchc: toNum((rec.labs as any)?.mchc ?? rec.mchc),
      rdw: toNum((rec.labs as any)?.rdw ?? rec.rdw),
      neutrophils: toNum((rec.labs as any)?.neutrophils ?? rec.neutrophils ?? rec.neut),
      lymphocytes: toNum((rec.labs as any)?.lymphocytes ?? rec.lymphocytes ?? rec.lymph),
      monocytes: toNum((rec.labs as any)?.monocytes ?? rec.monocytes ?? rec.mono),
      eosinophils: toNum((rec.labs as any)?.eosinophils ?? rec.eosinophils ?? rec.eos),
      basophils: toNum((rec.labs as any)?.basophils ?? rec.basophils ?? rec.baso),
      creatinine: toNum((rec.labs as any)?.creatinine ?? rec.creatinine ?? rec.cr),
      bun: toNum((rec.labs as any)?.bun ?? rec.bun),
      glucose: toNum((rec.labs as any)?.glucose ?? rec.glucose ?? rec.glu ?? rec.bg),
      sodium: toNum((rec.labs as any)?.sodium ?? rec.sodium ?? rec.na),
      potassium: toNum((rec.labs as any)?.potassium ?? rec.potassium ?? rec.k),
      lactate: toNum((rec.labs as any)?.lactate ?? rec.lactate ?? rec.lac),
    },
    medications: toArray(rec.medications || rec.meds || rec.drugs),
    allergies: toArray(rec.allergies),
    severity_score: Math.min(10, Math.max(1, toNum(rec.severity_score ?? rec.severity ?? rec.acuity) || 5)),
    critical_flag: toBool(rec.critical_flag ?? rec.critical ?? rec.icu),
  };

  return aligned;
}

export function parseAndAlignCases(content: string, format?: DocFormat): AlignedCase[] {
  const rawRecords = parseDocument(content, format);

  return rawRecords.map((raw) => {
    const aligned = alignRecord(raw);
    const credentials = generateCredentials(aligned.patient_id as string | undefined);
    return {
      raw,
      aligned: {
        ...aligned,
        username: credentials.username,
        password: credentials.password,
        _source: "import",
      },
      credentials,
    };
  });
}
