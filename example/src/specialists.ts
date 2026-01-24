/**
 * Clinical Specialists - Each represents a focused concern with its own
 * lane configuration, selection policy, and LLM prompt.
 *
 * This demonstrates the core purpose of active-meta-mgt: diversifying
 * context across multiple focused queries rather than one monolithic call.
 */

export interface Specialist {
  id: string;
  name: string;
  description: string;
  color: string; // For UI card styling
  icon: string; // Emoji for quick visual identification

  // Lane configuration
  laneTags: { key: string; value: string }[];
  policy: {
    wSeverity: number;
    wConfidence: number;
    wPriority: number;
    wRecency: number;
    maxItems: number;
  };
  tokenBudget: number;

  // LLM configuration
  systemPrompt: string;
  userPromptTemplate: string; // {workingMemory} and {patient} are replaced
}

export const SPECIALISTS: Specialist[] = [
  {
    id: "immediate",
    name: "Immediate Actions",
    description: "Critical interventions needed RIGHT NOW",
    color: "#dc2626", // red
    icon: "🚨",
    laneTags: [
      { key: "lane", value: "task" },
      { key: "urgency", value: "immediate" },
    ],
    policy: {
      wSeverity: 2.0, // Heavily weight severity
      wConfidence: 1.0,
      wPriority: 1.5,
      wRecency: 0.5,
      maxItems: 10,
    },
    tokenBudget: 400,
    systemPrompt: `You are an emergency medicine specialist focused on IMMEDIATE life-threatening issues.
Your job is to identify what must happen in the next 0-60 minutes.
Be direct and actionable. Use bullet points. No preamble.
Focus only on critical, time-sensitive interventions.`,
    userPromptTemplate: `Patient: {patient}

Current clinical context:
{workingMemory}

What are the IMMEDIATE actions needed (next 0-60 minutes)? Be specific and actionable.`,
  },

  {
    id: "medications",
    name: "Medication Review",
    description: "Drug interactions, contraindications, dosing concerns",
    color: "#2563eb", // blue
    icon: "💊",
    laneTags: [
      { key: "lane", value: "medications" },
      { key: "type", value: "constraint" },
    ],
    policy: {
      wSeverity: 1.5,
      wConfidence: 1.5, // High confidence important for drug safety
      wPriority: 1.0,
      wRecency: 0.3,
      maxItems: 15,
    },
    tokenBudget: 500,
    systemPrompt: `You are a clinical pharmacist reviewing medication safety.
Focus on: drug-drug interactions, contraindications given patient conditions,
dosing adjustments needed (renal/hepatic), and monitoring requirements.
Flag any HIGH-RISK combinations. Be specific about what to change and why.`,
    userPromptTemplate: `Patient: {patient}

Medication and constraint context:
{workingMemory}

Review medications for safety concerns. What needs adjustment?`,
  },

  {
    id: "differential",
    name: "Differential Diagnosis",
    description: "Alternative diagnoses to consider",
    color: "#7c3aed", // purple
    icon: "🔍",
    laneTags: [
      { key: "lane", value: "differential" },
      { key: "type", value: "evidence" },
    ],
    policy: {
      wSeverity: 1.0,
      wConfidence: 0.8, // Lower confidence items may reveal alternatives
      wPriority: 1.0,
      wRecency: 1.0,
      maxItems: 12,
    },
    tokenBudget: 450,
    systemPrompt: `You are a diagnostician considering alternative explanations.
Given the current working diagnosis, what else should be ruled out?
Focus on "can't miss" diagnoses that would change management.
List differentials with key distinguishing features and tests to order.`,
    userPromptTemplate: `Patient: {patient}

Clinical evidence:
{workingMemory}

What alternative diagnoses should be considered? What would confirm or rule them out?`,
  },

  {
    id: "monitoring",
    name: "Monitoring Plan",
    description: "What to watch for and escalation triggers",
    color: "#ca8a04", // yellow/amber
    icon: "📊",
    laneTags: [
      { key: "lane", value: "monitoring" },
      { key: "type", value: "goal" },
    ],
    policy: {
      wSeverity: 1.2,
      wConfidence: 1.0,
      wPriority: 1.2,
      wRecency: 0.8,
      maxItems: 10,
    },
    tokenBudget: 400,
    systemPrompt: `You are setting up a monitoring plan for the care team.
Define: what vitals/labs to track, how often, specific thresholds for escalation,
and what changes would indicate improvement vs deterioration.
Be specific with numbers (e.g., "if MAP < 65 for > 15 min, call rapid response").`,
    userPromptTemplate: `Patient: {patient}

Goals and current status:
{workingMemory}

Create a monitoring plan with specific escalation triggers.`,
  },

  {
    id: "risk",
    name: "Risk Assessment",
    description: "What could go wrong and how to mitigate",
    color: "#ea580c", // orange
    icon: "⚠️",
    laneTags: [
      { key: "lane", value: "threat-model" },
      { key: "lane", value: "risk" },
    ],
    policy: {
      wSeverity: 1.8,
      wConfidence: 0.7, // Uncertain items may represent risks
      wPriority: 1.0,
      wRecency: 0.5,
      maxItems: 10,
    },
    tokenBudget: 400,
    systemPrompt: `You are a patient safety officer identifying risks.
What could go wrong with this patient in the next 24-48 hours?
Consider: clinical deterioration, medication errors, system failures,
communication gaps. For each risk, suggest a mitigation strategy.`,
    userPromptTemplate: `Patient: {patient}

Risk-relevant context:
{workingMemory}

What are the key risks and how should they be mitigated?`,
  },
];

export function getSpecialist(id: string): Specialist | undefined {
  return SPECIALISTS.find((s) => s.id === id);
}
