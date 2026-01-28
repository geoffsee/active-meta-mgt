import { describe, test, expect } from "vitest";
import { Calibrator, type ScenarioDoc } from "./calibrate";

const minimalDoc: ScenarioDoc = {
    metaContext: { id: "test-ctx" },
};

const fullDoc: ScenarioDoc = {
    metaContext: { id: "full-ctx" },
    lanes: [{ id: "task", name: "Task Lane" }],
    goals: [
        { id: "g1", title: "Ship feature", priority: "p0", tags: [{ key: "lane", value: "task" }] },
    ],
    constraints: [
        { id: "c1", statement: "Must use TypeScript", tags: [{ key: "lane", value: "task" }] },
    ],
    evidence: [
        { id: "e1", summary: "Users requested this", severity: "high", tags: [{ key: "lane", value: "task" }] },
    ],
    decisions: [
        { id: "d1", statement: "Use MobX-State-Tree", rationale: "Proven pattern", tags: [{ key: "lane", value: "task" }] },
    ],
};

describe("Calibrator", () => {
    test("constructor creates context with correct id", () => {
        const cal = new Calibrator(minimalDoc);
        expect(cal.ctx.id).toBe("test-ctx");
    });

    test("fromYaml parses YAML and creates instance", () => {
        const yaml = `
metaContext:
  id: yaml-ctx
`;
        const cal = Calibrator.fromYaml(yaml);
        expect(cal.ctx.id).toBe("yaml-ctx");
    });

    test("loadLanes registers lanes on context", () => {
        const cal = new Calibrator(fullDoc).loadLanes();
        expect(cal.ctx.lanes.has("task")).toBe(true);
    });

    test("loadLanes is a no-op when no lanes defined", () => {
        const cal = new Calibrator(minimalDoc).loadLanes();
        // default lanes from makeDefaultActiveMetaContext still present
        expect(cal.ctx.lanes.size).toBeGreaterThan(0);
    });

    test("loadKnowledgeObjects upserts goals", () => {
        const cal = new Calibrator(fullDoc).loadKnowledgeObjects();
        expect(cal.ctx.goals.has("g1")).toBe(true);
    });

    test("loadKnowledgeObjects upserts constraints", () => {
        const cal = new Calibrator(fullDoc).loadKnowledgeObjects();
        expect(cal.ctx.constraints.has("c1")).toBe(true);
    });

    test("loadKnowledgeObjects upserts evidence", () => {
        const cal = new Calibrator(fullDoc).loadKnowledgeObjects();
        expect(cal.ctx.evidence.has("e1")).toBe(true);
    });

    test("loadKnowledgeObjects upserts decisions", () => {
        const cal = new Calibrator(fullDoc).loadKnowledgeObjects();
        expect(cal.ctx.decisions.has("d1")).toBe(true);
    });

    test("loadAll chains lanes and knowledge objects", () => {
        const cal = new Calibrator(fullDoc).loadAll();
        expect(cal.ctx.lanes.has("task")).toBe(true);
        expect(cal.ctx.goals.has("g1")).toBe(true);
        expect(cal.ctx.decisions.has("d1")).toBe(true);
    });

    test("loadAll returns this for chaining", () => {
        const cal = new Calibrator(minimalDoc);
        expect(cal.loadAll()).toBe(cal);
    });

    test("synthesize returns payload with workingMemory", () => {
        const cal = new Calibrator(fullDoc).loadAll();
        const payload = cal.synthesize();
        expect(payload).toHaveProperty("workingMemory");
        expect(typeof payload.workingMemory.text).toBe("string");
    });

    test("synthesize respects token budget parameter", () => {
        const cal = new Calibrator(fullDoc).loadAll();
        // should not throw with a small budget
        const payload = cal.synthesize(100);
        expect(payload.workingMemory.text).toBeDefined();
    });

    test("formatPayload includes section headers", () => {
        const cal = new Calibrator(fullDoc).loadAll();
        const payload = cal.synthesize();
        const output = cal.formatPayload(payload);
        expect(output).toContain("---- WORKING MEMORY ----");
        expect(output).toContain("---- DECISIONS ----");
    });

    test("formatPayload lists decisions with bullet prefix", () => {
        const cal = new Calibrator(fullDoc).loadAll();
        const payload = cal.synthesize();
        const output = cal.formatPayload(payload);
        for (const d of payload.decisions) {
            expect(output).toContain(`- ${d}`);
        }
    });

    test("run produces full formatted output end-to-end", () => {
        const cal = new Calibrator(fullDoc);
        const output = cal.run();
        expect(output).toContain("---- WORKING MEMORY ----");
        expect(output).toContain("---- DECISIONS ----");
    });

    test("run with empty doc produces output without errors", () => {
        const cal = new Calibrator(minimalDoc);
        const output = cal.run();
        expect(typeof output).toBe("string");
        expect(output).toContain("---- WORKING MEMORY ----");
    });
});
