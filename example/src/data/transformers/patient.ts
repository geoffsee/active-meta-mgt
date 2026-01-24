/**
 * Transform patient data into knowledge objects.
 *
 * Generates Goals, Constraints, Assumptions, Evidence, Questions, and Decisions
 * from patient records using reference data mappings.
 */

import type { Patient } from "../loaders/patients";
import {
  labRanges,
  scoreSeverity,
  interpretLabValue,
  type Severity,
} from "../reference/labRanges";
import {
  getIcdScenario,
  getDefaultScenario,
  type Priority,
  type Lane,
} from "../reference/icdMapping";
import { getDrugConstraints, isDrugContraindicated } from "../reference/drugRules";

// Types matching the active-meta-mgt framework
export interface GoalInput {
  id: string;
  title: string;
  description?: string;
  priority: Priority;
  tags: Array<{ key: string; value?: string }>;
}

export interface ConstraintInput {
  id: string;
  statement: string;
  priority: Priority;
  tags: Array<{ key: string; value?: string }>;
}

export interface AssumptionInput {
  id: string;
  statement: string;
  confidence: "low" | "medium" | "high";
  tags: Array<{ key: string; value?: string }>;
}

export interface EvidenceInput {
  id: string;
  summary: string;
  detail?: string;
  severity: Severity;
  confidence: "low" | "medium" | "high";
  tags: Array<{ key: string; value?: string }>;
}

export interface QuestionInput {
  id: string;
  question: string;
  priority: Priority;
  tags: Array<{ key: string; value?: string }>;
}

export interface DecisionInput {
  id: string;
  statement: string;
  rationale?: string;
  tags: Array<{ key: string; value?: string }>;
}

export interface TransformedPatient {
  goals: GoalInput[];
  constraints: ConstraintInput[];
  assumptions: AssumptionInput[];
  evidence: EvidenceInput[];
  questions: QuestionInput[];
  decisions: DecisionInput[];
}

/**
 * Transform a patient record into knowledge objects.
 */
export function transformPatient(patient: Patient): TransformedPatient {
  const goals: GoalInput[] = [];
  const constraints: ConstraintInput[] = [];
  const assumptions: AssumptionInput[] = [];
  const evidence: EvidenceInput[] = [];
  const questions: QuestionInput[] = [];
  const decisions: DecisionInput[] = [];

  // Get ICD-based scenario mapping
  const icdScenario =
    getIcdScenario(patient.icd9_code) ||
    getDefaultScenario(patient.primary_diagnosis, patient.condition_category);

  // ============================================================================
  // Goals
  // ============================================================================

  // Primary goal from ICD mapping
  goals.push({
    id: `goal-primary-${patient.patient_id}`,
    title: icdScenario.goal,
    description: `For ${patient.age}${patient.gender} with ${patient.primary_diagnosis}`,
    priority: icdScenario.priority,
    tags: [{ key: "lane", value: "task" }],
  });

  // Secondary goal if critical
  if (patient.critical_flag) {
    goals.push({
      id: `goal-stabilize-${patient.patient_id}`,
      title: "Achieve hemodynamic and respiratory stability",
      priority: "p0",
      tags: [{ key: "lane", value: "task" }],
    });
  }

  // ============================================================================
  // Constraints from ICD mapping
  // ============================================================================

  for (let i = 0; i < icdScenario.constraints.length; i++) {
    const c = icdScenario.constraints[i];
    constraints.push({
      id: `constraint-icd-${i}-${patient.patient_id}`,
      statement: c.statement,
      priority: c.priority,
      tags: [{ key: "lane", value: c.lane }],
    });
  }

  // ============================================================================
  // Constraints from medications
  // ============================================================================

  for (const med of patient.medications) {
    const drugRules = getDrugConstraints(med);
    if (drugRules) {
      // Add monitoring requirements
      for (let i = 0; i < Math.min(2, drugRules.monitoring.length); i++) {
        constraints.push({
          id: `constraint-med-${med.replace(/\s+/g, "-").toLowerCase()}-${i}-${patient.patient_id}`,
          statement: `${med}: ${drugRules.monitoring[i]}`,
          priority: "p2",
          tags: [{ key: "lane", value: "implementation" }],
        });
      }

      // Add warnings as constraints
      for (let i = 0; i < Math.min(1, drugRules.warnings.length); i++) {
        constraints.push({
          id: `constraint-warn-${med.replace(/\s+/g, "-").toLowerCase()}-${i}-${patient.patient_id}`,
          statement: `${med}: ${drugRules.warnings[i]}`,
          priority: "p1",
          tags: [{ key: "lane", value: "threat-model" }],
        });
      }
    }
  }

  // Insurance/legal constraints
  if (patient.insurance) {
    constraints.push({
      id: `constraint-insurance-${patient.patient_id}`,
      statement: `Insurance: ${patient.insurance} - verify coverage for planned treatments`,
      priority: "p2",
      tags: [{ key: "lane", value: "legal" }],
    });
  }

  // ============================================================================
  // Evidence from vitals
  // ============================================================================

  if (patient.vitals.spo2 !== null) {
    const interp = interpretLabValue("spo2", patient.vitals.spo2);
    if (interp) {
      evidence.push({
        id: `ev-spo2-${patient.patient_id}`,
        summary: interp.interpretation,
        detail: patient.vitals.oxygen_flow
          ? `On ${patient.vitals.oxygen_flow}L supplemental oxygen`
          : undefined,
        severity: interp.severity,
        confidence: "high",
        tags: [{ key: "lane", value: "task" }],
      });
    }
  }

  if (patient.vitals.heart_rate !== null) {
    const interp = interpretLabValue("heartRate", patient.vitals.heart_rate);
    if (interp) {
      evidence.push({
        id: `ev-hr-${patient.patient_id}`,
        summary: interp.interpretation,
        severity: interp.severity,
        confidence: "high",
        tags: [{ key: "lane", value: "task" }],
      });
    }
  }

  if (patient.vitals.respiratory_status === "critical") {
    evidence.push({
      id: `ev-resp-status-${patient.patient_id}`,
      summary: "Respiratory status: critical - requires close monitoring",
      severity: "critical",
      confidence: "high",
      tags: [{ key: "lane", value: "task" }],
    });
  }

  // ============================================================================
  // Evidence from labs
  // ============================================================================

  const labsToCheck: Array<{ key: keyof typeof patient.labs; labName: string }> = [
    { key: "hemoglobin", labName: "hemoglobin" },
    { key: "wbc", labName: "wbc" },
    { key: "hematocrit", labName: "hematocrit" },
    { key: "platelets", labName: "platelets" },
    { key: "creatinine", labName: "creatinine" },
    { key: "glucose", labName: "glucose" },
    { key: "sodium", labName: "sodium" },
    { key: "potassium", labName: "potassium" },
  ];

  for (const { key, labName } of labsToCheck) {
    const value = patient.labs[key];
    if (value !== null) {
      const interp = interpretLabValue(labName, value);
      if (interp && interp.severity !== "low") {
        evidence.push({
          id: `ev-lab-${labName}-${patient.patient_id}`,
          summary: interp.interpretation,
          severity: interp.severity,
          confidence: "high",
          tags: [{ key: "lane", value: "task" }],
        });
      }
    }
  }

  // ============================================================================
  // Assumptions from ICD mapping and patient factors
  // ============================================================================

  for (let i = 0; i < icdScenario.assumptions.length; i++) {
    const a = icdScenario.assumptions[i];
    assumptions.push({
      id: `assumption-icd-${i}-${patient.patient_id}`,
      statement: a.statement,
      confidence: a.confidence,
      tags: [{ key: "lane", value: "personal" }],
    });
  }

  // Age-based assumptions
  if (patient.age >= 75) {
    assumptions.push({
      id: `assumption-elderly-${patient.patient_id}`,
      statement: "Elderly patient - may have reduced physiologic reserve and increased fall risk",
      confidence: "high",
      tags: [{ key: "lane", value: "personal" }],
    });
  }

  // ============================================================================
  // Questions from ICD mapping
  // ============================================================================

  for (let i = 0; i < icdScenario.questions.length; i++) {
    const q = icdScenario.questions[i];
    questions.push({
      id: `question-icd-${i}-${patient.patient_id}`,
      question: q.question,
      priority: q.priority,
      tags: [{ key: "lane", value: q.lane }],
    });
  }

  // Add questions for missing critical data
  if (patient.labs.creatinine === null) {
    questions.push({
      id: `question-renal-${patient.patient_id}`,
      question: "Is renal function known? (needed for medication dosing)",
      priority: "p1",
      tags: [{ key: "lane", value: "task" }],
    });
  }

  // ============================================================================
  // Decisions (initial/pending)
  // ============================================================================

  decisions.push({
    id: `decision-primary-${patient.patient_id}`,
    statement: `Admission type: ${patient.admission_type}`,
    rationale: `Based on ${patient.primary_diagnosis} with severity score ${patient.severity_score}/10`,
    tags: [{ key: "lane", value: "implementation" }],
  });

  if (patient.medications.length > 0) {
    decisions.push({
      id: `decision-meds-${patient.patient_id}`,
      statement: `Continue current medications: ${patient.medications.slice(0, 5).join(", ")}${patient.medications.length > 5 ? "..." : ""}`,
      rationale: "Medications reconciled from admission",
      tags: [{ key: "lane", value: "implementation" }],
    });
  }

  return {
    goals,
    constraints,
    assumptions,
    evidence,
    questions,
    decisions,
  };
}

/**
 * Get a compact patient summary for UI display.
 */
export interface PatientSummary {
  id: string;
  age: number;
  gender: string;
  primaryDiagnosis: string;
  category: string;
  severityScore: number;
  criticalFlag: boolean;
}

export function getPatientSummary(patient: Patient): PatientSummary {
  return {
    id: patient.patient_id,
    age: patient.age,
    gender: patient.gender,
    primaryDiagnosis: patient.primary_diagnosis,
    category: patient.condition_category,
    severityScore: patient.severity_score,
    criticalFlag: patient.critical_flag,
  };
}
