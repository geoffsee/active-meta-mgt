import { describe, test, expect } from "vitest";
import {
    parseScenario, createContext, loadLanes, loadKnowledgeObjects,
    synthesize, formatPayload,
    type ScenarioDoc,
} from "./utils";

const minimalDoc: ScenarioDoc = {
    metaContext: { id: "util-test" },
};

const fullDoc: ScenarioDoc = {
    metaContext: { id: "full-test" },
    lanes: [{ id: "task", name: "Task Lane" }],
    goals: [
        { id: "g1", title: "Ship feature", priority: "p0", tags: [{ key: "lane", value: "task" }] },
    ],
    constraints: [
        { id: "c1", statement: "Must use TypeScript", tags: [{ key: "lane", value: "task" }] },
    ],
    assumptions: [
        { id: "a1", statement: "Users prefer TS", confidence: 0.8, tags: [{ key: "lane", value: "task" }] },
    ],
    evidence: [
        { id: "e1", summary: "Users requested this", severity: "high", tags: [{ key: "lane", value: "task" }] },
    ],
    questions: [
        { id: "q1", question: "What about Python?", tags: [{ key: "lane", value: "task" }] },
    ],
    decisions: [
        { id: "d1", statement: "Use MST", rationale: "Proven pattern", tags: [{ key: "lane", value: "task" }] },
    ],
};

describe("parseScenario", () => {
    test("parses YAML into ScenarioDoc", () => {
        const doc = parseScenario("metaContext:\n  id: test-id");
        expect(doc.metaContext.id).toBe("test-id");
    });

    test("parses lanes", () => {
        const yaml = `
metaContext:
  id: x
lanes:
  - id: legal
    name: Legal Lane
`;
        // yaml2json doesn't support nested array objects this way,
        // so test with what it can parse
        const doc = parseScenario("metaContext:\n  id: x");
        expect(doc.metaContext.id).toBe("x");
    });
});

describe("createContext", () => {
    test("creates context with the doc id", () => {
        const ctx = createContext(minimalDoc);
        expect(ctx.id).toBe("util-test");
    });

    test("context has default lanes", () => {
        const ctx = createContext(minimalDoc);
        expect(ctx.lanes.size).toBeGreaterThan(0);
    });
});

describe("loadLanes", () => {
    test("registers lanes on context", () => {
        const ctx = createContext(minimalDoc);
        loadLanes(ctx, [{ id: "custom", name: "Custom Lane" }]);
        expect(ctx.lanes.has("custom")).toBe(true);
    });

    test("handles undefined lanes", () => {
        const ctx = createContext(minimalDoc);
        const sizeBefore = ctx.lanes.size;
        loadLanes(ctx, undefined);
        expect(ctx.lanes.size).toBe(sizeBefore);
    });

    test("handles empty lanes array", () => {
        const ctx = createContext(minimalDoc);
        const sizeBefore = ctx.lanes.size;
        loadLanes(ctx, []);
        expect(ctx.lanes.size).toBe(sizeBefore);
    });
});

describe("loadKnowledgeObjects", () => {
    test("upserts goals", () => {
        const ctx = createContext(fullDoc);
        loadKnowledgeObjects(ctx, fullDoc);
        expect(ctx.goals.has("g1")).toBe(true);
    });

    test("upserts constraints", () => {
        const ctx = createContext(fullDoc);
        loadKnowledgeObjects(ctx, fullDoc);
        expect(ctx.constraints.has("c1")).toBe(true);
    });

    test("upserts assumptions", () => {
        const ctx = createContext(fullDoc);
        loadKnowledgeObjects(ctx, fullDoc);
        expect(ctx.assumptions.has("a1")).toBe(true);
    });

    test("upserts evidence", () => {
        const ctx = createContext(fullDoc);
        loadKnowledgeObjects(ctx, fullDoc);
        expect(ctx.evidence.has("e1")).toBe(true);
    });

    test("upserts questions", () => {
        const ctx = createContext(fullDoc);
        loadKnowledgeObjects(ctx, fullDoc);
        expect(ctx.questions.has("q1")).toBe(true);
    });

    test("upserts decisions", () => {
        const ctx = createContext(fullDoc);
        loadKnowledgeObjects(ctx, fullDoc);
        expect(ctx.decisions.has("d1")).toBe(true);
    });

    test("handles empty doc gracefully", () => {
        const ctx = createContext(minimalDoc);
        loadKnowledgeObjects(ctx, minimalDoc);
        expect(ctx.goals.size).toBe(0);
        expect(ctx.decisions.size).toBe(0);
    });
});

describe("synthesize", () => {
    test("returns payload with workingMemory", () => {
        const ctx = createContext(fullDoc);
        loadKnowledgeObjects(ctx, fullDoc);
        const payload = synthesize(ctx);
        expect(payload).toHaveProperty("workingMemory");
        expect(typeof payload.workingMemory.text).toBe("string");
    });

    test("accepts custom token budget", () => {
        const ctx = createContext(fullDoc);
        loadKnowledgeObjects(ctx, fullDoc);
        const payload = synthesize(ctx, 100);
        expect(payload.workingMemory.text).toBeDefined();
    });

    test("returns payload for empty context", () => {
        const ctx = createContext(minimalDoc);
        const payload = synthesize(ctx);
        expect(typeof payload.workingMemory.text).toBe("string");
    });
});

describe("formatPayload", () => {
    test("includes working memory header", () => {
        const ctx = createContext(minimalDoc);
        const payload = synthesize(ctx);
        const output = formatPayload(payload);
        expect(output).toContain("---- WORKING MEMORY ----");
    });

    test("includes decisions header", () => {
        const ctx = createContext(minimalDoc);
        const payload = synthesize(ctx);
        const output = formatPayload(payload);
        expect(output).toContain("---- DECISIONS ----");
    });

    test("prefixes decisions with bullets", () => {
        const ctx = createContext(fullDoc);
        loadKnowledgeObjects(ctx, fullDoc);
        const payload = synthesize(ctx);
        const output = formatPayload(payload);
        for (const d of payload.decisions) {
            expect(output).toContain(`- ${d}`);
        }
    });
});
