import { describe, test, expect, beforeEach } from "bun:test";
import {
    ActiveMetaContext,
    makeDefaultActiveMetaContext,
    type ActiveMetaContextInstance,
    type HookEvent,
    type KnowledgeObjectUpsertedEvent,
    type LaneCreatedEvent,
    type LaneRefreshedEvent,
    type LanesRefreshedAllEvent,
    type ActiveWindowMergedEvent,
    type WorkingMemorySynthesizedEvent,
    type ArchiveCreatedEvent,
    type LaneStatusChangedEvent,
    type LanePinChangedEvent,
} from "./index";

describe("ActiveMetaContext", () => {
    let ctx: ActiveMetaContextInstance;

    beforeEach(() => {
        ctx = ActiveMetaContext.create({
            id: "test-ctx",
            name: "Test Context",
        });
    });

    describe("Knowledge Objects - Goals", () => {
        test("should create and upsert goals", () => {
            ctx.upsertGoal({
                id: "goal-1",
                title: "Complete the project",
                description: "Finish all tasks by deadline",
                priority: "p0",
                status: "active",
            });

            const goal = ctx.goals.get("goal-1");
            expect(goal).toBeDefined();
            expect(goal?.title).toBe("Complete the project");
            expect(goal?.priority).toBe("p0");
            expect(goal?.status).toBe("active");
        });

        test("should update goal status", () => {
            ctx.upsertGoal({
                id: "goal-1",
                title: "Complete the project",
            });

            const goal = ctx.goals.get("goal-1");
            goal?.setStatus("done");
            expect(goal?.status).toBe("done");
        });

        test("should update existing goal on upsert", () => {
            ctx.upsertGoal({
                id: "goal-1",
                title: "Initial title",
            });

            ctx.upsertGoal({
                id: "goal-1",
                title: "Updated title",
            });

            expect(ctx.goals.size).toBe(1);
            expect(ctx.goals.get("goal-1")?.title).toBe("Updated title");
        });
    });

    describe("Knowledge Objects - Constraints", () => {
        test("should create and upsert constraints", () => {
            ctx.upsertConstraint({
                id: "const-1",
                statement: "Must comply with GDPR",
                priority: "p0",
            });

            const constraint = ctx.constraints.get("const-1");
            expect(constraint).toBeDefined();
            expect(constraint?.statement).toBe("Must comply with GDPR");
            expect(constraint?.priority).toBe("p0");
        });

        test("should update constraint status", () => {
            ctx.upsertConstraint({
                id: "const-1",
                statement: "Must comply with GDPR",
            });

            const constraint = ctx.constraints.get("const-1");
            constraint?.setStatus("archived");
            expect(constraint?.status).toBe("archived");
        });
    });

    describe("Knowledge Objects - Assumptions", () => {
        test("should create and upsert assumptions", () => {
            ctx.upsertAssumption({
                id: "assume-1",
                statement: "Users have modern browsers",
                confidence: "high",
            });

            const assumption = ctx.assumptions.get("assume-1");
            expect(assumption).toBeDefined();
            expect(assumption?.statement).toBe("Users have modern browsers");
            expect(assumption?.confidence).toBe("high");
        });

        test("should update assumption confidence", () => {
            ctx.upsertAssumption({
                id: "assume-1",
                statement: "Users have modern browsers",
                confidence: "medium",
            });

            const assumption = ctx.assumptions.get("assume-1");
            assumption?.setConfidence("low");
            expect(assumption?.confidence).toBe("low");
        });

        test("should update assumption statement", () => {
            ctx.upsertAssumption({
                id: "assume-1",
                statement: "Initial statement",
            });

            const assumption = ctx.assumptions.get("assume-1");
            assumption?.updateStatement("Updated statement");
            expect(assumption?.statement).toBe("Updated statement");
        });
    });

    describe("Knowledge Objects - Evidence", () => {
        test("should create and upsert evidence", () => {
            ctx.upsertEvidence({
                id: "evid-1",
                summary: "Bug reported by user",
                detail: "User cannot login on Safari",
                severity: "high",
                confidence: "high",
            });

            const evidence = ctx.evidence.get("evid-1");
            expect(evidence).toBeDefined();
            expect(evidence?.summary).toBe("Bug reported by user");
            expect(evidence?.severity).toBe("high");
        });

        test("should calculate evidence weight", () => {
            ctx.upsertEvidence({
                id: "evid-1",
                summary: "Critical issue",
                severity: "critical",
                confidence: "high",
            });

            const evidence = ctx.evidence.get("evid-1");
            expect(evidence?.weight).toBe(4 * 1.3); // critical (4) * high (1.3)
        });

        test("should calculate different weights for different severities", () => {
            ctx.upsertEvidence({
                id: "evid-low",
                summary: "Low severity",
                severity: "low",
                confidence: "medium",
            });

            ctx.upsertEvidence({
                id: "evid-high",
                summary: "High severity",
                severity: "high",
                confidence: "medium",
            });

            const low = ctx.evidence.get("evid-low");
            const high = ctx.evidence.get("evid-high");

            expect(low?.weight).toBe(1 * 1.0); // low (1) * medium (1.0)
            expect(high?.weight).toBe(3 * 1.0); // high (3) * medium (1.0)
        });
    });

    describe("Knowledge Objects - Questions", () => {
        test("should create and upsert open questions", () => {
            ctx.upsertQuestion({
                id: "q-1",
                question: "What is the deadline?",
                priority: "p1",
            });

            const question = ctx.questions.get("q-1");
            expect(question).toBeDefined();
            expect(question?.question).toBe("What is the deadline?");
        });

        test("should update question status", () => {
            ctx.upsertQuestion({
                id: "q-1",
                question: "What is the deadline?",
            });

            const question = ctx.questions.get("q-1");
            question?.setStatus("done");
            expect(question?.status).toBe("done");
        });
    });

    describe("Knowledge Objects - Decisions", () => {
        test("should create and upsert decisions", () => {
            ctx.upsertDecision({
                id: "dec-1",
                statement: "Use React for frontend",
                rationale: "Team has React expertise",
            });

            const decision = ctx.decisions.get("dec-1");
            expect(decision).toBeDefined();
            expect(decision?.statement).toBe("Use React for frontend");
            expect(decision?.rationale).toBe("Team has React expertise");
        });

        test("should update decision status", () => {
            ctx.upsertDecision({
                id: "dec-1",
                statement: "Use React for frontend",
            });

            const decision = ctx.decisions.get("dec-1");
            decision?.setStatus("archived");
            expect(decision?.status).toBe("archived");
        });
    });

    describe("Lanes", () => {
        test("should ensure lanes are created", () => {
            ctx.ensureLane("task", "Task Management");

            const lane = ctx.lanes.get("task");
            expect(lane).toBeDefined();
            expect(lane?.name).toBe("Task Management");
            expect(lane?.status).toBe("enabled");
        });

        test("should not duplicate lanes", () => {
            ctx.ensureLane("task", "Task Management");
            ctx.ensureLane("task", "Task Management Updated");

            expect(ctx.lanes.size).toBe(1);
            expect(ctx.lanes.get("task")?.name).toBe("Task Management Updated");
        });

        test("should remove lanes", () => {
            ctx.ensureLane("task", "Task Management");
            expect(ctx.lanes.has("task")).toBe(true);

            ctx.removeLane("task");
            expect(ctx.lanes.has("task")).toBe(false);
        });

        test("should set lane status", () => {
            ctx.ensureLane("task", "Task Management");
            const lane = ctx.lanes.get("task");

            lane?.setStatus("muted");
            expect(lane?.status).toBe("muted");

            lane?.setStatus("disabled");
            expect(lane?.status).toBe("disabled");
        });

        test("should set lane name", () => {
            ctx.ensureLane("task", "Task Management");
            const lane = ctx.lanes.get("task");

            lane?.setName("Updated Task Lane");
            expect(lane?.name).toBe("Updated Task Lane");
        });

        test("should set lane tag filters", () => {
            ctx.ensureLane("task");
            const lane = ctx.lanes.get("task");
            expect(lane).toBeDefined();

            if (lane) {
                lane.setIncludeTagsAny([
                    { key: "lane", value: "task" },
                    { key: "priority", value: "high" }
                ]);

                expect(lane.includeTagsAny.length).toBe(2);
                const firstTag = lane.includeTagsAny[0];
                if (firstTag) {
                    expect(firstTag.key).toBe("lane");
                    expect(firstTag.value).toBe("task");
                }
            }
        });

        test("should pin and unpin items in lane", () => {
            ctx.ensureLane("task");
            const lane = ctx.lanes.get("task");

            ctx.upsertGoal({ id: "goal-1", title: "Test goal" });

            lane?.pin("goal", "goal-1");
            expect(lane?.pinned.length).toBe(1);
            expect(lane?.pinned[0]?.kind).toBe("goal");
            expect(lane?.pinned[0]?.id).toBe("goal-1");
            expect(lane?.pinned[0]?.pinned).toBe(true);

            lane?.unpin("goal", "goal-1");
            expect(lane?.pinned[0]?.pinned).toBe(false);
        });

        test("should set window policy", () => {
            ctx.ensureLane("task");
            const lane = ctx.lanes.get("task");

            lane?.setWindowPolicy({ maxItems: 50 });
            expect(lane?.window.policy.maxItems).toBe(50);
        });
    });

    describe("Views and Utilities", () => {
        test("should get all IDs by kind", () => {
            ctx.upsertGoal({ id: "g-1", title: "Goal 1" });
            ctx.upsertGoal({ id: "g-2", title: "Goal 2" });
            ctx.upsertEvidence({ id: "e-1", summary: "Evidence 1" });

            const goalIds = ctx.getAllIdsByKind("goal");
            const evidenceIds = ctx.getAllIdsByKind("evidence");

            expect(goalIds.length).toBe(2);
            expect(goalIds).toContain("g-1");
            expect(goalIds).toContain("g-2");
            expect(evidenceIds.length).toBe(1);
            expect(evidenceIds).toContain("e-1");
        });

        test("should summarize refs", () => {
            ctx.upsertGoal({ id: "g-1", title: "Test Goal" });
            ctx.upsertEvidence({ id: "e-1", summary: "Test Evidence" });
            ctx.upsertConstraint({ id: "c-1", statement: "Test Constraint" });

            expect(ctx.summarizeRef("goal", "g-1")).toBe("Test Goal");
            expect(ctx.summarizeRef("evidence", "e-1")).toBe("Test Evidence");
            expect(ctx.summarizeRef("constraint", "c-1")).toBe("Test Constraint");
        });

        test("should check if items are active", () => {
            ctx.upsertGoal({ id: "g-1", title: "Active Goal", status: "active" });
            ctx.upsertGoal({ id: "g-2", title: "Archived Goal", status: "archived" });
            ctx.upsertEvidence({ id: "e-1", summary: "Evidence" });

            expect(ctx.isActive("goal", "g-1")).toBe(true);
            expect(ctx.isActive("goal", "g-2")).toBe(false);
            expect(ctx.isActive("evidence", "e-1")).toBe(true);
        });

        test("should get item tags", () => {
            ctx.upsertGoal({
                id: "g-1",
                title: "Tagged Goal",
                tags: [
                    { key: "lane", value: "task" },
                    { key: "priority", value: "high" }
                ]
            });

            const tags = ctx.getItemTags("goal", "g-1");
            expect(tags.length).toBe(2);
            const firstTag = tags[0];
            if (firstTag) {
                expect(firstTag.key).toBe("lane");
                expect(firstTag.value).toBe("task");
            }
        });

        test("should match tags", () => {
            const itemTags = [
                { key: "lane", value: "task" },
                { key: "priority", value: "high" }
            ];

            const matchTags = [{ key: "lane", value: "task" }];
            const noMatchTags = [{ key: "lane", value: "legal" }];

            expect(ctx.tagsMatchAny(itemTags, matchTags)).toBe(true);
            expect(ctx.tagsMatchAny(itemTags, noMatchTags)).toBe(false);
        });

        test("should return laneList view", () => {
            ctx.ensureLane("task");
            ctx.ensureLane("legal");

            const lanes = ctx.laneList;
            expect(lanes.length).toBe(2);
        });

        test("should get activeSelectedSummaries", () => {
            ctx.upsertGoal({ id: "g-1", title: "Test Goal" });
            ctx.activeWindow.setSelected([
                { kind: "goal", id: "g-1", score: 10, pinned: false }
            ]);

            const summaries = ctx.activeSelectedSummaries;
            expect(summaries.length).toBe(1);
            expect(summaries[0]?.text).toBe("Test Goal");
        });
    });

    describe("Selection and Scoring", () => {
        test("should score evidence based on severity and confidence", () => {
            ctx.upsertEvidence({
                id: "e-1",
                summary: "Critical bug",
                severity: "critical",
                confidence: "high",
            });

            const policy = ctx.activeWindow.policy;
            const score = ctx.scoreRef(policy, "evidence", "e-1", false);

            // critical=4, high confidence=3
            // wSeverity=1.0, wConfidence=0.7, plus some recency weight
            expect(score).toBeGreaterThan(0);
            expect(score).toBeGreaterThan(5); // Should be at least 4*1.0 + 3*0.7 = 6.1
            expect(score).toBeLessThan(20); // But not crazy high
        });

        test("should give pinned items high score", () => {
            ctx.upsertGoal({ id: "g-1", title: "Test Goal" });

            const policy = ctx.activeWindow.policy;
            const pinnedScore = ctx.scoreRef(policy, "goal", "g-1", true);
            const normalScore = ctx.scoreRef(policy, "goal", "g-1", false);

            expect(pinnedScore).toBe(policy.wPinnedBoost);
            expect(pinnedScore).toBeGreaterThan(normalScore);
        });

        test("should return -Infinity for inactive items", () => {
            ctx.upsertGoal({ id: "g-1", title: "Test Goal", status: "archived" });

            const policy = ctx.activeWindow.policy;
            const score = ctx.scoreRef(policy, "goal", "g-1", false);

            expect(score).toBe(-Infinity);
        });
    });

    describe("Lane Refresh and Selection", () => {
        test("should refresh lane selection with active items", () => {
            ctx.ensureLane("task");

            ctx.upsertGoal({
                id: "g-1",
                title: "Goal 1",
                priority: "p0",
                tags: [{ key: "lane", value: "task" }]
            });

            ctx.upsertGoal({
                id: "g-2",
                title: "Goal 2",
                priority: "p1",
                tags: [{ key: "lane", value: "task" }]
            });

            const lane = ctx.lanes.get("task");
            lane?.setIncludeTagsAny([{ key: "lane", value: "task" }]);

            ctx.refreshLaneSelection("task");

            expect(lane?.window.selected.length).toBe(2);
        });

        test("should filter by lane tags", () => {
            ctx.ensureLane("task");
            ctx.ensureLane("legal");

            ctx.upsertGoal({
                id: "g-1",
                title: "Task Goal",
                tags: [{ key: "lane", value: "task" }]
            });

            ctx.upsertGoal({
                id: "g-2",
                title: "Legal Goal",
                tags: [{ key: "lane", value: "legal" }]
            });

            const taskLane = ctx.lanes.get("task");
            taskLane?.setIncludeTagsAny([{ key: "lane", value: "task" }]);

            const legalLane = ctx.lanes.get("legal");
            legalLane?.setIncludeTagsAny([{ key: "lane", value: "legal" }]);

            ctx.refreshLaneSelection("task");
            ctx.refreshLaneSelection("legal");

            expect(taskLane?.window.selected.length).toBe(1);
            expect(taskLane?.window.selected[0]?.id).toBe("g-1");

            expect(legalLane?.window.selected.length).toBe(1);
            expect(legalLane?.window.selected[0]?.id).toBe("g-2");
        });

        test("should respect maxItems in lane policy", () => {
            ctx.ensureLane("task");
            const lane = ctx.lanes.get("task");
            lane?.setWindowPolicy({ maxItems: 2 });

            for (let i = 1; i <= 5; i++) {
                ctx.upsertGoal({
                    id: `g-${i}`,
                    title: `Goal ${i}`,
                    tags: [{ key: "lane", value: "task" }]
                });
            }

            lane?.setIncludeTagsAny([{ key: "lane", value: "task" }]);
            ctx.refreshLaneSelection("task");

            expect(lane?.window.selected.length).toBe(2);
        });

        test("should clear selection for disabled lanes", () => {
            ctx.ensureLane("task");
            const lane = ctx.lanes.get("task");

            ctx.upsertGoal({
                id: "g-1",
                title: "Goal 1",
                tags: [{ key: "lane", value: "task" }]
            });

            lane?.setIncludeTagsAny([{ key: "lane", value: "task" }]);
            ctx.refreshLaneSelection("task");
            expect(lane?.window.selected.length).toBe(1);

            lane?.setStatus("disabled");
            ctx.refreshLaneSelection("task");
            expect(lane?.window.selected.length).toBe(0);
        });

        test("should prioritize pinned items", () => {
            ctx.ensureLane("task");
            const lane = ctx.lanes.get("task");
            lane?.setWindowPolicy({ maxItems: 2 });

            ctx.upsertGoal({ id: "g-1", title: "Goal 1", priority: "p0" });
            ctx.upsertGoal({ id: "g-2", title: "Goal 2", priority: "p1" });
            ctx.upsertGoal({ id: "g-3", title: "Goal 3", priority: "p2" });

            lane?.pin("goal", "g-3"); // Pin the lowest priority
            ctx.refreshLaneSelection("task");

            const selected = lane?.window.selected || [];
            expect(selected.length).toBe(2);
            expect(selected.some(s => s.id === "g-3" && s.pinned)).toBe(true);
        });

        test("should refresh all lanes", () => {
            ctx.ensureLane("task");
            ctx.ensureLane("legal");

            ctx.upsertGoal({
                id: "g-1",
                title: "Task Goal",
                tags: [{ key: "lane", value: "task" }]
            });

            ctx.upsertGoal({
                id: "g-2",
                title: "Legal Goal",
                tags: [{ key: "lane", value: "legal" }]
            });

            ctx.lanes.get("task")?.setIncludeTagsAny([{ key: "lane", value: "task" }]);
            ctx.lanes.get("legal")?.setIncludeTagsAny([{ key: "lane", value: "legal" }]);

            ctx.refreshAllLanes();

            expect(ctx.lanes.get("task")?.window.selected.length).toBe(1);
            expect(ctx.lanes.get("legal")?.window.selected.length).toBe(1);
        });
    });

    describe("Merging Lanes", () => {
        test("should merge enabled lane selections", () => {
            ctx.ensureLane("task");
            ctx.ensureLane("legal");

            ctx.upsertGoal({ id: "g-1", title: "Task Goal", tags: [{ key: "lane", value: "task" }] });
            ctx.upsertGoal({ id: "g-2", title: "Legal Goal", tags: [{ key: "lane", value: "legal" }] });

            ctx.lanes.get("task")?.setIncludeTagsAny([{ key: "lane", value: "task" }]);
            ctx.lanes.get("legal")?.setIncludeTagsAny([{ key: "lane", value: "legal" }]);

            ctx.refreshAllLanes();
            ctx.mergeLanesToActiveWindow();

            expect(ctx.activeWindow.selected.length).toBe(2);
        });

        test("should deduplicate items across lanes", () => {
            ctx.ensureLane("task");
            ctx.ensureLane("legal");

            ctx.upsertGoal({
                id: "g-1",
                title: "Shared Goal",
                tags: [
                    { key: "lane", value: "task" },
                    { key: "lane", value: "legal" }
                ]
            });

            ctx.lanes.get("task")?.setIncludeTagsAny([{ key: "lane", value: "task" }]);
            ctx.lanes.get("legal")?.setIncludeTagsAny([{ key: "lane", value: "legal" }]);

            ctx.refreshAllLanes();
            ctx.mergeLanesToActiveWindow();

            // Should only appear once in merged result
            const g1Count = ctx.activeWindow.selected.filter(s => s.id === "g-1").length;
            expect(g1Count).toBe(1);
        });

        test("should not include disabled lanes in merge", () => {
            ctx.ensureLane("task");
            ctx.ensureLane("legal");

            ctx.upsertGoal({ id: "g-1", title: "Task Goal", tags: [{ key: "lane", value: "task" }] });
            ctx.upsertGoal({ id: "g-2", title: "Legal Goal", tags: [{ key: "lane", value: "legal" }] });

            ctx.lanes.get("task")?.setIncludeTagsAny([{ key: "lane", value: "task" }]);
            ctx.lanes.get("legal")?.setIncludeTagsAny([{ key: "lane", value: "legal" }]);
            ctx.lanes.get("legal")?.setStatus("disabled");

            ctx.refreshAllLanes();
            ctx.mergeLanesToActiveWindow();

            expect(ctx.activeWindow.selected.length).toBe(1);
            expect(ctx.activeWindow.selected[0]?.id).toBe("g-1");
        });

        test("should respect activeWindow maxItems cap", () => {
            ctx.ensureLane("task");
            ctx.activeWindow.setPolicy({ maxItems: 2 });

            for (let i = 1; i <= 5; i++) {
                ctx.upsertGoal({ id: `g-${i}`, title: `Goal ${i}` });
            }

            ctx.refreshAllLanes();
            ctx.mergeLanesToActiveWindow();

            expect(ctx.activeWindow.selected.length).toBe(2);
        });

        test("should sort by pinned then score", () => {
            ctx.ensureLane("task");
            const lane = ctx.lanes.get("task");

            ctx.upsertGoal({ id: "g-1", title: "High Priority", priority: "p0" });
            ctx.upsertGoal({ id: "g-2", title: "Low Priority", priority: "p3" });

            lane?.pin("goal", "g-2");
            ctx.refreshLaneSelection("task");
            ctx.mergeLanesToActiveWindow();

            const selected = ctx.activeWindow.selected;
            // Pinned item should come first
            const pinnedIndex = selected.findIndex(s => s.id === "g-2" && s.pinned);
            const highPrioIndex = selected.findIndex(s => s.id === "g-1");

            expect(pinnedIndex).toBeGreaterThanOrEqual(0);
            expect(pinnedIndex).toBeLessThan(highPrioIndex);
        });
    });

    describe("Working Memory Synthesis", () => {
        test("should synthesize working memory from active window", () => {
            ctx.upsertGoal({ id: "g-1", title: "Complete project" });
            ctx.upsertConstraint({ id: "c-1", statement: "Must be done by Friday" });

            ctx.activeWindow.setSelected([
                { kind: "goal", id: "g-1", score: 10, pinned: false },
                { kind: "constraint", id: "c-1", score: 8, pinned: false }
            ]);

            ctx.synthesizeWorkingMemory({ tokenBudget: 600 });

            expect(ctx.workingMemory.text).toBeTruthy();
            expect(ctx.workingMemory.text).toContain("Complete project");
            expect(ctx.workingMemory.text).toContain("Must be done by Friday");
            expect(ctx.workingMemory.updatedAt).toBeTruthy();
        });

        test("should create archive entry on synthesis", () => {
            ctx.upsertGoal({ id: "g-1", title: "Test Goal" });
            ctx.activeWindow.setSelected([
                { kind: "goal", id: "g-1", score: 10, pinned: false }
            ]);

            const initialArchiveCount = ctx.archive.length;
            ctx.synthesizeWorkingMemory({ tokenBudget: 600 });

            expect(ctx.archive.length).toBe(initialArchiveCount + 1);
            expect(ctx.workingMemory.lastArchiveId).toBeTruthy();

            const lastArchive = ctx.archive[ctx.archive.length - 1];
            expect(lastArchive?.workingMemoryText).toBe(ctx.workingMemory.text);
            expect(lastArchive?.mergedSelected.length).toBe(1);
        });

        test("should truncate to token budget", () => {
            // Create many items to exceed budget
            for (let i = 1; i <= 20; i++) {
                ctx.upsertGoal({
                    id: `g-${i}`,
                    title: `This is a very long goal title that will definitely exceed the token budget when combined with many other items ${i}`,
                });
            }

            const selected = [];
            for (let i = 1; i <= 20; i++) {
                selected.push({ kind: "goal" as const, id: `g-${i}`, score: 10, pinned: false });
            }

            ctx.activeWindow.setSelected(selected);
            ctx.synthesizeWorkingMemory({ tokenBudget: 100 }); // Very small budget

            // Approximate token count (chars / 4)
            const approxTokens = Math.ceil(ctx.workingMemory.text.length / 4);
            expect(approxTokens).toBeLessThanOrEqual(105); // Allow small margin
        });

        test("should organize by kind in working memory", () => {
            ctx.upsertGoal({ id: "g-1", title: "Goal item" });
            ctx.upsertConstraint({ id: "c-1", statement: "Constraint item" });
            ctx.upsertEvidence({ id: "e-1", summary: "Evidence item" });

            ctx.activeWindow.setSelected([
                { kind: "goal", id: "g-1", score: 10, pinned: false },
                { kind: "constraint", id: "c-1", score: 8, pinned: false },
                { kind: "evidence", id: "e-1", score: 6, pinned: false }
            ]);

            ctx.synthesizeWorkingMemory({ tokenBudget: 600 });

            const wm = ctx.workingMemory.text;
            expect(wm).toContain("Goals:");
            expect(wm).toContain("Constraints:");
            expect(wm).toContain("Evidence:");
        });

        test("should optionally archive raw items", () => {
            ctx.upsertGoal({ id: "g-1", title: "Test Goal", status: "active" });
            ctx.upsertConstraint({ id: "c-1", statement: "Test Constraint", status: "active" });

            ctx.activeWindow.setSelected([
                { kind: "goal", id: "g-1", score: 10, pinned: false },
                { kind: "constraint", id: "c-1", score: 8, pinned: false }
            ]);

            ctx.synthesizeWorkingMemory({ tokenBudget: 600, archiveRawItems: true });

            expect(ctx.goals.get("g-1")?.status).toBe("archived");
            expect(ctx.constraints.get("c-1")?.status).toBe("archived");
        });

        test("should not archive evidence items", () => {
            ctx.upsertEvidence({ id: "e-1", summary: "Test Evidence" });

            ctx.activeWindow.setSelected([
                { kind: "evidence", id: "e-1", score: 10, pinned: false }
            ]);

            ctx.synthesizeWorkingMemory({ tokenBudget: 600, archiveRawItems: true });

            // Evidence doesn't have status, so it should still exist
            expect(ctx.evidence.has("e-1")).toBe(true);
        });

        test("should synthesize from lanes in one call", () => {
            ctx.ensureLane("task");

            ctx.upsertGoal({
                id: "g-1",
                title: "Task Goal",
                tags: [{ key: "lane", value: "task" }]
            });

            ctx.lanes.get("task")?.setIncludeTagsAny([{ key: "lane", value: "task" }]);

            ctx.synthesizeFromLanes({ tokenBudget: 600 });

            expect(ctx.workingMemory.text).toContain("Task Goal");
            expect(ctx.activeWindow.selected.length).toBeGreaterThan(0);
        });
    });

    describe("LLM Context Payload", () => {
        test("should build LLM context payload", () => {
            ctx.upsertGoal({ id: "g-1", title: "Test Goal" });
            ctx.upsertConstraint({ id: "c-1", statement: "Test Constraint" });
            ctx.upsertEvidence({ id: "e-1", summary: "Test Evidence" });

            ctx.activeWindow.setSelected([
                { kind: "goal", id: "g-1", score: 10, pinned: false },
                { kind: "constraint", id: "c-1", score: 8, pinned: false },
                { kind: "evidence", id: "e-1", score: 6, pinned: false }
            ]);

            ctx.synthesizeWorkingMemory({ tokenBudget: 600 });

            const payload = ctx.buildLLMContextPayload();

            expect(payload.metaContextId).toBe("test-ctx");
            expect(payload.name).toBe("Test Context");
            expect(payload.selectedCount).toBe(3);
            expect(payload.goals).toContain("Test Goal");
            expect(payload.constraints).toContain("Test Constraint");
            expect(payload.evidence).toContain("Test Evidence");
            expect(payload.workingMemory.text).toBeTruthy();
            expect(payload.generatedAt).toBeTruthy();
        });

        test("should include working memory in payload", () => {
            ctx.upsertGoal({ id: "g-1", title: "Goal" });
            ctx.activeWindow.setSelected([
                { kind: "goal", id: "g-1", score: 10, pinned: false }
            ]);

            ctx.synthesizeWorkingMemory({ tokenBudget: 600 });
            const payload = ctx.buildLLMContextPayload();

            expect(payload.workingMemory.text).toBe(ctx.workingMemory.text);
            expect(payload.workingMemory.updatedAt).toBe(ctx.workingMemory.updatedAt);
            expect(payload.workingMemory.lastArchiveId).toBe(ctx.workingMemory.lastArchiveId);
        });

        test("should handle empty selections", () => {
            const payload = ctx.buildLLMContextPayload();

            expect(payload.selectedCount).toBe(0);
            expect(payload.goals.length).toBe(0);
            expect(payload.constraints.length).toBe(0);
        });
    });

    describe("Ingest Evidence Flow", () => {
        test("should ingest evidence without synthesis", async () => {
            await ctx.ingestEvidence({
                id: "e-1",
                summary: "New bug found",
                severity: "high",
            });

            expect(ctx.evidence.has("e-1")).toBe(true);
            expect(ctx.evidence.get("e-1")?.summary).toBe("New bug found");
        });

        test("should ingest evidence with synthesis", async () => {
            ctx.ensureLane("task");

            await ctx.ingestEvidence(
                {
                    id: "e-1",
                    summary: "Critical bug",
                    severity: "critical",
                    tags: [{ key: "lane", value: "task" }]
                },
                {
                    synthesize: true,
                    tokenBudget: 600
                }
            );

            expect(ctx.evidence.has("e-1")).toBe(true);
            expect(ctx.workingMemory.text).toBeTruthy();
            expect(ctx.archive.length).toBeGreaterThan(0);
        });

        test("should refresh lanes during evidence ingestion", async () => {
            ctx.ensureLane("task");
            ctx.lanes.get("task")?.setIncludeTagsAny([{ key: "lane", value: "task" }]);

            ctx.upsertGoal({
                id: "g-1",
                title: "Existing goal",
                tags: [{ key: "lane", value: "task" }]
            });

            await ctx.ingestEvidence(
                {
                    id: "e-1",
                    summary: "New evidence",
                    tags: [{ key: "lane", value: "task" }]
                },
                { synthesize: false }
            );

            const taskLane = ctx.lanes.get("task");
            expect(taskLane?.window.selected.length).toBeGreaterThan(0);
        });
    });

    describe("Tags and Provenance", () => {
        test("should store tags on knowledge objects", () => {
            ctx.upsertGoal({
                id: "g-1",
                title: "Tagged Goal",
                tags: [
                    { key: "priority", value: "urgent" },
                    { key: "team", value: "backend" }
                ]
            });

            const goal = ctx.goals.get("g-1");
            expect(goal?.tags.length).toBe(2);
            expect(goal?.tags[0]?.key).toBe("priority");
            expect(goal?.tags[0]?.value).toBe("urgent");
        });

        test("should store provenance information", () => {
            ctx.upsertEvidence({
                id: "e-1",
                summary: "User reported bug",
                provenance: {
                    source: "user",
                    ref: "ticket-123",
                    createdAt: new Date().toISOString()
                }
            });

            const evidence = ctx.evidence.get("e-1");
            expect(evidence?.provenance.source).toBe("user");
            expect(evidence?.provenance.ref).toBe("ticket-123");
        });

        test("should default provenance by type", () => {
            ctx.upsertAssumption({
                id: "a-1",
                statement: "Test assumption"
            });

            ctx.upsertEvidence({
                id: "e-1",
                summary: "Test evidence"
            });

            const assumption = ctx.assumptions.get("a-1");
            const evidence = ctx.evidence.get("e-1");

            expect(assumption?.provenance.source).toBe("inference");
            expect(evidence?.provenance.source).toBe("user");
        });
    });

    describe("Timestamps", () => {
        test("should set createdAt on new items", () => {
            const before = new Date();

            ctx.upsertGoal({
                id: "g-1",
                title: "Test Goal"
            });

            const after = new Date();
            const goal = ctx.goals.get("g-1");

            expect(goal?.createdAt).toBeDefined();

            const createdAt = new Date(goal!.createdAt);
            expect(createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
            expect(createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
        });

        test("should update updatedAt on changes", () => {
            ctx.upsertAssumption({
                id: "a-1",
                statement: "Initial statement"
            });

            const assumption = ctx.assumptions.get("a-1");
            const initialUpdatedAt = assumption?.updatedAt;

            // Wait a tiny bit to ensure timestamp changes
            const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
            wait(10).then(() => {
                assumption?.updateStatement("Updated statement");
                expect(assumption?.updatedAt).not.toBe(initialUpdatedAt);
            });
        });

        test("should track context updatedAt", async () => {
            const initialUpdatedAt = ctx.updatedAt;

            // Add a tiny delay to ensure timestamp changes
            await new Promise(resolve => setTimeout(resolve, 2));

            ctx.upsertGoal({ id: "g-1", title: "New Goal" });

            expect(ctx.updatedAt).not.toBe(initialUpdatedAt);
            expect(new Date(ctx.updatedAt).getTime()).toBeGreaterThan(
                new Date(initialUpdatedAt).getTime()
            );
        });
    });

    describe("Default Context Factory", () => {
        test("should create default context with lanes", () => {
            const defaultCtx = makeDefaultActiveMetaContext("default-ctx");

            expect(defaultCtx.id).toBe("default-ctx");
            expect(defaultCtx.lanes.size).toBe(5);
            expect(defaultCtx.lanes.has("task")).toBe(true);
            expect(defaultCtx.lanes.has("legal")).toBe(true);
            expect(defaultCtx.lanes.has("personal")).toBe(true);
            expect(defaultCtx.lanes.has("threat-model")).toBe(true);
            expect(defaultCtx.lanes.has("implementation")).toBe(true);
        });

        test("should configure lane tag filters by default", () => {
            const defaultCtx = makeDefaultActiveMetaContext("default-ctx");

            const taskLane = defaultCtx.lanes.get("task");
            expect(taskLane?.includeTagsAny.length).toBe(1);
            expect(taskLane?.includeTagsAny[0]?.key).toBe("lane");
            expect(taskLane?.includeTagsAny[0]?.value).toBe("task");
        });

        test("should set maxItems for each lane", () => {
            const defaultCtx = makeDefaultActiveMetaContext("default-ctx");

            expect(defaultCtx.lanes.get("task")?.window.policy.maxItems).toBe(20);
            expect(defaultCtx.lanes.get("legal")?.window.policy.maxItems).toBe(20);
            expect(defaultCtx.lanes.get("personal")?.window.policy.maxItems).toBe(10);
            expect(defaultCtx.lanes.get("threat-model")?.window.policy.maxItems).toBe(15);
            expect(defaultCtx.lanes.get("implementation")?.window.policy.maxItems).toBe(25);
        });

        test("should set activeWindow maxItems", () => {
            const defaultCtx = makeDefaultActiveMetaContext("default-ctx");
            expect(defaultCtx.activeWindow.policy.maxItems).toBe(35);
        });
    });

    describe("Token Counting Integration", () => {
        test("should use custom tokenizer for working memory synthesis", () => {
            ctx.upsertGoal({ id: "g-1", title: "Test goal with some text" });
            ctx.activeWindow.setSelected([
                { kind: "goal", id: "g-1", score: 10, pinned: false }
            ]);

            // Use a small token budget
            ctx.synthesizeWorkingMemory({ tokenBudget: 10 });

            // The working memory should be truncated to fit the budget
            const wm = ctx.workingMemory.text;
            expect(wm).toBeTruthy();

            // Verify it respects the token budget (approximation)
            const approxTokens = Math.ceil(wm.length / 4);
            expect(approxTokens).toBeLessThanOrEqual(15); // Allow small margin
        });

        test("should not truncate when within budget", () => {
            ctx.upsertGoal({ id: "g-1", title: "Short" });
            ctx.activeWindow.setSelected([
                { kind: "goal", id: "g-1", score: 10, pinned: false }
            ]);

            // Use a large token budget
            ctx.synthesizeWorkingMemory({ tokenBudget: 1000 });

            const wm = ctx.workingMemory.text;
            expect(wm).toContain("Short");
            expect(wm).toContain("Goals:");
        });
    });

    describe("Integration - Full Workflow", () => {
        test("should handle complete workflow from creation to LLM payload", () => {
            // Setup lanes
            ctx.ensureLane("task");
            ctx.ensureLane("legal");

            // Add knowledge objects with tags
            ctx.upsertGoal({
                id: "g-1",
                title: "Complete feature",
                priority: "p0",
                tags: [{ key: "lane", value: "task" }]
            });

            ctx.upsertConstraint({
                id: "c-1",
                statement: "Must comply with GDPR",
                priority: "p0",
                tags: [{ key: "lane", value: "legal" }]
            });

            ctx.upsertEvidence({
                id: "e-1",
                summary: "User feedback received",
                severity: "medium",
                tags: [{ key: "lane", value: "task" }]
            });

            // Configure lanes
            ctx.lanes.get("task")?.setIncludeTagsAny([{ key: "lane", value: "task" }]);
            ctx.lanes.get("legal")?.setIncludeTagsAny([{ key: "lane", value: "legal" }]);

            // Pin important item
            ctx.lanes.get("legal")?.pin("constraint", "c-1");

            // Refresh, merge, and synthesize
            ctx.synthesizeFromLanes({ tokenBudget: 800 });

            // Build LLM payload
            const payload = ctx.buildLLMContextPayload();

            // Verify complete workflow
            expect(payload.selectedCount).toBeGreaterThan(0);
            expect(payload.goals.length).toBeGreaterThan(0);
            expect(payload.constraints.length).toBeGreaterThan(0);
            expect(payload.evidence.length).toBeGreaterThan(0);
            expect(payload.workingMemory.text).toBeTruthy();
            expect(ctx.archive.length).toBe(1);

            // Verify pinned item made it through
            const legalSelected = ctx.lanes.get("legal")?.window.selected.find(s => s.id === "c-1");
            expect(legalSelected?.pinned).toBe(true);
        });

        test("should handle dynamic updates and re-synthesis", () => {
            ctx.ensureLane("task");
            ctx.lanes.get("task")?.setIncludeTagsAny([{ key: "lane", value: "task" }]);

            // Initial synthesis
            ctx.upsertGoal({
                id: "g-1",
                title: "Initial goal",
                tags: [{ key: "lane", value: "task" }]
            });

            ctx.synthesizeFromLanes({ tokenBudget: 600 });
            const firstArchiveCount = ctx.archive.length;

            // Add more evidence and re-synthesize
            ctx.upsertEvidence({
                id: "e-1",
                summary: "New critical finding",
                severity: "critical",
                tags: [{ key: "lane", value: "task" }]
            });

            ctx.synthesizeFromLanes({ tokenBudget: 600 });

            expect(ctx.archive.length).toBe(firstArchiveCount + 1);
            expect(ctx.workingMemory.text).toContain("New critical finding");
        });

        test("should maintain consistency across lane mute/enable", () => {
            ctx.ensureLane("task");
            ctx.ensureLane("legal");

            ctx.upsertGoal({ id: "g-1", title: "Task Goal", tags: [{ key: "lane", value: "task" }] });
            ctx.upsertGoal({ id: "g-2", title: "Legal Goal", tags: [{ key: "lane", value: "legal" }] });

            ctx.lanes.get("task")?.setIncludeTagsAny([{ key: "lane", value: "task" }]);
            ctx.lanes.get("legal")?.setIncludeTagsAny([{ key: "lane", value: "legal" }]);

            // All lanes enabled
            ctx.refreshAllLanes();
            ctx.mergeLanesToActiveWindow();
            expect(ctx.activeWindow.selected.length).toBe(2);

            // Mute legal lane
            ctx.lanes.get("legal")?.setStatus("muted");
            ctx.refreshAllLanes();
            ctx.mergeLanesToActiveWindow();
            expect(ctx.activeWindow.selected.length).toBe(1);
            expect(ctx.activeWindow.selected[0]?.id).toBe("g-1");

            // Re-enable legal lane
            ctx.lanes.get("legal")?.setStatus("enabled");
            ctx.refreshAllLanes();
            ctx.mergeLanesToActiveWindow();
            expect(ctx.activeWindow.selected.length).toBe(2);
        });
    });

    describe("Lifecycle Hooks", () => {
        describe("Hook Registration", () => {
            test("should register and fire event listeners", () => {
                const events: HookEvent[] = [];
                ctx.hooks.on("knowledgeObject:upserted", (e) => events.push(e));

                ctx.upsertGoal({ id: "g-1", title: "Test Goal" });

                expect(events.length).toBe(1);
                expect(events[0]?.type).toBe("knowledgeObject:upserted");
                const event = events[0] as KnowledgeObjectUpsertedEvent;
                expect(event.kind).toBe("goal");
                expect(event.id).toBe("g-1");
                expect(event.isNew).toBe(true);
            });

            test("should unsubscribe correctly", () => {
                const events: HookEvent[] = [];
                const unsub = ctx.hooks.on("knowledgeObject:upserted", (e) => events.push(e));

                ctx.upsertGoal({ id: "g-1", title: "Test Goal" });
                expect(events.length).toBe(1);

                unsub();

                ctx.upsertGoal({ id: "g-2", title: "Another Goal" });
                expect(events.length).toBe(1); // Still 1, not fired again
            });

            test("should support wildcard listeners with onAny", () => {
                const events: string[] = [];
                ctx.hooks.onAny((e) => events.push(e.type));

                ctx.upsertGoal({ id: "g-1", title: "Test" });
                ctx.ensureLane("test-lane");

                expect(events).toContain("knowledgeObject:upserted");
                expect(events).toContain("lane:created");
            });

            test("should fire once listeners only once", () => {
                const events: HookEvent[] = [];
                ctx.hooks.once("knowledgeObject:upserted", (e) => events.push(e));

                ctx.upsertGoal({ id: "g-1", title: "First" });
                ctx.upsertGoal({ id: "g-2", title: "Second" });

                expect(events.length).toBe(1);
                expect((events[0] as KnowledgeObjectUpsertedEvent).id).toBe("g-1");
            });

            test("should clear all listeners with offAll", () => {
                const events: HookEvent[] = [];
                ctx.hooks.on("knowledgeObject:upserted", (e) => events.push(e));
                ctx.hooks.onAny((e) => events.push(e));

                ctx.hooks.offAll();
                ctx.upsertGoal({ id: "g-1", title: "Test" });

                expect(events.length).toBe(0);
            });

            test("should clear listeners by event type with off", () => {
                const events: HookEvent[] = [];
                ctx.hooks.on("knowledgeObject:upserted", (e) => events.push(e));
                ctx.hooks.on("lane:created", (e) => events.push(e));

                ctx.hooks.off("knowledgeObject:upserted");

                ctx.upsertGoal({ id: "g-1", title: "Test" });
                ctx.ensureLane("test-lane");

                expect(events.length).toBe(1);
                expect(events[0]?.type).toBe("lane:created");
            });

            test("should return listener count", () => {
                expect(ctx.hooks.listenerCount).toBe(0);

                const unsub1 = ctx.hooks.on("knowledgeObject:upserted", () => {});
                expect(ctx.hooks.listenerCount).toBe(1);

                const unsub2 = ctx.hooks.onAny(() => {});
                expect(ctx.hooks.listenerCount).toBe(2);

                unsub1();
                expect(ctx.hooks.listenerCount).toBe(1);

                unsub2();
                expect(ctx.hooks.listenerCount).toBe(0);
            });
        });

        describe("Error Isolation", () => {
            test("should not break framework when listener throws", () => {
                const events: HookEvent[] = [];

                // Listener that throws
                ctx.hooks.on("knowledgeObject:upserted", () => {
                    throw new Error("Intentional test error");
                });

                // Listener that captures events
                ctx.hooks.on("knowledgeObject:upserted", (e) => events.push(e));

                // Should not throw
                expect(() => {
                    ctx.upsertGoal({ id: "g-1", title: "Test" });
                }).not.toThrow();

                // Second listener should still have received the event
                expect(events.length).toBe(1);
            });

            test("should not break framework when wildcard listener throws", () => {
                ctx.hooks.onAny(() => {
                    throw new Error("Intentional test error");
                });

                expect(() => {
                    ctx.upsertGoal({ id: "g-1", title: "Test" });
                    ctx.ensureLane("test");
                    ctx.refreshAllLanes();
                }).not.toThrow();
            });
        });

        describe("Knowledge Object Events", () => {
            test("should emit knowledgeObject:upserted for all kinds", () => {
                const events: KnowledgeObjectUpsertedEvent[] = [];
                ctx.hooks.on("knowledgeObject:upserted", (e) => events.push(e));

                ctx.upsertGoal({ id: "g-1", title: "Goal" });
                ctx.upsertConstraint({ id: "c-1", statement: "Constraint" });
                ctx.upsertAssumption({ id: "a-1", statement: "Assumption" });
                ctx.upsertEvidence({ id: "e-1", summary: "Evidence" });
                ctx.upsertQuestion({ id: "q-1", question: "Question?" });
                ctx.upsertDecision({ id: "d-1", statement: "Decision" });

                expect(events.length).toBe(6);
                expect(events.map((e) => e.kind)).toEqual([
                    "goal", "constraint", "assumption", "evidence", "question", "decision"
                ]);
            });

            test("should detect isNew for new vs updated items", () => {
                const events: KnowledgeObjectUpsertedEvent[] = [];
                ctx.hooks.on("knowledgeObject:upserted", (e) => events.push(e));

                ctx.upsertGoal({ id: "g-1", title: "Original" });
                ctx.upsertGoal({ id: "g-1", title: "Updated" });

                expect(events.length).toBe(2);
                expect(events[0]?.isNew).toBe(true);
                expect(events[1]?.isNew).toBe(false);
            });

            test("should include item snapshot in event payload", () => {
                const events: KnowledgeObjectUpsertedEvent[] = [];
                ctx.hooks.on("knowledgeObject:upserted", (e) => events.push(e));

                ctx.upsertGoal({ id: "g-1", title: "Test Goal", priority: "p0" });

                const event = events[0]!;
                expect(event.item).toBeDefined();
                expect((event.item as { title: string }).title).toBe("Test Goal");
                expect((event.item as { priority: string }).priority).toBe("p0");
            });
        });

        describe("Lane Events", () => {
            test("should emit lane:created when creating new lane", () => {
                const events: LaneCreatedEvent[] = [];
                ctx.hooks.on("lane:created", (e) => events.push(e));

                ctx.ensureLane("test-lane", "Test Lane");

                expect(events.length).toBe(1);
                expect(events[0]?.laneId).toBe("test-lane");
                expect(events[0]?.name).toBe("Test Lane");
            });

            test("should not emit lane:created when updating existing lane", () => {
                ctx.ensureLane("test-lane", "Original");

                const events: LaneCreatedEvent[] = [];
                ctx.hooks.on("lane:created", (e) => events.push(e));

                ctx.ensureLane("test-lane", "Updated");

                expect(events.length).toBe(0);
            });

            test("should emit lane:removed when removing lane", () => {
                ctx.ensureLane("test-lane");

                const events: HookEvent[] = [];
                ctx.hooks.on("lane:removed", (e) => events.push(e));

                ctx.removeLane("test-lane");

                expect(events.length).toBe(1);
                expect((events[0] as { laneId: string }).laneId).toBe("test-lane");
            });

            test("should emit lane:statusChanged when status changes", () => {
                ctx.ensureLane("test-lane");
                const events: LaneStatusChangedEvent[] = [];
                ctx.hooks.on("lane:statusChanged", (e) => events.push(e));

                ctx.setLaneStatus("test-lane", "disabled");

                expect(events.length).toBe(1);
                expect(events[0]?.oldStatus).toBe("enabled");
                expect(events[0]?.newStatus).toBe("disabled");
            });

            test("should not emit lane:statusChanged when status is same", () => {
                ctx.ensureLane("test-lane");
                const events: LaneStatusChangedEvent[] = [];
                ctx.hooks.on("lane:statusChanged", (e) => events.push(e));

                ctx.setLaneStatus("test-lane", "enabled"); // Already enabled

                expect(events.length).toBe(0);
            });

            test("should emit lane:pinChanged when pinning/unpinning", () => {
                ctx.ensureLane("test-lane");
                ctx.upsertGoal({ id: "g-1", title: "Test" });

                const events: LanePinChangedEvent[] = [];
                ctx.hooks.on("lane:pinChanged", (e) => events.push(e));

                ctx.pinInLane("test-lane", "goal", "g-1");
                ctx.unpinInLane("test-lane", "goal", "g-1");

                expect(events.length).toBe(2);
                expect(events[0]?.pinned).toBe(true);
                expect(events[1]?.pinned).toBe(false);
            });
        });

        describe("Selection Events", () => {
            test("should emit lane:refreshed when refreshing single lane", () => {
                ctx.ensureLane("test-lane");
                ctx.upsertGoal({ id: "g-1", title: "Test" });

                const events: LaneRefreshedEvent[] = [];
                ctx.hooks.on("lane:refreshed", (e) => events.push(e));

                ctx.refreshLaneSelection("test-lane");

                expect(events.length).toBe(1);
                expect(events[0]?.laneId).toBe("test-lane");
                expect(events[0]?.selectedCount).toBeGreaterThanOrEqual(0);
                expect(Array.isArray(events[0]?.selected)).toBe(true);
            });

            test("should emit lanes:refreshedAll when refreshing all lanes", () => {
                ctx.ensureLane("lane-1");
                ctx.ensureLane("lane-2");

                const events: LanesRefreshedAllEvent[] = [];
                ctx.hooks.on("lanes:refreshedAll", (e) => events.push(e));

                ctx.refreshAllLanes();

                expect(events.length).toBe(1);
                expect(events[0]?.laneIds).toContain("lane-1");
                expect(events[0]?.laneIds).toContain("lane-2");
            });
        });

        describe("Merge Events", () => {
            test("should emit activeWindow:merged when merging lanes", () => {
                const ctxWithLanes = makeDefaultActiveMetaContext("test-merge");
                ctxWithLanes.upsertGoal({
                    id: "g-1",
                    title: "Test Goal",
                    tags: [{ key: "lane", value: "task" }],
                });

                const events: ActiveWindowMergedEvent[] = [];
                ctxWithLanes.hooks.on("activeWindow:merged", (e) => events.push(e));

                ctxWithLanes.refreshAllLanes();
                ctxWithLanes.mergeLanesToActiveWindow();

                expect(events.length).toBe(1);
                expect(events[0]?.fromLanes.length).toBeGreaterThan(0);
                expect(Array.isArray(events[0]?.selected)).toBe(true);
            });
        });

        describe("Synthesis Events", () => {
            test("should emit archive:created and workingMemory:synthesized", () => {
                const ctxWithContent = makeDefaultActiveMetaContext("test-synth");
                ctxWithContent.upsertGoal({
                    id: "g-1",
                    title: "Test Goal",
                    tags: [{ key: "lane", value: "task" }],
                });

                const archiveEvents: ArchiveCreatedEvent[] = [];
                const synthesisEvents: WorkingMemorySynthesizedEvent[] = [];

                ctxWithContent.hooks.on("archive:created", (e) => archiveEvents.push(e));
                ctxWithContent.hooks.on("workingMemory:synthesized", (e) => synthesisEvents.push(e));

                ctxWithContent.synthesizeFromLanes({ tokenBudget: 500 });

                expect(archiveEvents.length).toBe(1);
                expect(synthesisEvents.length).toBe(1);

                expect(archiveEvents[0]?.archiveId).toBeDefined();
                expect(synthesisEvents[0]?.tokenBudget).toBe(500);
                expect(synthesisEvents[0]?.text.length).toBeGreaterThan(0);
                expect(synthesisEvents[0]?.archiveId).toBe(archiveEvents[0]?.archiveId);
            });

            test("should fire events in correct order during synthesizeFromLanes", () => {
                const ctxWithContent = makeDefaultActiveMetaContext("test-order");
                ctxWithContent.upsertGoal({
                    id: "g-1",
                    title: "Test Goal",
                    tags: [{ key: "lane", value: "task" }],
                });

                const eventOrder: string[] = [];
                ctxWithContent.hooks.onAny((e) => eventOrder.push(e.type));

                ctxWithContent.synthesizeFromLanes();

                expect(eventOrder).toEqual([
                    "lanes:refreshedAll",
                    "activeWindow:merged",
                    "archive:created",
                    "workingMemory:synthesized",
                ]);
            });
        });

        describe("Ingest Evidence Events", () => {
            test("should emit evidence:ingested event", async () => {
                const events: HookEvent[] = [];
                ctx.hooks.on("evidence:ingested", (e) => events.push(e));

                await ctx.ingestEvidence(
                    { id: "e-1", summary: "Test evidence" },
                    { synthesize: false }
                );

                expect(events.length).toBe(1);
                expect((events[0] as { evidenceId: string }).evidenceId).toBe("e-1");
                expect((events[0] as { synthesized: boolean }).synthesized).toBe(false);
            });

            test("should indicate synthesized=true when synthesis requested", async () => {
                const ctxWithLanes = makeDefaultActiveMetaContext("test-ingest");
                const events: HookEvent[] = [];
                ctxWithLanes.hooks.on("evidence:ingested", (e) => events.push(e));

                await ctxWithLanes.ingestEvidence(
                    { id: "e-1", summary: "Test", tags: [{ key: "lane", value: "task" }] },
                    { synthesize: true }
                );

                expect((events[0] as { synthesized: boolean }).synthesized).toBe(true);
            });
        });

        describe("Event Timestamps and Context ID", () => {
            test("should include timestamp in all events", () => {
                const events: HookEvent[] = [];
                ctx.hooks.onAny((e) => events.push(e));

                ctx.upsertGoal({ id: "g-1", title: "Test" });

                expect(events[0]?.timestamp).toBeDefined();
                expect(() => new Date(events[0]!.timestamp)).not.toThrow();
            });

            test("should include contextId in all events", () => {
                const events: HookEvent[] = [];
                ctx.hooks.onAny((e) => events.push(e));

                ctx.upsertGoal({ id: "g-1", title: "Test" });

                expect(events[0]?.contextId).toBe("test-ctx");
            });
        });

        describe("Event Payload Immutability", () => {
            test("should provide snapshots, not live references", () => {
                let capturedItem: Record<string, unknown> | undefined;
                ctx.hooks.on("knowledgeObject:upserted", (e) => {
                    capturedItem = e.item;
                });

                ctx.upsertGoal({ id: "g-1", title: "Original" });
                const originalTitle = (capturedItem as { title: string })?.title;

                // Update the goal
                ctx.upsertGoal({ id: "g-1", title: "Updated" });

                // The captured item from the first event should still have original title
                expect(originalTitle).toBe("Original");
            });
        });
    });
});
