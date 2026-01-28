import { types, flow, type Instance, type SnapshotIn, getSnapshot } from "mobx-state-tree";
import { countTokensSync } from "./custom_tokenizer";

// Re-export MST types for consumers
export { types, type Instance, type SnapshotIn } from "mobx-state-tree";

/**
 * Active Meta-Context Management Framework (MST) — with:
 *  1) Context lanes (task/legal/personal/threat-model/implementation/…)
 *     - Each lane has its own selection policy + context window
 *     - Merge step produces a unified "active window"
 *  2) Token-budgeted synthesizer
 *     - Builds a condensed Working Memory note (string) within a token budget proxy
 *     - Archives the raw selected items into an ArchiveEntry (plus snapshot)
 *  3) Lifecycle hooks system
 *     - Reactive event emitters for observing framework state changes
 *     - After-only, non-blocking, composable hooks
 *
 * Notes:
 * - "Token budgeting" here is a proxy via character budget; you can swap in a real tokenizer.
 * - All domain objects (goals/constraints/assumptions/evidence/questions/decisions) are global,
 *   and lanes reference them via refs.
 */

/** ---------- Hook Types ---------- */

export type KnowledgeObjectKind = "goal" | "constraint" | "assumption" | "evidence" | "question" | "decision";

export interface HookEventBase {
    type: string;
    timestamp: string;
    contextId: string;
}

export interface KnowledgeObjectUpsertedEvent extends HookEventBase {
    type: "knowledgeObject:upserted";
    kind: KnowledgeObjectKind;
    id: string;
    item: Record<string, unknown>;
    isNew: boolean;
}

export interface LaneCreatedEvent extends HookEventBase {
    type: "lane:created";
    laneId: string;
    name: string;
}

export interface LaneRemovedEvent extends HookEventBase {
    type: "lane:removed";
    laneId: string;
}

export interface LaneStatusChangedEvent extends HookEventBase {
    type: "lane:statusChanged";
    laneId: string;
    oldStatus: "enabled" | "muted" | "disabled";
    newStatus: "enabled" | "muted" | "disabled";
}

export interface LanePinChangedEvent extends HookEventBase {
    type: "lane:pinChanged";
    laneId: string;
    kind: KnowledgeObjectKind;
    itemId: string;
    pinned: boolean;
}

export interface LaneRefreshedEvent extends HookEventBase {
    type: "lane:refreshed";
    laneId: string;
    selectedCount: number;
    selected: Array<{ kind: string; id: string; score: number; pinned: boolean }>;
}

export interface LanesRefreshedAllEvent extends HookEventBase {
    type: "lanes:refreshedAll";
    laneIds: string[];
    totalSelected: number;
}

export interface ActiveWindowMergedEvent extends HookEventBase {
    type: "activeWindow:merged";
    mergedCount: number;
    fromLanes: string[];
    selected: Array<{ kind: string; id: string; score: number; pinned: boolean }>;
}

export interface WorkingMemorySynthesizedEvent extends HookEventBase {
    type: "workingMemory:synthesized";
    tokenBudget: number;
    actualTokens: number;
    text: string;
    archiveId: string;
}

export interface ArchiveCreatedEvent extends HookEventBase {
    type: "archive:created";
    archiveId: string;
    mergedCount: number;
}

export interface EvidenceIngestedEvent extends HookEventBase {
    type: "evidence:ingested";
    evidenceId: string;
    synthesized: boolean;
}

export type HookEvent =
    | KnowledgeObjectUpsertedEvent
    | LaneCreatedEvent
    | LaneRemovedEvent
    | LaneStatusChangedEvent
    | LanePinChangedEvent
    | LaneRefreshedEvent
    | LanesRefreshedAllEvent
    | ActiveWindowMergedEvent
    | WorkingMemorySynthesizedEvent
    | ArchiveCreatedEvent
    | EvidenceIngestedEvent;

export type HookEventType = HookEvent["type"];

/** Type map for inferring specific event types from string literals */
export interface HookEventMap {
    "knowledgeObject:upserted": KnowledgeObjectUpsertedEvent;
    "lane:created": LaneCreatedEvent;
    "lane:removed": LaneRemovedEvent;
    "lane:statusChanged": LaneStatusChangedEvent;
    "lane:pinChanged": LanePinChangedEvent;
    "lane:refreshed": LaneRefreshedEvent;
    "lanes:refreshedAll": LanesRefreshedAllEvent;
    "activeWindow:merged": ActiveWindowMergedEvent;
    "workingMemory:synthesized": WorkingMemorySynthesizedEvent;
    "archive:created": ArchiveCreatedEvent;
    "evidence:ingested": EvidenceIngestedEvent;
}

export type HookListener<T extends HookEvent = HookEvent> = (event: T) => void;

export type Unsubscribe = () => void;

/** ---------- Primitives ---------- */

const ISODateString = types.string;

const Severity = types.enumeration("Severity", ["low", "medium", "high", "critical"]);
const ConfidenceLabel = types.enumeration("ConfidenceLabel", ["low", "medium", "high"]);
const ConfidenceNumeric = types.refinement(
    "ConfidenceNumeric",
    types.number,
    (val) => val >= 0 && val <= 1
);
const Confidence = types.union(
    {
        dispatcher: (snapshot) => {
            if (typeof snapshot === "number") return ConfidenceNumeric;
            return ConfidenceLabel;
        },
    },
    ConfidenceLabel,
    ConfidenceNumeric
);
const Status = types.enumeration("Status", ["active", "paused", "done", "archived"]);
const Priority = types.enumeration("Priority", ["p0", "p1", "p2", "p3"]);

const Tag = types.model("Tag", {
    key: types.string,
    value: types.maybe(types.string),
});

const Provenance = types.model("Provenance", {
    source: types.enumeration("Source", ["user", "system", "tool", "doc", "web", "inference"]),
    ref: types.maybe(types.string),
    createdAt: types.optional(ISODateString, () => new Date().toISOString()),
});

/** ---------- Knowledge Objects ---------- */

const Assumption = types
    .model("Assumption", {
        id: types.identifier,
        statement: types.string,
        confidence: types.optional(Confidence, "medium"),
        tags: types.optional(types.array(Tag), []),
        provenance: types.optional(Provenance, () => ({ source: "inference" })),
        status: types.optional(Status, "active"),
        createdAt: types.optional(ISODateString, () => new Date().toISOString()),
        updatedAt: types.optional(ISODateString, () => new Date().toISOString()),
    })
    .actions((self) => ({
        setStatus(status: Instance<typeof Status>) {
            self.status = status;
            self.updatedAt = new Date().toISOString();
        },
        setConfidence(c: Instance<typeof Confidence>) {
            self.confidence = c;
            self.updatedAt = new Date().toISOString();
        },
        updateStatement(s: string) {
            self.statement = s;
            self.updatedAt = new Date().toISOString();
        },
    }));

const Evidence = types
    .model("Evidence", {
        id: types.identifier,
        summary: types.string,
        detail: types.maybe(types.string),
        severity: types.optional(Severity, "low"),
        confidence: types.optional(Confidence, "medium"),
        tags: types.optional(types.array(Tag), []),
        provenance: types.optional(Provenance, () => ({ source: "user" })),
        createdAt: types.optional(ISODateString, () => new Date().toISOString()),
    })
    .views((self) => ({
        get weight() {
            const sev = { low: 1, medium: 2, high: 3, critical: 4 }[self.severity];
            const conf = typeof self.confidence === "number"
                ? 0.6 + self.confidence * 0.7  // 0->0.6, 0.5->0.95, 1->1.3
                : { low: 0.6, medium: 1.0, high: 1.3 }[self.confidence];
            return sev * conf;
        },
    }));

const Constraint = types
    .model("Constraint", {
        id: types.identifier,
        statement: types.string,
        priority: types.optional(Priority, "p1"),
        tags: types.optional(types.array(Tag), []),
        provenance: types.optional(Provenance, () => ({ source: "user" })),
        status: types.optional(Status, "active"),
        createdAt: types.optional(ISODateString, () => new Date().toISOString()),
    })
    .actions((self) => ({
        setStatus(status: Instance<typeof Status>) {
            self.status = status;
        },
    }));

const Goal = types
    .model("Goal", {
        id: types.identifier,
        title: types.string,
        description: types.maybe(types.string),
        priority: types.optional(Priority, "p1"),
        status: types.optional(Status, "active"),
        tags: types.optional(types.array(Tag), []),
        createdAt: types.optional(ISODateString, () => new Date().toISOString()),
    })
    .actions((self) => ({
        setStatus(status: Instance<typeof Status>) {
            self.status = status;
        },
    }));

const OpenQuestion = types
    .model("OpenQuestion", {
        id: types.identifier,
        question: types.string,
        priority: types.optional(Priority, "p2"),
        status: types.optional(Status, "active"),
        tags: types.optional(types.array(Tag), []),
        provenance: types.optional(Provenance, () => ({ source: "system" })),
        createdAt: types.optional(ISODateString, () => new Date().toISOString()),
    })
    .actions((self) => ({
        setStatus(status: Instance<typeof Status>) {
            self.status = status;
        },
    }));

const Decision = types
    .model("Decision", {
        id: types.identifier,
        statement: types.string,
        rationale: types.maybe(types.string),
        status: types.optional(Status, "active"),
        tags: types.optional(types.array(Tag), []),
        provenance: types.optional(Provenance, () => ({ source: "system" })),
        createdAt: types.optional(ISODateString, () => new Date().toISOString()),
    })
    .actions((self) => ({
        setStatus(status: Instance<typeof Status>) {
            self.status = status;
        },
    }));

/** ---------- Context Window & Selection ---------- */

const ContextItemKind = types.enumeration("ContextItemKind", [
    "goal",
    "constraint",
    "assumption",
    "evidence",
    "question",
    "decision",
]);

const ContextItemRef = types.model("ContextItemRef", {
    kind: ContextItemKind,
    id: types.string,
    score: types.optional(types.number, 0),
    pinned: types.optional(types.boolean, false),
});

const SelectionPolicy = types.model("SelectionPolicy", {
    maxItems: types.optional(types.number, 30),

    wSeverity: types.optional(types.number, 1.0),
    wConfidence: types.optional(types.number, 0.7),
    wPriority: types.optional(types.number, 0.8),
    wPinnedBoost: types.optional(types.number, 1000),
    wRecency: types.optional(types.number, 0.1),

    includeKinds: types.optional(types.array(ContextItemKind), [
        "goal",
        "constraint",
        "assumption",
        "evidence",
        "question",
        "decision",
    ]),
});

/** ---------- Hook Registry ---------- */

const HookRegistry = types
    .model("HookRegistry", {})
    .volatile(() => ({
        listeners: new Map<string, Set<HookListener<HookEvent>>>(),
        wildcardListeners: new Set<HookListener<HookEvent>>(),
    }))
    .views((self) => ({
        get listenerCount(): number {
            let count = self.wildcardListeners.size;
            for (const set of self.listeners.values()) {
                count += set.size;
            }
            return count;
        },
    }))
    .actions((self) => ({
        on<K extends keyof HookEventMap>(
            eventType: K,
            listener: HookListener<HookEventMap[K]>
        ): Unsubscribe {
            if (!self.listeners.has(eventType)) {
                self.listeners.set(eventType, new Set());
            }
            const typedListener = listener as HookListener<HookEvent>;
            self.listeners.get(eventType)!.add(typedListener);

            return () => {
                const set = self.listeners.get(eventType);
                if (set) {
                    set.delete(typedListener);
                    if (set.size === 0) {
                        self.listeners.delete(eventType);
                    }
                }
            };
        },

        onAny(listener: HookListener<HookEvent>): Unsubscribe {
            self.wildcardListeners.add(listener);
            return () => {
                self.wildcardListeners.delete(listener);
            };
        },

        once<K extends keyof HookEventMap>(
            eventType: K,
            listener: HookListener<HookEventMap[K]>
        ): Unsubscribe {
            const wrappedListener: HookListener<HookEventMap[K]> = (event) => {
                unsub();
                listener(event);
            };
            const unsub = this.on(eventType, wrappedListener);
            return unsub;
        },

        off(eventType: HookEventType): void {
            self.listeners.delete(eventType);
        },

        offAll(): void {
            self.listeners.clear();
            self.wildcardListeners.clear();
        },

        _emit(event: HookEvent): void {
            // Fire type-specific listeners
            const typeListeners = self.listeners.get(event.type);
            if (typeListeners) {
                for (const listener of typeListeners) {
                    try {
                        listener(event);
                    } catch (e) {
                        console.error(`[HookRegistry] Error in listener for ${event.type}:`, e);
                    }
                }
            }

            // Fire wildcard listeners
            for (const listener of self.wildcardListeners) {
                try {
                    listener(event);
                } catch (e) {
                    console.error(`[HookRegistry] Error in wildcard listener for ${event.type}:`, e);
                }
            }
        },
    }));

const ContextWindow = types
    .model("ContextWindow", {
        policy: types.optional(SelectionPolicy, {}),
        selected: types.optional(types.array(ContextItemRef), []),
        lastRefreshedAt: types.maybe(ISODateString),
    })
    .actions((self) => ({
        setPolicy(patch: Partial<SnapshotIn<typeof SelectionPolicy>>) {
            Object.assign(self.policy, patch);
        },
        setSelected(items: SnapshotIn<typeof ContextItemRef>[]) {
            self.selected.replace(items as Instance<typeof ContextItemRef>[]);
            self.lastRefreshedAt = new Date().toISOString();
        },
    }));

/** ---------- Lanes ---------- */

const LaneStatus = types.enumeration("LaneStatus", ["enabled", "muted", "disabled"]);

const ContextLane = types
    .model("ContextLane", {
        id: types.identifier,
        name: types.string, // e.g. "task", "legal", "personal", ...
        status: types.optional(LaneStatus, "enabled"),

        // Lane-local window controls selection within lane.
        window: types.optional(ContextWindow, {}),

        // Lane-local membership constraints (optional but powerful):
        // - If set, only items matching at least one of these tags are candidates for this lane.
        // - Use tags like {key:"lane", value:"legal"} or {key:"domain", value:"security"} etc.
        includeTagsAny: types.optional(types.array(Tag), []),

        // Additional pinned refs explicitly for this lane (also can appear inside window.selected)
        pinned: types.optional(types.array(ContextItemRef), []),
    })
    .actions((self) => ({
        setStatus(s: Instance<typeof LaneStatus>) {
            self.status = s;
        },
        setName(n: string) {
            self.name = n;
        },
        setIncludeTagsAny(tags: SnapshotIn<typeof Tag>[]) {
            self.includeTagsAny.replace(tags as Instance<typeof Tag>[]);
        },
        pin(kind: Instance<typeof ContextItemKind>, id: string) {
            const existing = self.pinned.find((x) => x.kind === kind && x.id === id);
            if (existing) existing.pinned = true;
            else self.pinned.push({ kind, id, pinned: true, score: 0 });
        },
        unpin(kind: Instance<typeof ContextItemKind>, id: string) {
            const existing = self.pinned.find((x) => x.kind === kind && x.id === id);
            if (existing) existing.pinned = false;
        },
        setWindowPolicy(patch: Partial<SnapshotIn<typeof SelectionPolicy>>) {
            self.window.policy && self.window.setPolicy(patch);
        },
    }));

/** ---------- Working Memory & Archive ---------- */

const WorkingMemory = types.model("WorkingMemory", {
    text: types.optional(types.string, ""),
    updatedAt: types.maybe(ISODateString),
    // The lane merge + synthesis can store provenance about how it was created
    lastArchiveId: types.maybe(types.string),
});

const ArchiveEntry = types.model("ArchiveEntry", {
    id: types.identifier,
    createdAt: types.optional(ISODateString, () => new Date().toISOString()),

    // What was active at the time (refs), plus a condensed note
    mergedSelected: types.optional(types.array(ContextItemRef), []),
    workingMemoryText: types.optional(types.string, ""),

    // Snapshot of the framework state (optional but useful for rollback/audit)
    // Keep it small in production or store externally.
    snapshot: types.frozen(),
});

/** ---------- Framework Root ---------- */

export const ActiveMetaContext = types
    .model("ActiveMetaContext", {
        id: types.identifier,

        name: types.optional(types.string, "Active Meta-Context"),
        status: types.optional(Status, "active"),

        goals: types.optional(types.map(Goal), {}),
        constraints: types.optional(types.map(Constraint), {}),
        assumptions: types.optional(types.map(Assumption), {}),
        evidence: types.optional(types.map(Evidence), {}),
        questions: types.optional(types.map(OpenQuestion), {}),
        decisions: types.optional(types.map(Decision), {}),

        // Lanes
        lanes: types.optional(types.map(ContextLane), {}),

        // Unified active window (result of merge)
        activeWindow: types.optional(ContextWindow, {}),

        // Working memory note
        workingMemory: types.optional(WorkingMemory, {}),

        // Archive log
        archive: types.optional(types.array(ArchiveEntry), []),

        // Lifecycle hooks registry
        hooks: types.optional(HookRegistry, {}),

        createdAt: types.optional(ISODateString, () => new Date().toISOString()),
        updatedAt: types.optional(ISODateString, () => new Date().toISOString()),
    })
    .views((self) => {
        const priorityScore = (p: Instance<typeof Priority>) =>
            ({ p0: 4, p1: 3, p2: 2, p3: 1 } as const)[p];

        const confidenceScore = (c: Instance<typeof Confidence>): number => {
            if (typeof c === "number") return 1 + c * 2; // 0->1, 0.5->2, 1->3
            return ({ low: 1, medium: 2, high: 3 } as const)[c];
        };

        const severityScore = (s: Instance<typeof Severity>) =>
            ({ low: 1, medium: 2, high: 3, critical: 4 } as const)[s];

        const recencyScore = (iso?: string) => {
            if (!iso) return 0;
            const ageMs = Date.now() - new Date(iso).getTime();
            const ageHours = Math.max(0, ageMs / (1000 * 60 * 60));
            return 1 / (1 + ageHours);
        };

        const tagsMatchAny = (
            itemTags: { key: string; value?: string | null }[],
            matchTags: { key: string; value?: string | null }[]
        ) => {
            if (!matchTags?.length) return true;
            // match if any tag in `matchTags` equals some tag on item (key+value)
            return matchTags.some((t) =>
                itemTags.some((it) => it.key === t.key && (t.value == null || it.value === t.value))
            );
        };

        function getItemTags(kind: Instance<typeof ContextItemKind>, id: string): Instance<typeof Tag>[] {
            if (kind === "goal") return self.goals.get(id)?.tags ?? [];
            if (kind === "constraint") return self.constraints.get(id)?.tags ?? [];
            if (kind === "assumption") return self.assumptions.get(id)?.tags ?? [];
            if (kind === "evidence") return self.evidence.get(id)?.tags ?? [];
            if (kind === "question") return self.questions.get(id)?.tags ?? [];
            if (kind === "decision") return self.decisions.get(id)?.tags ?? [];
            return [];
        }

        function isActive(kind: Instance<typeof ContextItemKind>, id: string) {
            if (kind === "goal") return self.goals.get(id)?.status === "active";
            if (kind === "constraint") return self.constraints.get(id)?.status === "active";
            if (kind === "assumption") return self.assumptions.get(id)?.status === "active";
            if (kind === "question") return self.questions.get(id)?.status === "active";
            if (kind === "decision") return self.decisions.get(id)?.status === "active";
            if (kind === "evidence") return true; // evidence isn't status'd here; treat as usable
            return false;
        }

        function scoreRef(
            policy: Instance<typeof SelectionPolicy>,
            kind: Instance<typeof ContextItemKind>,
            id: string,
            pinned = false
        ) {
            if (pinned) return policy.wPinnedBoost;

            let sev = 0;
            let conf = 0;
            let pri = 0;
            let rec = 0;

            if (kind === "evidence") {
                const e = self.evidence.get(id);
                if (!e) return -Infinity;
                sev = severityScore(e.severity);
                conf = confidenceScore(e.confidence);
                rec = recencyScore(e.createdAt);
            } else if (kind === "assumption") {
                const a = self.assumptions.get(id);
                if (!a || a.status !== "active") return -Infinity;
                conf = confidenceScore(a.confidence);
                rec = recencyScore(a.updatedAt);
            } else if (kind === "goal") {
                const g = self.goals.get(id);
                if (!g || g.status !== "active") return -Infinity;
                pri = priorityScore(g.priority);
                rec = recencyScore(g.createdAt);
            } else if (kind === "constraint") {
                const c = self.constraints.get(id);
                if (!c || c.status !== "active") return -Infinity;
                pri = priorityScore(c.priority);
                rec = recencyScore(c.createdAt);
            } else if (kind === "question") {
                const q = self.questions.get(id);
                if (!q || q.status !== "active") return -Infinity;
                pri = priorityScore(q.priority);
                rec = recencyScore(q.createdAt);
            } else if (kind === "decision") {
                const d = self.decisions.get(id);
                if (!d || d.status !== "active") return -Infinity;
                rec = recencyScore(d.createdAt);
            }

            return (
                policy.wSeverity * sev +
                policy.wConfidence * conf +
                policy.wPriority * pri +
                policy.wRecency * rec
            );
        }

        function summarizeRef(kind: Instance<typeof ContextItemKind>, id: string): string | undefined {
            if (kind === "goal") return self.goals.get(id)?.title;
            if (kind === "constraint") return self.constraints.get(id)?.statement;
            if (kind === "assumption") return self.assumptions.get(id)?.statement;
            if (kind === "evidence") return self.evidence.get(id)?.summary;
            if (kind === "question") return self.questions.get(id)?.question;
            if (kind === "decision") return self.decisions.get(id)?.statement;
            return undefined;
        }

        function getAllIdsByKind(kind: Instance<typeof ContextItemKind>): string[] {
            if (kind === "goal") return Array.from(self.goals.keys());
            if (kind === "constraint") return Array.from(self.constraints.keys());
            if (kind === "assumption") return Array.from(self.assumptions.keys());
            if (kind === "evidence") return Array.from(self.evidence.keys());
            if (kind === "question") return Array.from(self.questions.keys());
            if (kind === "decision") return Array.from(self.decisions.keys());
            return [];
        }

        return {
            summarizeRef,
            isActive,
            getItemTags,
            tagsMatchAny,
            scoreRef,
            getAllIdsByKind,

            get laneList() {
                return Array.from(self.lanes.values());
            },

            get activeSelectedSummaries() {
                return self.activeWindow.selected
                    .map((r) => ({ ...r, text: summarizeRef(r.kind, r.id) }))
                    .filter((x) => !!x.text);
            },
        };
    })
    .actions((self) => {
        const touch = () => {
            self.updatedAt = new Date().toISOString();
        };

        type HookEventWithoutMeta<T extends HookEvent> = Omit<T, "timestamp" | "contextId">;
        type AnyHookEventWithoutMeta =
            | HookEventWithoutMeta<KnowledgeObjectUpsertedEvent>
            | HookEventWithoutMeta<LaneCreatedEvent>
            | HookEventWithoutMeta<LaneRemovedEvent>
            | HookEventWithoutMeta<LaneStatusChangedEvent>
            | HookEventWithoutMeta<LanePinChangedEvent>
            | HookEventWithoutMeta<LaneRefreshedEvent>
            | HookEventWithoutMeta<LanesRefreshedAllEvent>
            | HookEventWithoutMeta<ActiveWindowMergedEvent>
            | HookEventWithoutMeta<WorkingMemorySynthesizedEvent>
            | HookEventWithoutMeta<ArchiveCreatedEvent>
            | HookEventWithoutMeta<EvidenceIngestedEvent>;

        const emitEvent = (event: AnyHookEventWithoutMeta) => {
            self.hooks._emit({
                ...event,
                timestamp: new Date().toISOString(),
                contextId: self.id,
            } as HookEvent);
        };

        const upsertMapItem = <T extends { id: string }>(
            map: { set: (key: string, value: T) => void; has: (key: string) => boolean; get: (key: string) => T | undefined },
            item: T,
            kind: KnowledgeObjectKind
        ) => {
            const isNew = !map.has(item.id);
            map.set(item.id, item);
            touch();
            // Emit after state change
            const storedItem = map.get(item.id);
            emitEvent({
                type: "knowledgeObject:upserted",
                kind,
                id: item.id,
                item: storedItem ? { ...getSnapshot(storedItem as never) } : { ...item },
                isNew,
            });
        };

        const buildCandidatesForLane = (lane: Instance<typeof ContextLane>) => {
            const policy = lane.window.policy;
            const includeKinds = policy.includeKinds;

            const pinned = lane.pinned
                .filter((p) => p.pinned)
                .filter((p) => self.isActive(p.kind, p.id) || p.kind === "evidence")
                .map((p) => ({
                    kind: p.kind,
                    id: p.id,
                    pinned: true,
                    score: self.scoreRef(policy, p.kind, p.id, true),
                }));

            const candidates: SnapshotIn<typeof ContextItemRef>[] = [];

            for (const kind of includeKinds) {
                const ids = self.getAllIdsByKind(kind);
                for (const id of ids) {
                    if (!self.isActive(kind, id) && kind !== "evidence") continue;

                    // tag gating per lane
                    const itemTags = self.getItemTags(kind, id);
                    if (!self.tagsMatchAny(itemTags, lane.includeTagsAny)) continue;

                    if (pinned.some((p) => p.kind === kind && p.id === id)) continue;

                    const score = self.scoreRef(policy, kind, id, false);
                    if (score === -Infinity) continue;
                    candidates.push({ kind, id, score, pinned: false });
                }
            }

            candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

            const remainingSlots = Math.max(0, policy.maxItems - pinned.length);
            const selected = [...pinned, ...candidates.slice(0, remainingSlots)];

            return selected;
        };

        const uniqByKindIdKeepMaxScore = (refs: SnapshotIn<typeof ContextItemRef>[]) => {
            const map = new Map<string, SnapshotIn<typeof ContextItemRef>>();
            for (const r of refs) {
                const key = `${r.kind}:${r.id}`;
                const existing = map.get(key);
                if (!existing) map.set(key, r);
                else {
                    // keep pinned OR higher score
                    const keep =
                        (existing.pinned ? existing : r.pinned ? r : (existing.score ?? 0) >= (r.score ?? 0) ? existing : r);
                    map.set(key, keep);
                }
            }
            return Array.from(map.values());
        };

        // Use BERT tokenizer for accurate token counting
        const approxTokens = (s: string) => countTokensSync(s);

        const truncateToTokenBudget = (text: string, tokenBudget: number) => {
            // cheap: trim chars to fit budget using approxTokens
            if (approxTokens(text) <= tokenBudget) return text;
            const maxChars = Math.max(0, tokenBudget * 4);
            return text.slice(0, maxChars).replace(/\s+\S*$/, "").trimEnd() + "…";
        };

        const makeWorkingMemory = (refs: SnapshotIn<typeof ContextItemRef>[], tokenBudget: number) => {
            // deterministic, crisp, lane-agnostic “condensed note”
            // prioritize pinned + high score; group by kind; then trim to budget.
            const order = [...refs].sort((a, b) => {
                const ap = a.pinned ? 1 : 0;
                const bp = b.pinned ? 1 : 0;
                if (bp !== ap) return bp - ap;
                return (b.score ?? 0) - (a.score ?? 0);
            });

            const buckets: Record<string, string[]> = {
                goals: [],
                constraints: [],
                decisions: [],
                evidence: [],
                assumptions: [],
                questions: [],
            };

            for (const r of order) {
                const t = self.summarizeRef(r.kind, r.id);
                if (!t) continue;
                if (r.kind === "goal") buckets.goals?.push(t);
                else if (r.kind === "constraint") buckets.constraints?.push(t);
                else if (r.kind === "decision") buckets.decisions?.push(t);
                else if (r.kind === "evidence") buckets.evidence?.push(t);
                else if (r.kind === "assumption") buckets.assumptions?.push(t);
                else if (r.kind === "question") buckets.questions?.push(t);
            }

            const lines: string[] = [];
            const add = (label: string, arr: string[]) => {
                if (!arr.length) return;
                lines.push(`${label}:`);
                for (const s of arr) lines.push(`- ${s}`);
                lines.push("");
            };

            add("Goals", buckets.goals ?? []);
            add("Constraints", buckets.constraints ?? []);
            add("Decisions", buckets.decisions ?? []);
            add("Evidence", buckets.evidence ?? []);
            add("Assumptions", buckets.assumptions ?? []);
            add("Open questions", buckets.questions ?? []);

            const raw = lines.join("\n").trim();
            return truncateToTokenBudget(raw, tokenBudget);
        };

        const archiveSelectedRefs = (merged: SnapshotIn<typeof ContextItemRef>[], workingText: string) => {
            const archiveId = `arch_${Date.now()}_${Math.random().toString(16).slice(2)}`;
            self.archive.push({
                id: archiveId,
                mergedSelected: merged,
                workingMemoryText: workingText,
                snapshot: getSnapshot(self),
            });
            return archiveId;
        };

        const archiveAndPruneRaw = (refs: SnapshotIn<typeof ContextItemRef>[]) => {
            // optional: archive raw items by setting statuses to archived where applicable
            for (const r of refs) {
                if (r.kind === "goal") self.goals.get(r.id)?.setStatus("archived");
                else if (r.kind === "constraint") self.constraints.get(r.id)?.setStatus("archived");
                else if (r.kind === "assumption") self.assumptions.get(r.id)?.setStatus("archived");
                else if (r.kind === "question") self.questions.get(r.id)?.setStatus("archived");
                else if (r.kind === "decision") self.decisions.get(r.id)?.setStatus("archived");
                // evidence: keep (usually you don't want to “archive” evidence out of existence)
            }
        };

        return {
            /** ---- Upserts ---- */
            setStatus(status: Instance<typeof Status>) {
                self.status = status;
                touch();
            },
            upsertGoal(goal: SnapshotIn<typeof Goal>) {
                upsertMapItem(self.goals, goal, "goal");
            },
            upsertConstraint(c: SnapshotIn<typeof Constraint>) {
                upsertMapItem(self.constraints, c, "constraint");
            },
            upsertAssumption(a: SnapshotIn<typeof Assumption>) {
                upsertMapItem(self.assumptions, a, "assumption");
            },
            upsertEvidence(e: SnapshotIn<typeof Evidence>) {
                upsertMapItem(self.evidence, e, "evidence");
            },
            upsertQuestion(q: SnapshotIn<typeof OpenQuestion>) {
                upsertMapItem(self.questions, q, "question");
            },
            upsertDecision(d: SnapshotIn<typeof Decision>) {
                upsertMapItem(self.decisions, d, "decision");
            },

            /** ---- Lanes ---- */
            ensureLane(id: string, name?: string) {
                const isNew = !self.lanes.has(id);
                if (isNew) {
                    self.lanes.set(id, { id, name: name ?? id });
                } else if (name) {
                    self.lanes.get(id)!.setName(name);
                }
                touch();
                if (isNew) {
                    emitEvent({
                        type: "lane:created",
                        laneId: id,
                        name: name ?? id,
                    });
                }
            },

            removeLane(id: string) {
                const existed = self.lanes.has(id);
                self.lanes.delete(id);
                touch();
                if (existed) {
                    emitEvent({
                        type: "lane:removed",
                        laneId: id,
                    });
                }
            },

            /** ---- Lane Status & Pin (with hooks) ---- */
            setLaneStatus(laneId: string, newStatus: "enabled" | "muted" | "disabled") {
                const lane = self.lanes.get(laneId);
                if (!lane) return;
                const oldStatus = lane.status;
                if (oldStatus === newStatus) return;
                lane.setStatus(newStatus);
                touch();
                emitEvent({
                    type: "lane:statusChanged",
                    laneId,
                    oldStatus,
                    newStatus,
                });
            },

            pinInLane(laneId: string, kind: KnowledgeObjectKind, itemId: string) {
                const lane = self.lanes.get(laneId);
                if (!lane) return;
                lane.pin(kind, itemId);
                touch();
                emitEvent({
                    type: "lane:pinChanged",
                    laneId,
                    kind,
                    itemId,
                    pinned: true,
                });
            },

            unpinInLane(laneId: string, kind: KnowledgeObjectKind, itemId: string) {
                const lane = self.lanes.get(laneId);
                if (!lane) return;
                lane.unpin(kind, itemId);
                touch();
                emitEvent({
                    type: "lane:pinChanged",
                    laneId,
                    kind,
                    itemId,
                    pinned: false,
                });
            },

            /** ---- Lane Refresh ---- */
            refreshLaneSelection(laneId: string) {
                const lane = self.lanes.get(laneId);
                if (!lane) return;
                let selected: SnapshotIn<typeof ContextItemRef>[] = [];
                if (lane.status !== "enabled") {
                    lane.window.setSelected([]);
                } else {
                    selected = buildCandidatesForLane(lane);
                    lane.window.setSelected(selected);
                }
                touch();
                emitEvent({
                    type: "lane:refreshed",
                    laneId,
                    selectedCount: selected.length,
                    selected: selected.map((s) => ({
                        kind: s.kind as string,
                        id: s.id as string,
                        score: s.score ?? 0,
                        pinned: s.pinned ?? false,
                    })),
                });
            },

            refreshAllLanes() {
                const laneIds: string[] = [];
                let totalSelected = 0;
                for (const lane of self.lanes.values()) {
                    laneIds.push(lane.id);
                    if (lane.status !== "enabled") {
                        lane.window.setSelected([]);
                        continue;
                    }
                    const selected = buildCandidatesForLane(lane);
                    lane.window.setSelected(selected);
                    totalSelected += selected.length;
                }
                touch();
                emitEvent({
                    type: "lanes:refreshedAll",
                    laneIds,
                    totalSelected,
                });
            },

            /**
             * Merge step:
             * - takes enabled lane selections
             * - unions them (dedupe by kind+id)
             * - sorts by pinned then score
             * - applies activeWindow.policy.maxItems cap
             */
            mergeLanesToActiveWindow() {
                const enabled = Array.from(self.lanes.values()).filter((l) => l.status === "enabled");

                const mergedRaw: SnapshotIn<typeof ContextItemRef>[] = [];
                for (const lane of enabled) {
                    for (const r of lane.window.selected) mergedRaw.push(getSnapshot(r));
                }

                let merged = uniqByKindIdKeepMaxScore(mergedRaw);

                merged.sort((a, b) => {
                    const ap = a.pinned ? 1 : 0;
                    const bp = b.pinned ? 1 : 0;
                    if (bp !== ap) return bp - ap;
                    return (b.score ?? 0) - (a.score ?? 0);
                });

                const cap = self.activeWindow.policy.maxItems;
                const capped = merged.slice(0, Math.max(0, cap));

                self.activeWindow.setSelected(capped);
                touch();
                emitEvent({
                    type: "activeWindow:merged",
                    mergedCount: capped.length,
                    fromLanes: enabled.map((l) => l.id),
                    selected: capped.map((s) => ({
                        kind: s.kind as string,
                        id: s.id as string,
                        score: s.score ?? 0,
                        pinned: s.pinned ?? false,
                    })),
                });
            },

            /**
             * Token-budgeted synthesis:
             * - uses activeWindow.selected (call merge first, or call synthesizeFromLanes)
             * - generates workingMemory.text within token budget
             * - archives selection + snapshot
             * - optionally prunes raw items (archives statuses for non-evidence kinds)
             */
            synthesizeWorkingMemory(options?: {
                tokenBudget?: number;
                archiveRawItems?: boolean;
            }) {
                const tokenBudget = options?.tokenBudget ?? 600; // a "small" working memory note
                const archiveRawItems = options?.archiveRawItems ?? false;

                const selected = self.activeWindow.selected.map((x) => getSnapshot(x));
                const wm = makeWorkingMemory(selected, tokenBudget);

                const archiveId = archiveSelectedRefs(selected, wm);

                self.workingMemory.text = wm;
                self.workingMemory.updatedAt = new Date().toISOString();
                self.workingMemory.lastArchiveId = archiveId;

                if (archiveRawItems) {
                    archiveAndPruneRaw(selected);
                }

                touch();

                // Emit archive:created event
                emitEvent({
                    type: "archive:created",
                    archiveId,
                    mergedCount: selected.length,
                });

                // Emit workingMemory:synthesized event
                const actualTokens = approxTokens(wm);
                emitEvent({
                    type: "workingMemory:synthesized",
                    tokenBudget,
                    actualTokens,
                    text: wm,
                    archiveId,
                });
            },

            /**
             * Convenience: refresh lanes -> merge -> synthesize
             */
            synthesizeFromLanes(options?: {
                tokenBudget?: number;
                archiveRawItems?: boolean;
            }) {
                this.refreshAllLanes();
                this.mergeLanesToActiveWindow();
                this.synthesizeWorkingMemory(options);
            },

            /**
             * LLM payload builder (now includes workingMemory + merged window)
             */
            buildLLMContextPayload() {
                const items = self.activeWindow.selected;

                const byKind = {
                    goals: [] as string[],
                    constraints: [] as string[],
                    assumptions: [] as string[],
                    evidence: [] as string[],
                    questions: [] as string[],
                    decisions: [] as string[],
                };

                for (const r of items) {
                    const text = self.summarizeRef(r.kind, r.id);
                    if (!text) continue;
                    if (r.kind === "goal") byKind.goals.push(text);
                    else if (r.kind === "constraint") byKind.constraints.push(text);
                    else if (r.kind === "assumption") byKind.assumptions.push(text);
                    else if (r.kind === "evidence") byKind.evidence.push(text);
                    else if (r.kind === "question") byKind.questions.push(text);
                    else if (r.kind === "decision") byKind.decisions.push(text);
                }

                return {
                    metaContextId: self.id,
                    name: self.name,
                    generatedAt: new Date().toISOString(),
                    workingMemory: {
                        text: self.workingMemory.text,
                        updatedAt: self.workingMemory.updatedAt,
                        lastArchiveId: self.workingMemory.lastArchiveId,
                    },
                    selectedCount: items.length,
                    goals: byKind.goals,
                    constraints: byKind.constraints,
                    assumptions: byKind.assumptions,
                    evidence: byKind.evidence,
                    questions: byKind.questions,
                    decisions: byKind.decisions,
                };
            },

            /**
             * Optional ingestion hook: store evidence + refresh/synthesize.
             */
            ingestEvidence: flow(function* (
                e: SnapshotIn<typeof Evidence>,
                opts?: { synthesize?: boolean; tokenBudget?: number }
            ) {
                upsertMapItem(self.evidence, e, "evidence");

                // Call synchronous actions directly in the flow
                // Type assertion needed to access sibling actions within a flow
                type SelfWithActions = typeof self & {
                    refreshAllLanes: () => void;
                    mergeLanesToActiveWindow: () => void;
                    synthesizeWorkingMemory: (options?: { tokenBudget?: number; archiveRawItems?: boolean }) => void;
                };
                const actions = self as SelfWithActions;

                const didSynthesize = opts?.synthesize ?? false;
                if (didSynthesize) {
                    actions.refreshAllLanes();
                    actions.mergeLanesToActiveWindow();
                    actions.synthesizeWorkingMemory({ tokenBudget: opts?.tokenBudget });
                } else {
                    // minimal: keep activeWindow fresh if you want
                    actions.refreshAllLanes();
                    actions.mergeLanesToActiveWindow();
                }

                // Emit evidence:ingested event
                emitEvent({
                    type: "evidence:ingested",
                    evidenceId: e.id,
                    synthesized: didSynthesize,
                });
            }),
        };
    });

/** ---------- Types ---------- */
export type ActiveMetaContextInstance = Instance<typeof ActiveMetaContext>;
export type HookRegistryInstance = Instance<typeof HookRegistry>;

/** ---------- Suggested defaults helper (optional) ---------- */
export function makeDefaultActiveMetaContext(id: string) {
    // Create with common lanes + tag filters
    // Convention: tag items with {key:"lane", value:"legal"} etc.
    return ActiveMetaContext.create({
        id,
        lanes: {
            task: {
                id: "task",
                name: "task",
                includeTagsAny: [{ key: "lane", value: "task" }],
                window: { policy: { maxItems: 20 } },
            },
            legal: {
                id: "legal",
                name: "legal",
                includeTagsAny: [{ key: "lane", value: "legal" }],
                window: { policy: { maxItems: 20 } },
            },
            personal: {
                id: "personal",
                name: "personal",
                includeTagsAny: [{ key: "lane", value: "personal" }],
                window: { policy: { maxItems: 10 } },
            },
            "threat-model": {
                id: "threat-model",
                name: "threat-model",
                includeTagsAny: [{ key: "lane", value: "threat-model" }],
                window: { policy: { maxItems: 15 } },
            },
            implementation: {
                id: "implementation",
                name: "implementation",
                includeTagsAny: [{ key: "lane", value: "implementation" }],
                window: { policy: { maxItems: 25 } },
            },
        },
        activeWindow: { policy: { maxItems: 35 } },
    });
}
