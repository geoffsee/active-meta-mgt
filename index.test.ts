import { describe, test, expect, beforeEach } from "bun:test";
import { ActiveMetaContext, makeDefaultActiveMetaContext, type ActiveMetaContextInstance } from "./index";

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
            expect(lane?.pinned[0].kind).toBe("goal");
            expect(lane?.pinned[0].id).toBe("goal-1");
            expect(lane?.pinned[0].pinned).toBe(true);

            lane?.unpin("goal", "goal-1");
            expect(lane?.pinned[0].pinned).toBe(false);
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
            expect(tags[0].key).toBe("lane");
            expect(tags[0].value).toBe("task");
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
            expect(summaries[0].text).toBe("Test Goal");
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
            expect(taskLane?.window.selected[0].id).toBe("g-1");

            expect(legalLane?.window.selected.length).toBe(1);
            expect(legalLane?.window.selected[0].id).toBe("g-2");
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
            expect(ctx.activeWindow.selected[0].id).toBe("g-1");
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
            expect(lastArchive.workingMemoryText).toBe(ctx.workingMemory.text);
            expect(lastArchive.mergedSelected.length).toBe(1);
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
            expect(goal?.tags[0].key).toBe("priority");
            expect(goal?.tags[0].value).toBe("urgent");
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
            expect(taskLane?.includeTagsAny[0].key).toBe("lane");
            expect(taskLane?.includeTagsAny[0].value).toBe("task");
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
            expect(ctx.activeWindow.selected[0].id).toBe("g-1");

            // Re-enable legal lane
            ctx.lanes.get("legal")?.setStatus("enabled");
            ctx.refreshAllLanes();
            ctx.mergeLanesToActiveWindow();
            expect(ctx.activeWindow.selected.length).toBe(2);
        });
    });
});
