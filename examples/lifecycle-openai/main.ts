#!/usr/bin/env bun
/**
 * Diagnostic Workflow Example
 *
 * This demo simulates an incident response runbook with a known correct decision.
 *
 * How to navigate this file (line numbers are approximate and may shift):
 * - Narrative overview: lines 2–31
 * - Types + helpers: lines 41–72
 * - Prompt builders: lines 76–129
 * - LLM request helpers: lines 133–281
 * - Lifecycle hook wiring: lines 289–555
 * - Main demo flow: lines 559–749
 * - Entrypoint: lines 752–757
 *
 * What should happen end-to-end:
 * 1) We create an ActiveMetaContext and configure lanes (including a custom "incident" lane).
 * 2) We upsert goals, constraints, assumptions, and questions that describe the incident.
 * 3) We ingest a short evidence stream that includes two latency measurements:
 *    - baseline p95 latency (before deploy)
 *    - peak p95 latency (after deploy)
 * 4) A lifecycle hook listens to evidence ingestion and, once both latency items are present,
 *    computes the percentage increase and logs it.
 * 5) After all evidence is ingested, the context is synthesized (refresh → merge → working memory),
 *    which emits a `workingMemory:synthesized` event.
 * 6) Several lifecycle hooks trigger separate LLM calls:
 *    - triage summary when enough evidence is ingested
 *    - decision validation when working memory is first synthesized
 *    - stakeholder update after the decision is applied and re-synthesized
 *    - risk assessment after the decision re-merge
 * 7) Finally, the script prints:
 *    - working memory text
 *    - decisions list
 *    - lifecycle stats + logs
 *    - computed latency delta (and a runtime assertion that it matches the expected value)
 *
 * If OPENAI_API_KEY is not set:
 * - No LLM calls are made.
 * - The known decision is applied directly.
 * - A fallback stakeholder update is used.
 */

import OpenAI from "openai";
import {
    makeDefaultActiveMetaContext,
    type HookEvent,
    type Unsubscribe,
} from "../../index.ts";

type Context = ReturnType<typeof makeDefaultActiveMetaContext>;

type HookStats = {
    events: HookEvent[];
    byType: Record<string, number>;
    byKind: Record<string, number>;
    laneStatusChanges: string[];
    pinChanges: string[];
    evidenceIngested: number;
    latencyDeltaPercent?: number;
    triageSummary?: string;
    riskAssessment?: string;
    stakeholderUpdate?: string;
    lastTokenBudget?: number;
    lastActualTokens?: number;
    lastArchiveId?: string;
};

type HookController = {
    stats: HookStats;
    getOpenAIPromise: () => Promise<void> | null;
    cleanup: () => void;
};

/** Writes a timestamped log line for streaming observability. */
const log = (message: string) => {
    console.log(`[${new Date().toISOString()}] ${message}`);
};

/** Returns a random integer between min and max (inclusive). */
const randomInt = (min: number, max: number) =>
    Math.floor(Math.random() * (max - min + 1)) + min;

// ---- LLM prompt builders ----

/** Builds the decision validation prompt with a known correct answer. */
function buildPlannerPrompt(
    payload: ReturnType<Context["buildLLMContextPayload"]>,
    expectedDecision: string,
): string {
    return [
        "You are validating a diagnostic runbook with a known correct answer.",
        "Given the active meta-context payload below, return JSON only.",
        'The JSON object must include "decision" with the single correct decision sentence.',
        `Correct decision: "${expectedDecision}"`,
        "",
        "Active meta-context payload:",
        JSON.stringify(payload, null, 2),
    ].join("\n");
}

/** Builds a prompt for a short, non-technical stakeholder update. */
function buildStakeholderUpdatePrompt(
    payload: ReturnType<Context["buildLLMContextPayload"]>,
): string {
    return [
        "You are writing a one-sentence stakeholder update for a live incident.",
        "Return plain text only. Keep it short and non-technical.",
        "",
        "Incident context:",
        JSON.stringify(payload, null, 2),
    ].join("\n");
}

/** Builds a concise triage summary prompt from current context. */
function buildTriageSummaryPrompt(
    payload: ReturnType<Context["buildLLMContextPayload"]>,
): string {
    return [
        "You are triaging a production incident.",
        "Return a concise, 1-2 sentence triage summary in plain text.",
        "",
        "Incident context:",
        JSON.stringify(payload, null, 2),
    ].join("\n");
}

/** Builds a short operational risk assessment prompt. */
function buildRiskAssessmentPrompt(
    payload: ReturnType<Context["buildLLMContextPayload"]>,
): string {
    return [
        "You are assessing operational risk for the current incident.",
        "Return a short risk assessment sentence in plain text.",
        "",
        "Incident context:",
        JSON.stringify(payload, null, 2),
    ].join("\n");
}

// ---- LLM request helpers ----

/**
 * Validates the known decision with the LLM, then upserts and pins it.
 * Calls onDecisionApplied after the decision is stored.
 */
async function requestDecisionFromOpenAI(
    ctx: Context,
    openai: OpenAI,
    model: string,
    expectedDecision: string,
    onDecisionApplied: () => void,
): Promise<void> {
    const payload = ctx.buildLLMContextPayload();
    const prompt = buildPlannerPrompt(payload, expectedDecision);

    log(`OpenAI request start (model=${model}).`);
    const response = await openai.responses.create({
        model,
        input: prompt,
    });
    log("OpenAI request complete.");

    const decisionText = response.output_text?.trim() ?? "";
    if (!decisionText) {
        console.warn("OpenAI returned no text output; skipping decision upsert.");
        return;
    }

    let parsedDecision = "";
    try {
        const parsed = JSON.parse(decisionText) as { decision?: string };
        parsedDecision = typeof parsed.decision === "string" ? parsed.decision.trim() : "";
    } catch {
        parsedDecision = decisionText;
    }

    const matchesExpected = parsedDecision === expectedDecision;
    log(
        matchesExpected
            ? "OpenAI output matched the expected decision."
            : "OpenAI output did not match; applying expected decision.",
    );
    const decisionId = `d-llm-${Date.now()}`;
    ctx.upsertDecision({
        id: decisionId,
        statement: matchesExpected ? parsedDecision : expectedDecision,
        rationale: matchesExpected
            ? "Validated known decision from OpenAI output."
            : "Known decision used; OpenAI output did not match exactly.",
        tags: [{ key: "lane", value: "incident" }],
    });

    ctx.pinInLane("incident", "decision", decisionId);
    onDecisionApplied();
    ctx.synthesizeFromLanes({ tokenBudget: 520 });
}

/**
 * Generates a stakeholder update sentence with the LLM.
 * Stores the result in hook stats for final reporting.
 */
async function requestStakeholderUpdateFromOpenAI(
    ctx: Context,
    openai: OpenAI,
    model: string,
    stats: HookStats,
): Promise<void> {
    const payload = ctx.buildLLMContextPayload();
    const prompt = buildStakeholderUpdatePrompt(payload);

    log(`OpenAI update request start (model=${model}).`);
    const response = await openai.responses.create({
        model,
        input: prompt,
    });
    log("OpenAI update request complete.");

    const updateText = response.output_text?.trim() ?? "";
    if (!updateText) {
        console.warn("OpenAI returned no update text; using fallback.");
        stats.stakeholderUpdate =
            "Mitigation applied; monitoring confirms checkout stability is improving.";
        return;
    }

    stats.stakeholderUpdate = updateText;
    log(`LLM stakeholder update: ${updateText}`);
}

/**
 * Generates a triage summary with the LLM after enough evidence arrives.
 */
async function requestTriageSummaryFromOpenAI(
    ctx: Context,
    openai: OpenAI,
    model: string,
    stats: HookStats,
): Promise<void> {
    const payload = ctx.buildLLMContextPayload();
    const prompt = buildTriageSummaryPrompt(payload);

    log(`OpenAI triage request start (model=${model}).`);
    const response = await openai.responses.create({
        model,
        input: prompt,
    });
    log("OpenAI triage request complete.");

    const summaryText = response.output_text?.trim() ?? "";
    if (!summaryText) {
        console.warn("OpenAI returned no triage summary; using fallback.");
        stats.triageSummary =
            "Triage: checkout errors and latency spiked after deploy; rollback and flag disablement likely stabilize.";
        return;
    }

    stats.triageSummary = summaryText;
    log(`LLM triage summary: ${summaryText}`);
}

/**
 * Generates a short risk assessment after the decision is applied.
 */
async function requestRiskAssessmentFromOpenAI(
    ctx: Context,
    openai: OpenAI,
    model: string,
    stats: HookStats,
): Promise<void> {
    const payload = ctx.buildLLMContextPayload();
    const prompt = buildRiskAssessmentPrompt(payload);

    log(`OpenAI risk request start (model=${model}).`);
    const response = await openai.responses.create({
        model,
        input: prompt,
    });
    log("OpenAI risk request complete.");

    const riskText = response.output_text?.trim() ?? "";
    if (!riskText) {
        console.warn("OpenAI returned no risk assessment; using fallback.");
        stats.riskAssessment =
            "Risk remains elevated until rollback completes and latency returns to baseline.";
        return;
    }

    stats.riskAssessment = riskText;
    log(`LLM risk assessment: ${riskText}`);
}

// ---- Lifecycle hooks wiring ----

/**
 * Attaches lifecycle hooks, triggers synthesis, and orchestrates LLM calls.
 * Returns stats and a helper to await any in-flight LLM requests.
 */
function attachLifecycleHooks(
    ctx: Context,
    openai: OpenAI | null,
    model: string,
    expectedEvidenceCount: number,
    expectedDecision: string,
    evidenceValues: Record<string, number>,
    latencyIds: { baseline: string; peak: string },
): HookController {
    const stats: HookStats = {
        events: [],
        byType: {},
        byKind: {},
        laneStatusChanges: [],
        pinChanges: [],
        evidenceIngested: 0,
    };

    const unsubs: Unsubscribe[] = [];
    let synthesisTriggered = false;
    const seenEvidence = new Set<string>();
    let decisionApplied = false;
    let updateRequested = false;
    let triageRequested = false;
    let riskRequested = false;
    let pendingOpenAI = 0;
    let resolveIdle: (() => void) | null = null;

    const trackOpenAI = (promise: Promise<void>) => {
        pendingOpenAI += 1;
        promise.finally(() => {
            pendingOpenAI -= 1;
            if (pendingOpenAI === 0 && resolveIdle) {
                resolveIdle();
                resolveIdle = null;
            }
        });
    };

    const waitForOpenAIIdle = () => {
        if (pendingOpenAI === 0) return Promise.resolve();
        return new Promise<void>((resolve) => {
            resolveIdle = resolve;
        });
    };

    unsubs.push(
        // Global event logger for streaming visibility into all lifecycle events.
        ctx.hooks.onAny((event) => {
            stats.events.push(event);
            stats.byType[event.type] = (stats.byType[event.type] ?? 0) + 1;
            switch (event.type) {
                case "knowledgeObject:upserted":
                    log(
                        `event: ${event.type} kind=${event.kind} id=${event.id} isNew=${event.isNew}`,
                    );
                    break;
                case "lane:created":
                    log(`event: ${event.type} lane=${event.laneId}`);
                    break;
                case "lane:statusChanged":
                    log(
                        `event: ${event.type} lane=${event.laneId} ${event.oldStatus}->${event.newStatus}`,
                    );
                    break;
                case "lane:pinChanged":
                    log(
                        `event: ${event.type} lane=${event.laneId} ${event.kind}:${event.itemId} pinned=${event.pinned}`,
                    );
                    break;
                case "lane:refreshed":
                    log(
                        `event: ${event.type} lane=${event.laneId} selected=${event.selectedCount}`,
                    );
                    break;
                case "lanes:refreshedAll":
                    log(
                        `event: ${event.type} lanes=${event.laneIds.length} totalSelected=${event.totalSelected}`,
                    );
                    break;
                case "activeWindow:merged":
                    log(
                        `event: ${event.type} merged=${event.mergedCount} lanes=${event.fromLanes.join(",")}`,
                    );
                    break;
                case "archive:created":
                    log(`event: ${event.type} archiveId=${event.archiveId}`);
                    break;
                case "workingMemory:synthesized":
                    log(
                        `event: ${event.type} tokens=${event.actualTokens}/${event.tokenBudget}`,
                    );
                    break;
                case "evidence:ingested":
                    log(`event: ${event.type} evidenceId=${event.evidenceId}`);
                    break;
                default:
                    log(`event: ${event.type}`);
            }
        }),
    );

    unsubs.push(
        // Count knowledge object upserts by kind for end-of-run stats.
        ctx.hooks.on("knowledgeObject:upserted", (event) => {
            stats.byKind[event.kind] = (stats.byKind[event.kind] ?? 0) + 1;
        }),
    );

    unsubs.push(
        // Track lane status changes to demonstrate lane lifecycle events.
        ctx.hooks.on("lane:statusChanged", (event) => {
            stats.laneStatusChanges.push(
                `${event.laneId}:${event.oldStatus}->${event.newStatus}`,
            );
        }),
    );

    unsubs.push(
        // Track pin/unpin activity for observability.
        ctx.hooks.on("lane:pinChanged", (event) => {
            stats.pinChanges.push(
                `${event.laneId}:${event.kind}:${event.itemId}:${event.pinned ? "pinned" : "unpinned"}`,
            );
        }),
    );

    unsubs.push(
        // Store the most recent archive id generated during synthesis.
        ctx.hooks.on("archive:created", (event) => {
            stats.lastArchiveId = event.archiveId;
        }),
    );

    unsubs.push(
        // Record token usage for each synthesis pass.
        ctx.hooks.on("workingMemory:synthesized", (event) => {
            stats.lastTokenBudget = event.tokenBudget;
            stats.lastActualTokens = event.actualTokens;
        }),
    );

    unsubs.push(
        // Evidence ingestion hook: compute latency delta + trigger synthesis + triage summary.
        ctx.hooks.on("evidence:ingested", (event) => {
            stats.evidenceIngested += 1;
            seenEvidence.add(event.evidenceId);
            const numericValue = evidenceValues[event.evidenceId];
            if (typeof numericValue === "number") {
                if (seenEvidence.has(latencyIds.baseline) && seenEvidence.has(latencyIds.peak)) {
                    const baseline = evidenceValues[latencyIds.baseline];
                    const peak = evidenceValues[latencyIds.peak];
                    stats.latencyDeltaPercent = Math.round(((peak - baseline) / baseline) * 100);
                    log(
                        `Calculated latency increase: ${stats.latencyDeltaPercent}% (baseline ${baseline}ms → peak ${peak}ms).`,
                    );
                }
            }
            if (!synthesisTriggered && stats.evidenceIngested >= expectedEvidenceCount) {
                synthesisTriggered = true;
                log("Evidence threshold reached; triggering synthesis.");
                ctx.synthesizeFromLanes({ tokenBudget: 520 });
            }

            if (!triageRequested && stats.evidenceIngested >= 2) {
                triageRequested = true;
                if (!openai) {
                    stats.triageSummary =
                        "Triage: checkout errors and latency spiked after deploy; rollback and flag disablement likely stabilize.";
                } else {
                    const triagePromise = requestTriageSummaryFromOpenAI(
                        ctx,
                        openai,
                        model,
                        stats,
                    ).catch((err) => {
                        console.error("OpenAI triage request failed:", err);
                    });
                    trackOpenAI(triagePromise);
                }
            }
        }),
    );

    unsubs.push(
        // First synthesis triggers decision validation LLM call (single shot).
        ctx.hooks.once("workingMemory:synthesized", () => {
            if (!openai) {
                log("OpenAI client missing; applying known decision locally.");
                const decisionId = `d-known-${Date.now()}`;
                ctx.upsertDecision({
                    id: decisionId,
                    statement: expectedDecision,
                    rationale: "Known decision applied without OpenAI call.",
                    tags: [{ key: "lane", value: "incident" }],
                });
                stats.stakeholderUpdate =
                    "Mitigation applied; monitoring confirms checkout stability is improving.";
                stats.triageSummary =
                    stats.triageSummary ??
                    "Triage: checkout errors and latency spiked after deploy; rollback and flag disablement likely stabilize.";
                stats.riskAssessment =
                    "Risk remains elevated until rollback completes and latency returns to baseline.";
                ctx.pinInLane("incident", "decision", decisionId);
                decisionApplied = true;
                updateRequested = true;
                riskRequested = true;
                ctx.synthesizeFromLanes({ tokenBudget: 520 });
                return;
            }
            const decisionPromise = requestDecisionFromOpenAI(
                ctx,
                openai,
                model,
                expectedDecision,
                () => {
                    decisionApplied = true;
                },
            ).catch((err) => {
                console.error("OpenAI request failed:", err);
            });
            trackOpenAI(decisionPromise);
        }),
    );

    unsubs.push(
        // After decision is applied, next synthesis triggers stakeholder update LLM call.
        ctx.hooks.on("workingMemory:synthesized", () => {
            if (!openai || updateRequested || !decisionApplied) return;
            updateRequested = true;
            const updatePromise = requestStakeholderUpdateFromOpenAI(
                ctx,
                openai,
                model,
                stats,
            ).catch((err) => {
                console.error("OpenAI update request failed:", err);
            });
            trackOpenAI(updatePromise);
        }),
    );

    unsubs.push(
        // After decision is applied, merged window triggers risk assessment LLM call.
        ctx.hooks.on("activeWindow:merged", () => {
            if (!openai || riskRequested || !decisionApplied) return;
            riskRequested = true;
            const riskPromise = requestRiskAssessmentFromOpenAI(
                ctx,
                openai,
                model,
                stats,
            ).catch((err) => {
                console.error("OpenAI risk request failed:", err);
            });
            trackOpenAI(riskPromise);
        }),
    );

    return {
        stats,
        getOpenAIPromise: () => (pendingOpenAI > 0 ? waitForOpenAIIdle() : null),
        cleanup: () => {
            for (const unsub of unsubs) unsub();
        },
    };
}

// ---- Main demo flow ----

/** Entry point that runs the diagnostic workflow end-to-end. */
async function main() {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL ?? "gpt-5";
    const openai = apiKey ? new OpenAI({ apiKey }) : null;
    const expectedDecision =
        "Disable the promo-banner feature flag and roll back deploy 91a7 to stabilize checkout.";
    const latencyIds = {
        baseline: "e-latency-baseline",
        peak: "e-latency-peak",
    };
    // Randomize baseline/peak latency at startup to validate runtime math.
    const baselineMs = randomInt(180, 260);
    const peakMs = baselineMs + randomInt(500, 2500);
    const expectedLatencyDeltaPercent = Math.round(((peakMs - baselineMs) / baselineMs) * 100);
    const evidenceValues: Record<string, number> = {
        "e-latency-baseline": baselineMs,
        "e-latency-peak": peakMs,
    };

    if (!apiKey) {
        console.warn("OPENAI_API_KEY not set. The example will skip the OpenAI call.");
    }

    log("Booting diagnostic workflow.");
    // Create context and scenario evidence to drive hooks + synthesis.
    const ctx = makeDefaultActiveMetaContext("incident-lifecycle-demo");

    const evidenceStream = [
        {
            id: "e-1",
            summary: "Error rate spiked to 18% immediately after deploy 91a7",
            severity: "high",
            confidence: "high",
            tags: [{ key: "lane", value: "incident" }],
        },
        {
            id: "e-latency-baseline",
            summary: `Baseline checkout latency p95 measured at ${baselineMs}ms before deploy 91a7`,
            severity: "critical",
            confidence: "high",
            tags: [{ key: "lane", value: "incident" }],
        },
        {
            id: "e-latency-peak",
            summary: `Peak checkout latency p95 observed at ${peakMs}ms after deploy 91a7`,
            severity: "critical",
            confidence: "high",
            tags: [{ key: "lane", value: "incident" }],
        },
        {
            id: "e-4",
            summary: "Promo-banner feature flag rollout correlates with spike in cache misses",
            severity: "medium",
            confidence: "medium",
            tags: [{ key: "lane", value: "incident" }],
        },
    ];

    // Wire lifecycle hooks before mutating context state.
    const hooks = attachLifecycleHooks(
        ctx,
        openai,
        model,
        evidenceStream.length,
        expectedDecision,
        evidenceValues,
        latencyIds,
    );

    log("Configuring lanes and policies.");
    // Configure the custom incident lane and tune selection policy.
    ctx.ensureLane("incident", "Incident Response");
    ctx.lanes.get("incident")?.setIncludeTagsAny([{ key: "lane", value: "incident" }]);
    ctx.lanes
        .get("incident")
        ?.setWindowPolicy({ maxItems: 12, wSeverity: 1.6, wRecency: 0.3, wPinnedBoost: 2000 });

    ctx.lanes
        .get("implementation")
        ?.setWindowPolicy({ maxItems: 8, wPriority: 1.1, wRecency: 0.15 });

    // Demonstrate lane lifecycle updates.
    ctx.setLaneStatus("personal", "disabled");
    ctx.setLaneStatus("legal", "muted");

    log("Upserting base knowledge objects.");
    // Upsert the core incident context.
    ctx.upsertGoal({
        id: "g-restore",
        title: "Restore checkout availability within 30 minutes",
        priority: "p0",
        tags: [
            { key: "lane", value: "incident" },
            { key: "lane", value: "task" },
        ],
    });

    ctx.upsertConstraint({
        id: "c-no-data-loss",
        statement: "Mitigation must not drop or duplicate orders",
        priority: "p0",
        tags: [{ key: "lane", value: "incident" }],
    });

    ctx.upsertAssumption({
        id: "a-deploy",
        statement: "A recent deployment introduced the regression",
        confidence: "medium",
        tags: [{ key: "lane", value: "incident" }],
    });

    ctx.upsertQuestion({
        id: "q-scope",
        question: "Is the outage isolated to the checkout service?",
        priority: "p1",
        tags: [{ key: "lane", value: "incident" }],
    });

    // Pin a critical constraint to ensure it stays in the active window.
    ctx.pinInLane("incident", "constraint", "c-no-data-loss");
    log("Pinned critical constraint; refreshing incident lane selection.");
    ctx.refreshLaneSelection("incident");

    // Stream evidence in and let hooks handle synthesis and LLM calls.
    for (const evidence of evidenceStream) {
        log(`Ingesting evidence ${evidence.id}.`);
        await ctx.ingestEvidence(evidence, { synthesize: false });
    }

    // Wait for any pending LLM requests spawned by hooks.
    const pendingOpenAI = hooks.getOpenAIPromise();
    if (pendingOpenAI) {
        log("Awaiting OpenAI validation.");
        await pendingOpenAI;
    }

    log("Final payload ready; printing summary.");
    // Emit final report for the demo.
    const payload = ctx.buildLLMContextPayload();

    console.log("---- WORKING MEMORY ----\n");
    console.log(payload.workingMemory.text || "(empty)");
    console.log("\n---- DECISIONS ----\n");
    for (const d of payload.decisions) {
        console.log(`- ${d}`);
    }

    console.log("\n---- LIFECYCLE STATS ----\n");
    console.log(`events: ${hooks.stats.events.length}`);
    console.log(`evidence ingested: ${hooks.stats.evidenceIngested}`);
    console.log(`by kind: ${JSON.stringify(hooks.stats.byKind)}`);
    console.log(`by type: ${JSON.stringify(hooks.stats.byType)}`);
    if (hooks.stats.laneStatusChanges.length) {
        console.log(`lane status changes: ${hooks.stats.laneStatusChanges.join(", ")}`);
    }
    if (hooks.stats.pinChanges.length) {
        console.log(`pin changes: ${hooks.stats.pinChanges.join(", ")}`);
    }
    if (hooks.stats.lastArchiveId) {
        console.log(`last archive id: ${hooks.stats.lastArchiveId}`);
    }
    if (hooks.stats.lastTokenBudget && hooks.stats.lastActualTokens) {
        console.log(
            `tokens: budget=${hooks.stats.lastTokenBudget}, actual=${hooks.stats.lastActualTokens}`,
        );
    }
    if (hooks.stats.latencyDeltaPercent !== undefined) {
        console.log(`latency increase: ${hooks.stats.latencyDeltaPercent}%`);
    }
    if (hooks.stats.triageSummary) {
        console.log(`triage summary: ${hooks.stats.triageSummary}`);
    }
    if (hooks.stats.stakeholderUpdate) {
        console.log(`stakeholder update: ${hooks.stats.stakeholderUpdate}`);
    }
    if (hooks.stats.riskAssessment) {
        console.log(`risk assessment: ${hooks.stats.riskAssessment}`);
    }
    console.log(`expected latency increase: ${expectedLatencyDeltaPercent}%`);
    console.log(`expected decision: ${expectedDecision}`);

    // Cleanup hook subscriptions.
    hooks.cleanup();

    // Verify the hook-computed latency delta matches the expected value.
    if (hooks.stats.latencyDeltaPercent !== expectedLatencyDeltaPercent) {
        throw new Error(
            `Unexpected latency delta: ${hooks.stats.latencyDeltaPercent ?? "missing"} (expected ${expectedLatencyDeltaPercent}%)`,
        );
    }
}

if (import.meta.main) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
