import { types, getSnapshot, type Instance, type SnapshotIn } from "mobx-state-tree";
import type OpenAI from "openai";
import type { Specialist } from "./specialists";

const severityOptions = ["info", "moderate", "high", "critical"] as const;
const confidenceOptions = ["low", "medium", "high"] as const;
const categoryOptions = [
  "action",
  "medication",
  "monitoring",
  "risk",
  "diagnosis",
  "information",
] as const;

type Severity = (typeof severityOptions)[number];
type Confidence = (typeof confidenceOptions)[number];
type Category = (typeof categoryOptions)[number];

const Tag = types.model("Tag", {
  key: types.string,
  value: types.maybe(types.string),
});

const StructuredFinding = types.model("StructuredFinding", {
  id: types.identifier,
  specialistId: types.string,
  title: types.string,
  category: types.enumeration("FindingCategory", categoryOptions),
  severity: types.enumeration("FindingSeverity", severityOptions),
  confidence: types.enumeration("FindingConfidence", confidenceOptions),
  rationale: types.maybe(types.string),
  timeframe: types.maybe(types.string),
  tags: types.optional(types.array(Tag), []),
});

const SpecialistRun = types.model("SpecialistRun", {
  id: types.identifier,
  specialistId: types.string,
  workingMemory: types.string,
  rawText: types.string,
  findings: types.array(StructuredFinding),
  createdAt: types.optional(types.string, () => new Date().toISOString()),
});

const Conflict = types.model("Conflict", {
  id: types.identifier,
  summary: types.string,
  severity: types.enumeration("ConflictSeverity", severityOptions),
  involvedFindingIds: types.optional(types.array(types.string), []),
});

const FollowUp = types.model("FollowUp", {
  id: types.identifier,
  action: types.string,
  reason: types.string,
  severity: types.enumeration("FollowUpSeverity", severityOptions),
});

export const SpecialistCoordinator = types
  .model("SpecialistCoordinator", {
    runs: types.optional(types.array(SpecialistRun), []),
    conflicts: types.optional(types.array(Conflict), []),
    followUps: types.optional(types.array(FollowUp), []),
  })
  .actions((self) => {
    const collectFindings = () =>
      Array.from(self.runs).flatMap((r) => Array.from(r.findings));

    const recomputeFollowUps = () => {
      const next: SnapshotIn<typeof FollowUp>[] = [];

      if (collectFindings().some((f) => f.severity === "critical")) {
        next.push({
          id: makeFollowUpId("critical-finding"),
          action: "Immediate clinician review",
          reason: "At least one finding is marked critical",
          severity: "critical",
        });
      }

      self.conflicts.forEach((c) => {
        next.push({
          id: makeFollowUpId(c.summary),
          action: "Resolve specialist conflicts",
          reason: c.summary,
          severity: c.severity,
        });
      });

      self.followUps.replace(next as Instance<typeof FollowUp>[]);
    };

    return {
      addRun(run: SnapshotIn<typeof SpecialistRun>) {
        self.runs.push(run as Instance<typeof SpecialistRun>);
        recomputeFollowUps();
      },
      setConflicts(conflicts: SnapshotIn<typeof Conflict>[]) {
        self.conflicts.replace(conflicts as Instance<typeof Conflict>[]);
        recomputeFollowUps();
      },
      getAllFindings() {
        return collectFindings();
      },
    };
  });

export type SpecialistCoordinatorInstance = Instance<typeof SpecialistCoordinator>;
export type StructuredFindingInstance = Instance<typeof StructuredFinding>;

export function makeSpecialistCoordinator(): SpecialistCoordinatorInstance {
  return SpecialistCoordinator.create({});
}

const structureSystemPrompt = `You convert clinical specialist notes into structured JSON findings. 
Only use facts from the supplied specialist output and working memory. Do not invent data. 
Return compact JSON no commentary.`;

const conflictSystemPrompt = `You reconcile multiple specialist findings and spot conflicts or contradictions. 
Return JSON only.`;

type FindingDraft = {
  title?: string;
  category?: string;
  severity?: Severity;
  confidence?: Confidence;
  rationale?: string;
  timeframe?: string;
  tags?: { key: string; value?: string }[];
};

type ConflictDraft = {
  summary?: string;
  severity?: Severity;
  involvedFindingIds?: string[];
};

export async function structureSpecialistResponse(params: {
  openai: OpenAI;
  specialist: Specialist;
  patientSummary: string;
  patientId: string;
  workingMemory: string;
  rawResponse: string;
  maxItems?: number;
}): Promise<SnapshotIn<typeof StructuredFinding>[]> {
  const { openai, specialist, patientSummary, patientId, workingMemory, rawResponse, maxItems = 8 } = params;

  const userPrompt = `Patient: ${patientSummary}

Working memory:
${workingMemory}

Specialist (${specialist.name}) free-text response:
${rawResponse}

Transform into JSON with key "findings" = array of up to ${maxItems} objects:
- title: concise label
- category: one of ${categoryOptions.join(", ")}
- severity: one of ${severityOptions.join(", ")}
- confidence: one of ${confidenceOptions.join(", ")}
- timeframe: optional string (e.g., "0-60m", "24h", "48h", "ongoing")
- rationale: optional short justification
- tags: optional list of {key, value}
Return JSON only.`;

  const completion = await openai.responses.create({
    model: "gpt-4o-mini-2024-07-18",
    input: [
      { role: "system", content: structureSystemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const parsed = parseFindingsPayload(completion.output_text ?? "{}");
  return parsed.slice(0, maxItems).map((f, idx) => normalizeFinding(f, specialist.id, patientId, idx));
}

export async function detectConflicts(params: {
  openai: OpenAI;
  findings: SnapshotIn<typeof StructuredFinding>[];
  maxItems?: number;
}): Promise<SnapshotIn<typeof Conflict>[]> {
  const { openai, findings, maxItems = 6 } = params;
  if (!findings.length) return [];

  const slim = findings.map((f) => ({
    id: f.id,
    specialistId: f.specialistId,
    title: f.title,
    category: f.category,
    severity: f.severity,
    confidence: f.confidence,
    tags: f.tags,
  }));

  const userPrompt = `Given these structured findings from multiple specialists, identify contradictions or mutually exclusive recommendations. 
Return JSON with key "conflicts" = array (max ${maxItems}) of objects:
- summary (concise)
- severity: one of ${severityOptions.join(", ")}
- involvedFindingIds: ids that conflict
Only flag conflicts where actions differ or pose safety risk.`;

  const completion = await openai.responses.create({
    model: "gpt-4o-mini-2024-07-18",
    input: [
      { role: "system", content: conflictSystemPrompt },
      { role: "user", content: `${userPrompt}\n\nFindings:\n${JSON.stringify(slim, null, 2)}` },
    ],
  });

  const parsed = parseConflictsPayload(completion.output_text ?? "{}");
  return parsed.slice(0, maxItems).map((c, idx) => normalizeConflict(c, idx));
}

function normalizeFinding(raw: FindingDraft, specialistId: string, patientId: string, idx: number): SnapshotIn<typeof StructuredFinding> {
  const cleanCategory: Category = categoryOptions.includes((raw.category as Category) ?? "" as Category)
    ? (raw.category as Category)
    : "information";
  const cleanSeverity: Severity = severityOptions.includes((raw.severity as Severity) ?? "" as Severity)
    ? (raw.severity as Severity)
    : "moderate";
  const cleanConfidence: Confidence = confidenceOptions.includes((raw.confidence as Confidence) ?? "" as Confidence)
    ? (raw.confidence as Confidence)
    : "medium";

  return {
    id: makeFindingId(patientId, specialistId, raw, idx),
    specialistId,
    title: raw.title?.trim() || "Unlabeled finding",
    category: cleanCategory,
    severity: cleanSeverity,
    confidence: cleanConfidence,
    rationale: raw.rationale?.trim(),
    timeframe: raw.timeframe?.trim(),
    tags: (raw.tags || []).map((t) => ({ key: t.key, value: t.value })) as SnapshotIn<typeof Tag>[],
  };
}

function normalizeConflict(raw: ConflictDraft, idx: number): SnapshotIn<typeof Conflict> {
  const cleanSeverity: Severity = severityOptions.includes((raw.severity as Severity) ?? "" as Severity)
    ? (raw.severity as Severity)
    : "moderate";
  return {
    id: makeConflictId(raw, idx),
    summary: raw.summary?.trim() || "Unspecified conflict",
    severity: cleanSeverity,
    involvedFindingIds: raw.involvedFindingIds || [],
  };
}

function parseFindingsPayload(text: string): FindingDraft[] {
  try {
    const asJson = JSON.parse(text);
    if (Array.isArray(asJson)) return asJson;
    if (Array.isArray((asJson as any).findings)) return (asJson as any).findings;
  } catch {
    // fall through
  }

  const bracketStart = text.indexOf("[");
  const bracketEnd = text.lastIndexOf("]");
  if (bracketStart >= 0 && bracketEnd > bracketStart) {
    try {
      const arr = JSON.parse(text.slice(bracketStart, bracketEnd + 1));
      if (Array.isArray(arr)) return arr;
    } catch {
      // ignore
    }
  }
  return [];
}

function parseConflictsPayload(text: string): ConflictDraft[] {
  try {
    const asJson = JSON.parse(text);
    if (Array.isArray(asJson)) return asJson;
    if (Array.isArray((asJson as any).conflicts)) return (asJson as any).conflicts;
  } catch {
    // ignore
  }

  const bracketStart = text.indexOf("[");
  const bracketEnd = text.lastIndexOf("]");
  if (bracketStart >= 0 && bracketEnd > bracketStart) {
    try {
      const arr = JSON.parse(text.slice(bracketStart, bracketEnd + 1));
      if (Array.isArray(arr)) return arr;
    } catch {
      // ignore
    }
  }
  return [];
}

function stableHash(input: string) {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}

function makeFindingId(patientId: string, specialistId: string, raw: FindingDraft, idx: number) {
  const payload = JSON.stringify({ patientId, specialistId, raw, idx });
  return `finding-${specialistId}-${stableHash(payload)}`;
}

export function makeRunId(patientId: string, specialistId: string, rawText: string) {
  const payload = `${patientId}|${specialistId}|${rawText}`;
  return `run-${specialistId}-${stableHash(payload)}`;
}

function makeConflictId(raw: ConflictDraft, idx: number) {
  const payload = JSON.stringify({ raw, idx });
  return `conflict-${stableHash(payload)}`;
}

function makeFollowUpId(reason: string) {
  return `followup-${stableHash(reason)}`;
}

export function snapshotRuns(runs: SpecialistCoordinatorInstance["runs"]) {
  return runs.map((r) => getSnapshot(r));
}

export function snapshotFindings(instance: SpecialistCoordinatorInstance) {
  return instance.getAllFindings().map((f) => getSnapshot(f));
}

export function snapshotConflicts(instance: SpecialistCoordinatorInstance) {
  return instance.conflicts.map((c) => getSnapshot(c));
}

export function snapshotFollowUps(instance: SpecialistCoordinatorInstance) {
  return instance.followUps.map((f) => getSnapshot(f));
}
