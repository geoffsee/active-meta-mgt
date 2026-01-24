/**
 * ICD-9 code to clinical scenario mapping.
 *
 * Maps diagnosis codes to clinical goals, constraints, and questions
 * for generating realistic clinical scenarios.
 */

export type Priority = "p0" | "p1" | "p2" | "p3";
export type Lane = "task" | "legal" | "personal" | "threat-model" | "implementation";

export interface IcdScenarioMapping {
  goal: string;
  priority: Priority;
  constraints: Array<{ statement: string; lane: Lane; priority: Priority }>;
  questions: Array<{ question: string; lane: Lane; priority: Priority }>;
  assumptions: Array<{ statement: string; confidence: "low" | "medium" | "high" }>;
  category: string;
}

export const icdToScenario: Record<string, IcdScenarioMapping> = {
  // ============================================================================
  // Infectious Diseases
  // ============================================================================
  "99591": {
    goal: "Achieve source control and hemodynamic stability in sepsis",
    priority: "p0",
    category: "infectious",
    constraints: [
      { statement: "Administer antibiotics within 1 hour of sepsis recognition", lane: "task", priority: "p0" },
      { statement: "Administer 30 mL/kg crystalloid if hypotensive or lactate >= 4", lane: "task", priority: "p0" },
      { statement: "Obtain blood cultures before antibiotics if possible without delay", lane: "implementation", priority: "p1" },
    ],
    questions: [
      { question: "Has the source of infection been identified?", lane: "task", priority: "p0" },
      { question: "Were blood cultures obtained before antibiotics?", lane: "implementation", priority: "p1" },
      { question: "Is vasopressor support required for persistent hypotension?", lane: "task", priority: "p1" },
    ],
    assumptions: [
      { statement: "Patient has adequate IV access for fluid resuscitation", confidence: "high" },
      { statement: "No known antibiotic allergies unless documented", confidence: "medium" },
    ],
  },

  "0389": {
    goal: "Treat septicemia with appropriate broad-spectrum antibiotics",
    priority: "p0",
    category: "infectious",
    constraints: [
      { statement: "Cover for gram-positive and gram-negative organisms empirically", lane: "task", priority: "p0" },
      { statement: "Adjust antibiotics based on culture results when available", lane: "implementation", priority: "p1" },
    ],
    questions: [
      { question: "What is the likely source (respiratory, urinary, abdominal, skin/soft tissue)?", lane: "task", priority: "p0" },
      { question: "Is there risk for MRSA or resistant organisms?", lane: "threat-model", priority: "p1" },
    ],
    assumptions: [
      { statement: "Empiric coverage will be narrowed once cultures finalize", confidence: "high" },
    ],
  },

  "486": {
    goal: "Resolve community-acquired pneumonia with appropriate antibiotic therapy",
    priority: "p0",
    category: "infectious",
    constraints: [
      { statement: "Assess CURB-65 score for disposition (ICU vs floor vs discharge)", lane: "task", priority: "p0" },
      { statement: "Ensure atypical coverage with macrolide or fluoroquinolone", lane: "implementation", priority: "p1" },
    ],
    questions: [
      { question: "Does patient require ICU-level care based on severity assessment?", lane: "task", priority: "p0" },
      { question: "Are there risk factors for Pseudomonas or resistant organisms?", lane: "threat-model", priority: "p1" },
    ],
    assumptions: [
      { statement: "Patient has no history of recent antibiotic exposure", confidence: "low" },
    ],
  },

  // ============================================================================
  // Cardiac Conditions
  // ============================================================================
  "4280": {
    goal: "Optimize heart failure with guideline-directed medical therapy",
    priority: "p0",
    category: "cardiac",
    constraints: [
      { statement: "Monitor daily weights and fluid balance", lane: "task", priority: "p0" },
      { statement: "Avoid NSAIDs - may worsen fluid retention", lane: "threat-model", priority: "p0" },
      { statement: "Consider beta-blocker if EF < 40% when euvolemic", lane: "implementation", priority: "p1" },
    ],
    questions: [
      { question: "What is the current ejection fraction?", lane: "task", priority: "p0" },
      { question: "Is patient on optimal GDMT (ACEi/ARB/ARNI, beta-blocker, MRA)?", lane: "implementation", priority: "p1" },
      { question: "Is there evidence of volume overload requiring diuresis?", lane: "task", priority: "p1" },
    ],
    assumptions: [
      { statement: "Patient can adhere to low-sodium diet at home", confidence: "medium" },
    ],
  },

  "42731": {
    goal: "Achieve rate and/or rhythm control for atrial fibrillation",
    priority: "p1",
    category: "cardiac",
    constraints: [
      { statement: "Anticoagulate per CHA2DS2-VASc score unless contraindicated", lane: "task", priority: "p0" },
      { statement: "Target heart rate < 110 bpm at rest if rate control strategy", lane: "task", priority: "p1" },
      { statement: "Assess bleeding risk with HAS-BLED before anticoagulation", lane: "threat-model", priority: "p1" },
    ],
    questions: [
      { question: "What is the CHA2DS2-VASc score?", lane: "task", priority: "p0" },
      { question: "Is patient a candidate for rhythm control vs rate control?", lane: "implementation", priority: "p1" },
      { question: "What is the duration of this AF episode?", lane: "task", priority: "p1" },
    ],
    assumptions: [
      { statement: "No prior history of anticoagulant-related bleeding", confidence: "medium" },
    ],
  },

  // ============================================================================
  // Metabolic Conditions
  // ============================================================================
  "25000": {
    goal: "Achieve glycemic control with HbA1c target < 7%",
    priority: "p0",
    category: "metabolic",
    constraints: [
      { statement: "Avoid hypoglycemia (glucose < 70 mg/dL)", lane: "threat-model", priority: "p0" },
      { statement: "Adjust diabetes medications based on renal function", lane: "implementation", priority: "p1" },
      { statement: "Consider SGLT2 inhibitor if eGFR adequate and CV/renal benefit indicated", lane: "implementation", priority: "p2" },
    ],
    questions: [
      { question: "What is the current HbA1c level?", lane: "task", priority: "p0" },
      { question: "Is eGFR >= 45 to allow SGLT2 inhibitor consideration?", lane: "task", priority: "p1" },
      { question: "Does patient have hypoglycemia unawareness?", lane: "threat-model", priority: "p1" },
    ],
    assumptions: [
      { statement: "Patient can perform self-monitoring of blood glucose", confidence: "medium" },
    ],
  },

  // ============================================================================
  // Respiratory Conditions
  // ============================================================================
  "496": {
    goal: "Manage COPD exacerbation with bronchodilators, steroids, and antibiotics if indicated",
    priority: "p0",
    category: "respiratory",
    constraints: [
      { statement: "Target SpO2 88-92% to avoid CO2 retention in COPD", lane: "task", priority: "p0" },
      { statement: "Administer systemic steroids for 5-7 days", lane: "implementation", priority: "p0" },
      { statement: "Consider antibiotics if increased sputum purulence", lane: "implementation", priority: "p1" },
    ],
    questions: [
      { question: "What is patient's baseline oxygen requirement?", lane: "task", priority: "p0" },
      { question: "Any history of prior intubations or ICU admissions for COPD?", lane: "threat-model", priority: "p1" },
      { question: "Is there evidence of bacterial infection (fever, purulent sputum)?", lane: "task", priority: "p1" },
    ],
    assumptions: [
      { statement: "Patient is not on home BiPAP unless documented", confidence: "medium" },
    ],
  },

  // ============================================================================
  // Hepatic/GI Conditions
  // ============================================================================
  "570": {
    goal: "Stabilize acute liver injury and identify etiology",
    priority: "p0",
    category: "gi",
    constraints: [
      { statement: "Avoid hepatotoxic medications (acetaminophen overdose workup)", lane: "threat-model", priority: "p0" },
      { statement: "Monitor for coagulopathy and encephalopathy", lane: "task", priority: "p0" },
      { statement: "Consider N-acetylcysteine if acetaminophen toxicity suspected", lane: "implementation", priority: "p0" },
    ],
    questions: [
      { question: "Is there history of acetaminophen ingestion or overdose?", lane: "task", priority: "p0" },
      { question: "What is the INR and mental status baseline?", lane: "task", priority: "p0" },
      { question: "Is there evidence of hepatic encephalopathy?", lane: "task", priority: "p1" },
    ],
    assumptions: [
      { statement: "Patient has no prior history of chronic liver disease", confidence: "low" },
    ],
  },

  // ============================================================================
  // Trauma/Orthopedic
  // ============================================================================
  "81201": {
    goal: "Manage surgical neck of humerus fracture with appropriate immobilization and pain control",
    priority: "p1",
    category: "trauma",
    constraints: [
      { statement: "Obtain orthopedic consult for surgical vs conservative management", lane: "implementation", priority: "p0" },
      { statement: "Assess neurovascular status of affected extremity", lane: "task", priority: "p0" },
      { statement: "Ensure adequate analgesia while avoiding oversedation in elderly", lane: "threat-model", priority: "p1" },
    ],
    questions: [
      { question: "Is there any neurovascular compromise distally?", lane: "task", priority: "p0" },
      { question: "Is patient a surgical candidate based on functional status?", lane: "implementation", priority: "p1" },
      { question: "What is the mechanism of injury (fall risk assessment)?", lane: "personal", priority: "p2" },
    ],
    assumptions: [
      { statement: "Patient has adequate social support for post-discharge care", confidence: "low" },
    ],
  },
};

/**
 * Get scenario mapping for an ICD-9 code.
 * Falls back to a generic mapping if specific code not found.
 */
export function getIcdScenario(icd9Code: string): IcdScenarioMapping | null {
  return icdToScenario[icd9Code] || null;
}

/**
 * Get all mapped ICD codes.
 */
export function getMappedIcdCodes(): string[] {
  return Object.keys(icdToScenario);
}

/**
 * Generate a default scenario for unmapped ICD codes.
 */
export function getDefaultScenario(
  diagnosisName: string,
  category: string
): IcdScenarioMapping {
  return {
    goal: `Evaluate and manage ${diagnosisName}`,
    priority: "p1",
    category,
    constraints: [
      { statement: "Obtain comprehensive history and physical examination", lane: "task", priority: "p1" },
      { statement: "Review medication list for potential interactions", lane: "threat-model", priority: "p2" },
    ],
    questions: [
      { question: "What are the patient's primary symptoms and their duration?", lane: "task", priority: "p1" },
      { question: "Are there any relevant comorbidities affecting management?", lane: "personal", priority: "p2" },
    ],
    assumptions: [
      { statement: "Patient is hemodynamically stable", confidence: "medium" },
    ],
  };
}
