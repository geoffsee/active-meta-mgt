import { describe, test, expect } from "vitest";
import { Calibrator } from "./calibrator";
import type { ScenarioDoc } from "./utils";

const minimalDoc: ScenarioDoc = {
    metaContext: { id: "cal-test" },
};

const fullDoc: ScenarioDoc = {
    metaContext: { id: "cal-full" },
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
        { id: "d1", statement: "Use MST", rationale: "Proven pattern", tags: [{ key: "lane", value: "task" }] },
    ],
};

describe("Calibrator", () => {
    describe("constructor", () => {
        test("creates context with correct id", () => {
            const cal = new Calibrator(minimalDoc);
            expect(cal.ctx.id).toBe("cal-test");
        });
    });

    describe("fromYaml", () => {
        test("parses YAML and creates instance", () => {
            const cal = Calibrator.fromYaml("metaContext:\n  id: from-yaml");
            expect(cal.ctx.id).toBe("from-yaml");
        });
    });

    describe("loadLanes", () => {
        test("registers lanes on context", () => {
            const cal = new Calibrator(fullDoc).loadLanes();
            expect(cal.ctx.lanes.has("task")).toBe(true);
        });

        test("returns this for chaining", () => {
            const cal = new Calibrator(minimalDoc);
            expect(cal.loadLanes()).toBe(cal);
        });
    });

    describe("loadKnowledgeObjects", () => {
        test("upserts all object types", () => {
            const cal = new Calibrator(fullDoc).loadKnowledgeObjects();
            expect(cal.ctx.goals.has("g1")).toBe(true);
            expect(cal.ctx.constraints.has("c1")).toBe(true);
            expect(cal.ctx.evidence.has("e1")).toBe(true);
            expect(cal.ctx.decisions.has("d1")).toBe(true);
        });

        test("returns this for chaining", () => {
            const cal = new Calibrator(minimalDoc);
            expect(cal.loadKnowledgeObjects()).toBe(cal);
        });
    });

    describe("loadAll", () => {
        test("loads both lanes and knowledge objects", () => {
            const cal = new Calibrator(fullDoc).loadAll();
            expect(cal.ctx.lanes.has("task")).toBe(true);
            expect(cal.ctx.goals.has("g1")).toBe(true);
        });

        test("returns this for chaining", () => {
            const cal = new Calibrator(minimalDoc);
            expect(cal.loadAll()).toBe(cal);
        });
    });

    describe("synthesize", () => {
        test("returns payload with workingMemory", () => {
            const cal = new Calibrator(fullDoc).loadAll();
            const payload = cal.synthesize();
            expect(typeof payload.workingMemory.text).toBe("string");
        });

        test("accepts custom token budget", () => {
            const cal = new Calibrator(fullDoc).loadAll();
            const payload = cal.synthesize(100);
            expect(payload.workingMemory.text).toBeDefined();
        });
    });

    describe("formatPayload", () => {
        test("includes section headers", () => {
            const cal = new Calibrator(fullDoc).loadAll();
            const payload = cal.synthesize();
            const output = cal.formatPayload(payload);
            expect(output).toContain("---- WORKING MEMORY ----");
            expect(output).toContain("---- DECISIONS ----");
        });
    });

    describe("run", () => {
        test("produces full formatted output end-to-end", () => {
            const output = new Calibrator(fullDoc).run();
            expect(output).toContain("---- WORKING MEMORY ----");
            expect(output).toContain("---- DECISIONS ----");
        });

        test("works with empty doc", () => {
            const output = new Calibrator(minimalDoc).run();
            expect(typeof output).toBe("string");
            expect(output).toContain("---- WORKING MEMORY ----");
        });

        test("accepts custom token budget", () => {
            const output = new Calibrator(fullDoc).run(200);
            expect(output).toContain("---- WORKING MEMORY ----");
        });
    });
});
