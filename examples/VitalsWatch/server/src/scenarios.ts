import {
  makeDefaultActiveMetaContext,
  type ActiveMetaContextInstance,
} from "active-meta-mgt";

type GoalInput = Parameters<ActiveMetaContextInstance["upsertGoal"]>[0];
type ConstraintInput = Parameters<ActiveMetaContextInstance["upsertConstraint"]>[0];
type AssumptionInput = Parameters<ActiveMetaContextInstance["upsertAssumption"]>[0];
type EvidenceInput = Parameters<ActiveMetaContextInstance["upsertEvidence"]>[0];
type QuestionInput = Parameters<ActiveMetaContextInstance["upsertQuestion"]>[0];
type DecisionInput = Parameters<ActiveMetaContextInstance["upsertDecision"]>[0];

// Minimal clinical-flavored scenario that exercises multiple lanes.
export type ScenarioId = "acute-diabetes" | "perioperative-safety";

export type Scenario = {
  id: ScenarioId;
  title: string;
  description: string;
  goals: GoalInput[];
  constraints: ConstraintInput[];
  assumptions: AssumptionInput[];
  evidence: EvidenceInput[];
  questions: QuestionInput[];
  decisions: DecisionInput[];
};

const scenarios: Record<ScenarioId, Scenario> = {
  "acute-diabetes": {
    id: "acute-diabetes",
    title: "Hyperglycemia management with allergy + access constraints",
    description:
      "Patient with uncontrolled type 2 diabetes, sulfa allergy, GI intolerance to metformin, and limited access to in-person follow-up.",
    goals: [
      {
        id: "goal-a1c",
        title: "Bring HbA1c below 7% within 90 days",
        priority: "p0",
        tags: [{ key: "lane", value: "task" }],
      },
      {
        id: "goal-education",
        title: "Provide self-management training for basal insulin titration",
        priority: "p1",
        tags: [{ key: "lane", value: "implementation" }],
      },
    ],
    constraints: [
      {
        id: "constraint-sulfa",
        statement: "Documented sulfa allergy – avoid sulfonylureas",
        priority: "p0",
        tags: [{ key: "lane", value: "threat-model" }],
      },
      {
        id: "constraint-coverage",
        statement: "Insurance prefers basal insulin over GLP-1 for this member",
        priority: "p1",
        tags: [{ key: "lane", value: "legal" }],
      },
    ],
    assumptions: [
      {
        id: "assumption-adherence",
        statement: "Patient can perform daily self-injection with teaching support",
        confidence: "medium",
        tags: [{ key: "lane", value: "personal" }],
      },
    ],
    evidence: [
      {
        id: "evidence-a1c",
        summary: "HbA1c: 9.4% (critical high)",
        detail: "Fasting specimen collected 2025-12-19",
        severity: "critical",
        confidence: "high",
        tags: [{ key: "lane", value: "task" }],
      },
      {
        id: "evidence-metformin",
        summary: "History of GI intolerance to metformin at 1000 mg BID",
        severity: "medium",
        confidence: "high",
        tags: [{ key: "lane", value: "personal" }],
      },
      {
        id: "evidence-sulf-allergy",
        summary: "Allergy: hives and SOB with sulfamethoxazole/trimethoprim",
        severity: "high",
        confidence: "high",
        tags: [{ key: "lane", value: "threat-model" }],
      },
      {
        id: "evidence-access",
        summary: "Lives >50 miles from clinic; telehealth preferred",
        severity: "low",
        confidence: "medium",
        tags: [{ key: "lane", value: "personal" }],
      },
    ],
    questions: [
      {
        id: "question-kidneys",
        question: "Is eGFR ≥ 45 ml/min to allow SGLT2 consideration?",
        priority: "p1",
        tags: [{ key: "lane", value: "task" }],
      },
    ],
    decisions: [
      {
        id: "decision-plan",
        statement: "Start basal insulin at 10 units nightly with 2u q3d titration until fasting 90-130",
        rationale: "Coverage allows basal; metformin not tolerated; sulfonylureas contraindicated",
        tags: [{ key: "lane", value: "implementation" }],
      },
    ],
  },
  "perioperative-safety": {
    id: "perioperative-safety",
    title: "Pre-op safety checklist with implanted device",
    description:
      "Same-day orthopedic case with pacemaker, anticoagulation, and recent URI; ensure clearance and device precautions.",
    goals: [
      {
        id: "goal-clearance",
        title: "Document anesthesia clearance and device interrogation before incision",
        priority: "p0",
        tags: [{ key: "lane", value: "task" }],
      },
      {
        id: "goal-bleed",
        title: "Minimize bleeding risk while maintaining VTE prophylaxis",
        priority: "p1",
        tags: [{ key: "lane", value: "threat-model" }],
      },
    ],
    constraints: [
      {
        id: "constraint-anticoag",
        statement: "On apixaban 5 mg BID – last dose 12 hours ago",
        priority: "p0",
        tags: [{ key: "lane", value: "threat-model" }],
      },
      {
        id: "constraint-device",
        statement: "Dual-chamber pacemaker – magnet protocol required",
        priority: "p1",
        tags: [{ key: "lane", value: "implementation" }],
      },
    ],
    assumptions: [
      {
        id: "assumption-airway",
        statement: "Airway expected uncomplicated despite recent URI",
        confidence: "low",
        tags: [{ key: "lane", value: "task" }],
      },
    ],
    evidence: [
      {
        id: "evidence-vitals",
        summary: "SpO2 97% RA, HR 78 paced, BP 132/78",
        severity: "low",
        confidence: "high",
        tags: [{ key: "lane", value: "personal" }],
      },
      {
        id: "evidence-uri",
        summary: "URI resolved 5 days ago; mild residual cough",
        severity: "medium",
        confidence: "medium",
        tags: [{ key: "lane", value: "task" }],
      },
      {
        id: "evidence-labs",
        summary: "INR 1.2, platelets 220k, creatinine 0.9",
        severity: "low",
        confidence: "high",
        tags: [{ key: "lane", value: "legal" }],
      },
    ],
    questions: [
      {
        id: "question-apixaban",
        question: "Has apixaban been held for at least 24-48h based on CrCl?",
        priority: "p0",
        tags: [{ key: "lane", value: "threat-model" }],
      },
      {
        id: "question-pacer",
        question: "Is device rep available or auto-magnet mode acceptable?",
        priority: "p1",
        tags: [{ key: "lane", value: "implementation" }],
      },
    ],
    decisions: [
      {
        id: "decision-plan-op",
        statement: "Proceed if anticoagulation held ≥24h and magnet applied pre-incision; otherwise delay",
        rationale: "Balance bleeding risk with urgent repair timeline",
        tags: [{ key: "lane", value: "implementation" }],
      },
    ],
  },
};

export function listScenarios() {
  return Object.values(scenarios).map((s) => ({ id: s.id, title: s.title, description: s.description }));
}

export function createContextForScenario(id: ScenarioId, tokenBudget = 700) {
  const scenario = scenarios[id];
  if (!scenario) {
    throw new Error(`Unknown scenario: ${id}`);
  }

  const ctx = makeDefaultActiveMetaContext(`demo-${id}`);

  scenario.goals.forEach((g) => ctx.upsertGoal(g));
  scenario.constraints.forEach((c) => ctx.upsertConstraint(c));
  scenario.assumptions.forEach((a) => ctx.upsertAssumption(a));
  scenario.evidence.forEach((e) => ctx.upsertEvidence(e));
  scenario.questions.forEach((q) => ctx.upsertQuestion(q));
  scenario.decisions.forEach((d) => ctx.upsertDecision(d));

  ctx.refreshAllLanes();
  ctx.mergeLanesToActiveWindow();
  ctx.synthesizeWorkingMemory({ tokenBudget, archiveRawItems: false });

  return { ctx, scenario };
}

export type { ScenarioId as AvailableScenarioId };
