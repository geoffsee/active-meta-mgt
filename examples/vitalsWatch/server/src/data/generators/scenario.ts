/**
 * Scenario generator.
 *
 * Generates clinical scenarios from patient data by combining:
 * - Patient demographics and clinical data
 * - ICD-based clinical mappings
 * - Lab/vital reference ranges for severity scoring
 * - Medication constraint rules
 */

import type { Patient } from "../loaders/patients";
import { getPatient, loadPatients, filterPatients } from "../loaders/patients";
import {
  transformPatient,
  getPatientSummary,
  type GoalInput,
  type ConstraintInput,
  type AssumptionInput,
  type EvidenceInput,
  type QuestionInput,
  type DecisionInput,
  type PatientSummary,
} from "../transformers/patient";

export interface GeneratedScenario {
  id: string;
  title: string;
  description: string;
  patient: PatientSummary;
  goals: GoalInput[];
  constraints: ConstraintInput[];
  assumptions: AssumptionInput[];
  evidence: EvidenceInput[];
  questions: QuestionInput[];
  decisions: DecisionInput[];
}

export interface GeneratorConfig {
  maxGoals?: number;
  maxConstraints?: number;
  maxEvidence?: number;
  maxQuestions?: number;
  maxDecisions?: number;
  maxAssumptions?: number;
}

const defaultConfig: Required<GeneratorConfig> = {
  maxGoals: 5,
  maxConstraints: 10,
  maxEvidence: 10,
  maxQuestions: 5,
  maxDecisions: 5,
  maxAssumptions: 5,
};

/**
 * Generate a scenario from a patient ID.
 */
export function generateScenario(
  patientId: string,
  config?: GeneratorConfig
): GeneratedScenario | null {
  const patient = getPatient(patientId);
  if (!patient) return null;

  return generateScenarioFromPatient(patient, config);
}

/**
 * Generate a scenario from a patient record.
 */
export function generateScenarioFromPatient(
  patient: Patient,
  config?: GeneratorConfig
): GeneratedScenario {
  const cfg = { ...defaultConfig, ...config };
  const transformed = transformPatient(patient);
  const summary = getPatientSummary(patient);

  // Build title
  const criticalPrefix = patient.critical_flag ? "Critical: " : "";
  const title = `${criticalPrefix}${patient.age}${patient.gender} with ${patient.primary_diagnosis}`;

  // Build description
  const secondaryDx =
    patient.secondary_diagnoses.length > 0
      ? ` with ${patient.secondary_diagnoses.slice(0, 3).join(", ")}`
      : "";
  const description = `${patient.admission_type} admission for ${patient.primary_diagnosis}${secondaryDx}. Severity score: ${patient.severity_score}/10.`;

  return {
    id: `scenario-${patient.patient_id}`,
    title,
    description,
    patient: summary,
    goals: transformed.goals.slice(0, cfg.maxGoals),
    constraints: transformed.constraints.slice(0, cfg.maxConstraints),
    assumptions: transformed.assumptions.slice(0, cfg.maxAssumptions),
    evidence: transformed.evidence.slice(0, cfg.maxEvidence),
    questions: transformed.questions.slice(0, cfg.maxQuestions),
    decisions: transformed.decisions.slice(0, cfg.maxDecisions),
  };
}

/**
 * Generate multiple scenarios matching filter criteria.
 */
export function generateScenarios(
  criteria: {
    category?: string;
    critical?: boolean;
    minSeverity?: number;
    maxSeverity?: number;
    limit?: number;
  },
  config?: GeneratorConfig
): GeneratedScenario[] {
  const patients = filterPatients(criteria);
  const limit = criteria.limit || 10;

  return patients.slice(0, limit).map((p) => generateScenarioFromPatient(p, config));
}

/**
 * List all available patient IDs for scenario generation.
 */
export function listAvailablePatients(): PatientSummary[] {
  return loadPatients().map(getPatientSummary);
}

/**
 * Get a random scenario.
 */
export function getRandomScenario(config?: GeneratorConfig): GeneratedScenario {
  const patients = loadPatients();
  if (patients.length === 0) {
    throw new Error("No patients available for scenario generation");
  }
  const randomIndex = Math.floor(Math.random() * patients.length);
  const randomPatient = patients[randomIndex];
  if (!randomPatient) {
    throw new Error("Random patient selection failed");
  }
  return generateScenarioFromPatient(randomPatient, config);
}

/**
 * Get scenario statistics.
 */
export function getScenarioStats(): {
  totalPatients: number;
  categories: Record<string, number>;
  criticalCount: number;
  avgSeverity: number;
} {
  const patients = loadPatients();

  const categories: Record<string, number> = {};
  let criticalCount = 0;
  let totalSeverity = 0;

  for (const p of patients) {
    categories[p.condition_category] = (categories[p.condition_category] || 0) + 1;
    if (p.critical_flag) criticalCount++;
    totalSeverity += p.severity_score;
  }

  return {
    totalPatients: patients.length,
    categories,
    criticalCount,
    avgSeverity: patients.length > 0 ? totalSeverity / patients.length : 0,
  };
}
