[![Test](https://github.com/geoffsee/active-meta-mgt/actions/workflows/test.yml/badge.svg)](https://github.com/geoffsee/active-meta-mgt/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# Active Meta-Context Management

Token-budgeted context management framework built with MobX-State-Tree. Organizes and prioritizes knowledge objects across multiple context "lanes" for LLM prompting.

## Installation

```bash
npm install active-meta-mgt
# or
bun add active-meta-mgt
```

## Quick Start

```typescript
import { makeDefaultActiveMetaContext } from "active-meta-mgt";

// 1. Create a context (comes with 5 default lanes: task, legal, personal, threat-model, implementation)
const ctx = makeDefaultActiveMetaContext("my-context");

// 2. Add knowledge objects with lane tags
ctx.upsertGoal({
  id: "goal-1",
  title: "Complete feature X",
  tags: [{ key: "lane", value: "task" }],
  priority: "p0"
});

ctx.upsertEvidence({
  id: "ev-1",
  summary: "User feedback indicates performance regression",
  tags: [{ key: "lane", value: "task" }],
  severity: "high",
  confidence: "high"
});

ctx.upsertConstraint({
  id: "con-1",
  statement: "Must maintain backward compatibility",
  tags: [{ key: "lane", value: "implementation" }],
  priority: "p0"
});

// 3. Synthesize working memory from all lanes
ctx.synthesizeFromLanes({ tokenBudget: 600 });

// 4. Get LLM-ready payload
const payload = ctx.buildLLMContextPayload();
console.log(payload.workingMemory.text);
```

## Core Concepts

### Knowledge Objects

Six types of domain entities stored globally:

| Type | Purpose | Key Fields |
|------|---------|------------|
| **Goal** | Objectives and targets | `title`, `priority` (p0-p3), `status` |
| **Constraint** | Requirements and limitations | `statement`, `priority`, `status` |
| **Assumption** | Beliefs and hypotheses | `statement`, `confidence` (low/medium/high), `status` |
| **Evidence** | Facts and findings | `summary`, `detail`, `severity`, `confidence` |
| **OpenQuestion** | Unanswered questions | `question`, `priority`, `status` |
| **Decision** | Choices with rationale | `statement`, `rationale`, `status` |

All objects support `tags` for lane filtering, `provenance` for source tracking, and timestamps for recency scoring.

### Context Lanes

Lanes are separate selection domains that filter and score items independently:

```typescript
// Create a custom lane
ctx.ensureLane("security", "Security Concerns");
const lane = ctx.lanes.get("security");
lane.setIncludeTagsAny([{ key: "lane", value: "security" }]);
lane.setWindowPolicy({ maxItems: 15, wSeverity: 2.0 });
```

Lane states: `enabled` (participates in merge), `muted` (preserved but excluded), `disabled` (no selection).

### Selection & Scoring

Each lane scores items using configurable weights:

```typescript
{
  wSeverity: 1.0,     // Weight for severity (low=1, medium=2, high=3, critical=4)
  wConfidence: 0.7,   // Weight for confidence (low=1, medium=2, high=3)
  wPriority: 0.8,     // Weight for priority (p0=4, p1=3, p2=2, p3=1)
  wRecency: 0.1,      // Exponential decay for recency
  wPinnedBoost: 1000, // Score boost for pinned items
  maxItems: 30        // Maximum items per lane
}
```

### Synthesis Pipeline

```typescript
// All-in-one
ctx.synthesizeFromLanes({ tokenBudget: 600, archiveRawItems: false });

// Or step by step
ctx.refreshAllLanes();
ctx.mergeLanesToActiveWindow();
ctx.synthesizeWorkingMemory({ tokenBudget: 600 });
```

1. **Refresh** - Each lane selects top-scored items matching its tag filter
2. **Merge** - Enabled lanes combine into a unified active window (deduped, capped)
3. **Synthesize** - Generate token-budgeted condensed text
4. **Archive** - Store selection snapshot for audit trail

### Lifecycle Hooks

Subscribe to framework events for logging, monitoring, or reactive workflows:

```typescript
// Listen for specific events
const unsub = ctx.hooks.on("knowledgeObject:upserted", (event) => {
  console.log(`${event.kind} ${event.id} was ${event.isNew ? "created" : "updated"}`);
});

// Listen for all events
ctx.hooks.onAny((event) => {
  console.log(`[${event.timestamp}] ${event.type}`);
});

// One-time listener
ctx.hooks.once("workingMemory:synthesized", (event) => {
  console.log(`Synthesis complete: ${event.actualTokens} tokens`);
});

// Cleanup
unsub();
ctx.hooks.offAll();
```

Available events:
- `knowledgeObject:upserted` - Item created or updated
- `lane:created`, `lane:removed`, `lane:statusChanged`, `lane:pinChanged` - Lane lifecycle
- `lane:refreshed`, `lanes:refreshedAll` - Selection refresh
- `activeWindow:merged` - Merge completed
- `workingMemory:synthesized` - Synthesis completed
- `archive:created` - Archive entry created
- `evidence:ingested` - Evidence ingestion flow completed

## API Reference

### Upsert Methods

```typescript
ctx.upsertGoal({ id: "g1", title: "...", priority: "p0", tags: [...] });
ctx.upsertConstraint({ id: "c1", statement: "...", priority: "p0", tags: [...] });
ctx.upsertAssumption({ id: "a1", statement: "...", confidence: "medium", tags: [...] });
ctx.upsertEvidence({ id: "e1", summary: "...", severity: "high", tags: [...] });
ctx.upsertQuestion({ id: "q1", question: "...", priority: "p1", tags: [...] });
ctx.upsertDecision({ id: "d1", statement: "...", rationale: "...", tags: [...] });
```

### Lane Management

```typescript
ctx.ensureLane("newLane", "Display Name");
ctx.removeLane("laneId");
ctx.setLaneStatus("laneId", "enabled" | "muted" | "disabled");
ctx.pinInLane("laneId", "evidence", "item-id");
ctx.unpinInLane("laneId", "evidence", "item-id");
```

### Evidence Ingestion

Async flow for adding evidence and optionally triggering synthesis:

```typescript
await ctx.ingestEvidence(
  { id: "e1", summary: "New finding", severity: "high", tags: [...] },
  { synthesize: true, tokenBudget: 800 }
);
```

### LLM Payload

```typescript
const payload = ctx.buildLLMContextPayload();
// { metaContextId, name, generatedAt, workingMemory, selectedCount,
//   goals, constraints, assumptions, evidence, questions, decisions }
```

## Token Counting

```typescript
import { countTokens, countTokensSync } from "active-meta-mgt/tokenizer";

const tokens = await countTokens("text");      // Async BERT tokenization
const approx = countTokensSync("text");        // Sync approximation (chars / 4)
```

## Archive System

Every synthesis creates an `ArchiveEntry` with merged refs, working memory text, and a full MST snapshot for audit trail or rollback. Access via `ctx.archive`.

## Example Application

See [`examples/vitalsWatch/`](./examples/VitalsWatch/) for a full-stack example (Apple Watch + Cloudflare Workers server) demonstrating the framework in a clinical vitals monitoring scenario.

## Commands

```bash
bun test              # Run all tests
bun test index.test.ts # Run specific test file
bun run typecheck     # TypeScript type checking
bun install           # Install dependencies
```

## License

MIT
