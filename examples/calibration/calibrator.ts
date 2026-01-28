import {
    type Context, type Payload, type ScenarioDoc,
    parseScenario, createContext, loadLanes, loadKnowledgeObjects,
    synthesize, formatPayload,
} from "./utils";

/**
 * Orchestrates a calibration run: parses a YAML scenario, loads lanes and
 * knowledge objects into an {@link Context}, synthesizes working memory,
 * and formats the result.
 */
export class Calibrator {
    /** The underlying active meta context instance. */
    readonly ctx: Context;

    /** @param doc - A pre-parsed scenario document. */
    constructor(private doc: ScenarioDoc) {
        this.ctx = createContext(doc);
    }

    /**
     * Creates a {@link Calibrator} from raw YAML text.
     * @param yamlText - The YAML scenario content.
     */
    static fromYaml(yamlText: string): Calibrator {
        return new Calibrator(parseScenario(yamlText));
    }

    /** Registers scenario lanes into the context. */
    loadLanes(): this {
        loadLanes(this.ctx, this.doc.lanes);
        return this;
    }

    /** Upserts all knowledge objects from the scenario into the context. */
    loadKnowledgeObjects(): this {
        loadKnowledgeObjects(this.ctx, this.doc);
        return this;
    }

    /** Loads both lanes and knowledge objects. */
    loadAll(): this {
        return this.loadLanes().loadKnowledgeObjects();
    }

    /**
     * Synthesizes working memory and returns the LLM context payload.
     * @param tokenBudget - Maximum token budget for synthesis.
     */
    synthesize(tokenBudget = 400): Payload {
        return synthesize(this.ctx, tokenBudget);
    }

    /** Formats a payload into a human-readable string. */
    formatPayload(payload: Payload): string {
        return formatPayload(payload);
    }

    /**
     * Runs the full calibration pipeline: load, synthesize, and format.
     * @param tokenBudget - Maximum token budget for synthesis.
     */
    run(tokenBudget = 400): string {
        this.loadAll();
        return formatPayload(this.synthesize(tokenBudget));
    }
}
