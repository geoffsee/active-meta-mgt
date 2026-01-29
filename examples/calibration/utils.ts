import { makeDefaultActiveMetaContext } from "../../index";
import { yamlToJson } from "./yaml2json";

/** Describes a calibration scenario parsed from a YAML document. */
export interface ScenarioDoc {
    metaContext: { id: string };
    lanes?: { id: string; name: string }[];
    goals?: Record<string, unknown>[];
    constraints?: Record<string, unknown>[];
    assumptions?: Record<string, unknown>[];
    evidence?: Record<string, unknown>[];
    questions?: Record<string, unknown>[];
    decisions?: Record<string, unknown>[];
}

/** An instantiated ActiveMetaContext. */
export type Context = ReturnType<typeof makeDefaultActiveMetaContext>;
/** The LLM context payload produced by {@link Context.buildLLMContextPayload}. */
export type Payload = ReturnType<Context["buildLLMContextPayload"]>;

/**
 * Parses a YAML scenario document into a typed {@link ScenarioDoc}.
 * @param yamlText - Raw YAML content.
 */
export function parseScenario(yamlText: string): ScenarioDoc {
    return JSON.parse(yamlToJson(yamlText)) as ScenarioDoc;
}

/**
 * Creates a new {@link Context} from a scenario document's `metaContext.id`.
 * @param doc - The parsed scenario document.
 */
export function createContext(doc: ScenarioDoc): Context {
    return makeDefaultActiveMetaContext(doc.metaContext.id);
}

/**
 * Registers lanes from the scenario into the context.
 * @param ctx - The active meta context.
 * @param lanes - Lane definitions from the scenario document.
 */
export function loadLanes(ctx: Context, lanes: ScenarioDoc["lanes"]): void {
    for (const lane of lanes ?? []) {
        ctx.ensureLane(lane.id, lane.name);
    }
}

/**
 * Upserts all knowledge objects (goals, constraints, assumptions, evidence,
 * questions, decisions) from the scenario into the context.
 * @param ctx - The active meta context.
 * @param doc - The parsed scenario document.
 */
export function loadKnowledgeObjects(ctx: Context, doc: ScenarioDoc): void {
    for (const g of doc.goals ?? []) ctx.upsertGoal(g as any);
    for (const c of doc.constraints ?? []) ctx.upsertConstraint(c as any);
    for (const a of doc.assumptions ?? []) ctx.upsertAssumption(a as any);
    for (const e of doc.evidence ?? []) ctx.upsertEvidence(e as any);
    for (const q of doc.questions ?? []) ctx.upsertQuestion(q as any);
    for (const d of doc.decisions ?? []) ctx.upsertDecision(d as any);
}

/**
 * Runs lane synthesis and builds the LLM context payload.
 * @param ctx - The active meta context.
 * @param tokenBudget - Maximum token budget for working memory synthesis.
 */
export function synthesize(ctx: Context, tokenBudget = 400): Payload {
    ctx.synthesizeFromLanes({ tokenBudget });
    return ctx.buildLLMContextPayload();
}

/**
 * Formats an LLM context payload into a human-readable string with
 * working memory and decisions sections.
 * @param payload - The payload returned by {@link synthesize}.
 */
export function formatPayload(payload: Payload): string {
    const lines: string[] = [];
    lines.push("---- WORKING MEMORY ----\n");
    lines.push(payload.workingMemory.text);
    lines.push("\n---- DECISIONS ----\n");
    for (const d of payload.decisions) {
        lines.push(`- ${d}`);
    }
    return lines.join("\n");
}