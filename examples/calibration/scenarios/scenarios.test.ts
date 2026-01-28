import { describe, test, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { Calibrator } from "../calibrator";
import { parseScenario, type ScenarioDoc } from "../utils";
import type { HookEvent } from "active-meta-mgt";

function loadScenario(name: string): ScenarioDoc {
    const filePath = resolve(__dirname, `${name}.yaml`);
    return parseScenario(readFileSync(filePath, "utf-8"));
}

describe("deterministic scenario: empty", () => {
    const doc = loadScenario("empty");

    test("creates context with correct id", () => {
        const cal = new Calibrator(doc);
        expect(cal.ctx.id).toBe("scenario-empty");
    });

    test("run produces output with no knowledge objects", () => {
        const output = new Calibrator(doc).run();
        expect(output).toContain("---- WORKING MEMORY ----");
        expect(output).toContain("---- DECISIONS ----");
    });

    test("payload has zero selected items", () => {
        const cal = new Calibrator(doc);
        cal.loadAll();
        const payload = cal.synthesize();
        expect(payload.selectedCount).toBe(0);
        expect(payload.goals).toEqual([]);
        expect(payload.evidence).toEqual([]);
        expect(payload.decisions).toEqual([]);
    });
});

describe("deterministic scenario: single-lane", () => {
    const doc = loadScenario("single-lane");

    test("creates context with correct id", () => {
        const cal = new Calibrator(doc);
        expect(cal.ctx.id).toBe("scenario-single-lane");
    });

    test("loads all knowledge objects", () => {
        const cal = new Calibrator(doc);
        cal.loadAll();
        expect(cal.ctx.goals.has("g1")).toBe(true);
        expect(cal.ctx.constraints.has("c1")).toBe(true);
        expect(cal.ctx.evidence.has("e1")).toBe(true);
        expect(cal.ctx.decisions.has("d1")).toBe(true);
    });

    test("task lane is registered", () => {
        const cal = new Calibrator(doc);
        cal.loadAll();
        expect(cal.ctx.lanes.has("task")).toBe(true);
    });

    test("synthesis selects all 4 items into active window", () => {
        const cal = new Calibrator(doc);
        cal.loadAll();
        const payload = cal.synthesize();
        expect(payload.selectedCount).toBe(4);
    });

    test("payload contains expected summaries", () => {
        const cal = new Calibrator(doc);
        cal.loadAll();
        const payload = cal.synthesize();
        expect(payload.goals).toContain("Deliver MVP by end of sprint");
        expect(payload.constraints).toContain("No external API calls in the hot path");
        expect(payload.evidence).toContain("Latency p99 exceeds 200ms under load");
        expect(payload.decisions).toContain("Use in-memory cache instead of Redis");
    });

    test("working memory text is deterministic across runs", () => {
        const run1 = new Calibrator(doc);
        run1.loadAll();
        const p1 = run1.synthesize();

        const run2 = new Calibrator(doc);
        run2.loadAll();
        const p2 = run2.synthesize();

        expect(p1.workingMemory.text).toBe(p2.workingMemory.text);
    });

    test("working memory groups items by kind", () => {
        const cal = new Calibrator(doc);
        cal.loadAll();
        const payload = cal.synthesize();
        const wm = payload.workingMemory.text;
        expect(wm).toContain("Goals:");
        expect(wm).toContain("Constraints:");
        expect(wm).toContain("Evidence:");
        expect(wm).toContain("Decisions:");
    });

    test("formatted output includes decisions section", () => {
        const output = new Calibrator(doc).run();
        expect(output).toContain("Use in-memory cache instead of Redis");
    });
});

describe("deterministic scenario: multi-lane", () => {
    const doc = loadScenario("multi-lane");

    test("creates context with correct id", () => {
        const cal = new Calibrator(doc);
        expect(cal.ctx.id).toBe("scenario-multi-lane");
    });

    test("both lanes are registered", () => {
        const cal = new Calibrator(doc);
        cal.loadAll();
        expect(cal.ctx.lanes.has("task")).toBe(true);
        expect(cal.ctx.lanes.has("legal")).toBe(true);
    });

    test("all knowledge objects are loaded", () => {
        const cal = new Calibrator(doc);
        cal.loadAll();
        expect(cal.ctx.goals.size).toBe(2);
        expect(cal.ctx.constraints.size).toBe(1);
        expect(cal.ctx.assumptions.size).toBe(1);
        expect(cal.ctx.evidence.size).toBe(2);
        expect(cal.ctx.questions.size).toBe(1);
        expect(cal.ctx.decisions.size).toBe(2);
    });

    test("synthesis selects items from both lanes", () => {
        const cal = new Calibrator(doc);
        cal.loadAll();
        const payload = cal.synthesize();
        // All 9 items should be selected (both lanes are enabled by default)
        expect(payload.selectedCount).toBe(9);
    });

    test("payload includes items from task and legal lanes", () => {
        const cal = new Calibrator(doc);
        cal.loadAll();
        const payload = cal.synthesize();
        // task lane items
        expect(payload.goals).toContain("Ship GDPR compliance module");
        expect(payload.decisions).toContain("Use phased rollout for compliance module");
        // legal lane items
        expect(payload.goals).toContain("Pass legal audit by Q3");
        expect(payload.constraints).toContain("PII must be encrypted at rest");
        expect(payload.evidence).toContain("Audit found unencrypted PII in logs");
    });

    test("working memory text is deterministic across runs", () => {
        const run1 = new Calibrator(doc);
        run1.loadAll();
        const p1 = run1.synthesize();

        const run2 = new Calibrator(doc);
        run2.loadAll();
        const p2 = run2.synthesize();

        expect(p1.workingMemory.text).toBe(p2.workingMemory.text);
    });

    test("working memory includes all knowledge object kinds", () => {
        const cal = new Calibrator(doc);
        cal.loadAll();
        const payload = cal.synthesize();
        const wm = payload.workingMemory.text;
        expect(wm).toContain("Goals:");
        expect(wm).toContain("Constraints:");
        expect(wm).toContain("Decisions:");
        expect(wm).toContain("Evidence:");
        expect(wm).toContain("Assumptions:");
        expect(wm).toContain("Open questions:");
    });

    test("critical evidence appears in working memory", () => {
        const cal = new Calibrator(doc);
        cal.loadAll();
        const payload = cal.synthesize();
        expect(payload.workingMemory.text).toContain("Audit found unencrypted PII in logs");
    });

    test("token budget constrains output length", () => {
        const cal = new Calibrator(doc);
        cal.loadAll();
        const small = cal.synthesize(50);
        const large = new Calibrator(doc);
        large.loadAll();
        const largePl = large.synthesize(2000);
        expect(small.workingMemory.text.length).toBeLessThanOrEqual(
            largePl.workingMemory.text.length,
        );
    });
});

// ── Lifecycle events ──

describe("lifecycle events: single-lane scenario", () => {
    const doc = loadScenario("single-lane");

    test("loadKnowledgeObjects emits knowledgeObject:upserted for each item", () => {
        const cal = new Calibrator(doc);
        cal.loadLanes();

        const upserted: HookEvent[] = [];
        cal.ctx.hooks.on("knowledgeObject:upserted", (e) => upserted.push(e));
        cal.loadKnowledgeObjects();

        expect(upserted).toHaveLength(4); // g1, c1, e1, d1
        const kinds = upserted.map((e) => (e as any).kind).sort();
        expect(kinds).toEqual(["constraint", "decision", "evidence", "goal"]);
        for (const e of upserted) {
            expect((e as any).isNew).toBe(true);
        }
    });

    test("loadLanes does not emit lane:created for pre-existing default lanes", () => {
        const cal = new Calibrator(doc);
        const created: HookEvent[] = [];
        cal.ctx.hooks.on("lane:created", (e) => created.push(e));
        cal.loadLanes();

        // "task" already exists in the default context, so no lane:created fires
        expect(created).toHaveLength(0);
    });

    test("loadLanes emits lane:created for a novel lane id", () => {
        const cal = new Calibrator(doc);
        const created: any[] = [];
        cal.ctx.hooks.on("lane:created", (e) => created.push(e));
        cal.ctx.ensureLane("brand-new", "Brand New Lane");

        expect(created).toHaveLength(1);
        expect(created[0].laneId).toBe("brand-new");
        expect(created[0].name).toBe("Brand New Lane");
    });

    test("synthesize emits lanes:refreshedAll, activeWindow:merged, archive:created, workingMemory:synthesized", () => {
        const cal = new Calibrator(doc);
        cal.loadAll();

        const events: HookEvent[] = [];
        cal.ctx.hooks.onAny((e) => events.push(e));
        cal.synthesize();

        const types = events.map((e) => e.type);
        // refreshAllLanes emits a single lanes:refreshedAll (not per-lane lane:refreshed)
        expect(types).toContain("lanes:refreshedAll");
        expect(types).toContain("activeWindow:merged");
        expect(types).toContain("archive:created");
        expect(types).toContain("workingMemory:synthesized");
    });

    test("event order during synthesize is refresh → merge → archive → synthesize", () => {
        const cal = new Calibrator(doc);
        cal.loadAll();

        const types: string[] = [];
        cal.ctx.hooks.onAny((e) => types.push(e.type));
        cal.synthesize();

        const relevant = types.filter((t) =>
            ["lanes:refreshedAll", "activeWindow:merged", "archive:created", "workingMemory:synthesized"].includes(t),
        );
        expect(relevant).toEqual([
            "lanes:refreshedAll",
            "activeWindow:merged",
            "archive:created",
            "workingMemory:synthesized",
        ]);
    });

    test("lanes:refreshedAll reports correct totalSelected", () => {
        const cal = new Calibrator(doc);
        cal.loadAll();

        let refreshAll: any;
        cal.ctx.hooks.on("lanes:refreshedAll", (e) => { refreshAll = e; });
        cal.synthesize();

        expect(refreshAll).toBeDefined();
        expect(refreshAll.totalSelected).toBe(4);
        expect(refreshAll.laneIds).toContain("task");
    });

    test("workingMemory:synthesized event contains token info", () => {
        const cal = new Calibrator(doc);
        cal.loadAll();

        let wmEvent: any;
        cal.ctx.hooks.once("workingMemory:synthesized", (e) => { wmEvent = e; });
        cal.synthesize(400);

        expect(wmEvent).toBeDefined();
        expect(wmEvent.tokenBudget).toBe(400);
        expect(typeof wmEvent.actualTokens).toBe("number");
        expect(wmEvent.actualTokens).toBeGreaterThan(0);
        expect(typeof wmEvent.text).toBe("string");
        expect(wmEvent.text.length).toBeGreaterThan(0);
    });

    test("re-upserting an item emits isNew=false", () => {
        const cal = new Calibrator(doc);
        cal.loadAll();

        const events: any[] = [];
        cal.ctx.hooks.on("knowledgeObject:upserted", (e) => events.push(e));

        // upsert same goal again
        cal.ctx.upsertGoal({
            id: "g1",
            title: "Deliver MVP by end of sprint (updated)",
            priority: "p0",
            tags: [{ key: "lane", value: "task" }],
        });

        expect(events).toHaveLength(1);
        expect(events[0].isNew).toBe(false);
        expect(events[0].id).toBe("g1");
    });
});

describe("lifecycle events: multi-lane scenario", () => {
    const doc = loadScenario("multi-lane");

    test("lane:created does not fire for pre-existing default lanes", () => {
        const cal = new Calibrator(doc);
        const created: any[] = [];
        cal.ctx.hooks.on("lane:created", (e) => created.push(e));
        cal.loadLanes();

        // Both "task" and "legal" already exist in the default context
        expect(created).toHaveLength(0);
    });

    test("knowledgeObject:upserted fires for all 9 items", () => {
        const cal = new Calibrator(doc);
        cal.loadLanes();
        const events: any[] = [];
        cal.ctx.hooks.on("knowledgeObject:upserted", (e) => events.push(e));
        cal.loadKnowledgeObjects();

        expect(events).toHaveLength(9);
        const ids = events.map((e) => e.id).sort();
        expect(ids).toEqual(["a1", "c1", "d1", "d2", "e1", "e2", "g1", "g2", "q1"]);
    });

    test("lanes:refreshedAll lists all lane ids including default lanes", () => {
        const cal = new Calibrator(doc);
        cal.loadAll();

        let refreshAll: any;
        cal.ctx.hooks.on("lanes:refreshedAll", (e) => { refreshAll = e; });
        cal.synthesize();

        expect(refreshAll).toBeDefined();
        expect(refreshAll.laneIds).toContain("task");
        expect(refreshAll.laneIds).toContain("legal");
        expect(refreshAll.totalSelected).toBe(9);
    });

    test("activeWindow:merged lists both lanes in fromLanes", () => {
        const cal = new Calibrator(doc);
        cal.loadAll();

        let mergedEvent: any;
        cal.ctx.hooks.once("activeWindow:merged", (e) => { mergedEvent = e; });
        cal.synthesize();

        expect(mergedEvent).toBeDefined();
        expect(mergedEvent.fromLanes).toContain("task");
        expect(mergedEvent.fromLanes).toContain("legal");
        expect(mergedEvent.mergedCount).toBe(9);
    });

    test("all events have consistent contextId", () => {
        const cal = new Calibrator(doc);
        const events: HookEvent[] = [];
        cal.ctx.hooks.onAny((e) => events.push(e));

        cal.loadAll();
        cal.synthesize();

        expect(events.length).toBeGreaterThan(0);
        for (const e of events) {
            expect(e.contextId).toBe("scenario-multi-lane");
        }
    });

    test("all events have ISO timestamps in chronological order", () => {
        const cal = new Calibrator(doc);
        const timestamps: string[] = [];
        cal.ctx.hooks.onAny((e) => timestamps.push(e.timestamp));

        cal.loadAll();
        cal.synthesize();

        for (let i = 1; i < timestamps.length; i++) {
            expect(timestamps[i]! >= timestamps[i - 1]!).toBe(true);
        }
    });

    test("onAny captures every event that typed listeners see", () => {
        const cal = new Calibrator(doc);
        const all: string[] = [];
        const typed: string[] = [];

        cal.ctx.hooks.onAny((e) => all.push(`${e.type}:${Date.now()}`));
        cal.ctx.hooks.on("knowledgeObject:upserted", () => typed.push("ko"));
        cal.ctx.hooks.on("lane:created", () => typed.push("lc"));
        cal.ctx.hooks.on("lane:refreshed", () => typed.push("lr"));
        cal.ctx.hooks.on("workingMemory:synthesized", () => typed.push("wm"));

        cal.loadAll();
        cal.synthesize();

        // onAny should capture at least as many events as typed listeners
        expect(all.length).toBeGreaterThanOrEqual(typed.length);
    });

    test("offAll stops all event delivery", () => {
        const cal = new Calibrator(doc);
        cal.loadAll();

        const events: HookEvent[] = [];
        cal.ctx.hooks.onAny((e) => events.push(e));
        cal.ctx.hooks.offAll();

        cal.synthesize();
        expect(events).toHaveLength(0);
    });
});
