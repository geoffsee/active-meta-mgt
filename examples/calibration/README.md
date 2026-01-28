# Calibration Example

A CLI tool that loads a YAML scenario file, populates an `ActiveMetaContext` with lanes and knowledge objects, runs token-budgeted synthesis, and prints the resulting LLM context payload.

## Usage

```bash
bun run main.ts <scenario.yaml>
```

## Files

- **main.ts** -- CLI entry point. Reads a YAML scenario file from argv and runs the calibration pipeline.
- **calibrator.ts** -- `Calibrator` class that orchestrates the workflow: loading lanes, upserting knowledge objects, synthesizing, and formatting output.
- **calibrate.ts** -- Standalone variant that bundles the calibrator and utilities into a single file with its own CLI entry point.
- **utils.ts** -- Helper functions used by `calibrator.ts`:
  - `parseScenario()` -- parses raw YAML into a typed `ScenarioDoc`
  - `createContext()` -- creates an `ActiveMetaContext` instance
  - `loadLanes()` -- registers lanes from the scenario
  - `loadKnowledgeObjects()` -- upserts goals, constraints, assumptions, evidence, questions, and decisions
  - `synthesize()` -- runs lane synthesis and builds the LLM context payload
  - `formatPayload()` -- formats the payload as human-readable text
- **yaml2json.ts** -- Lightweight YAML-to-JSON converter supporting scalars, nested objects, and arrays.

## Scenario YAML Format

A scenario file defines lanes and knowledge objects. Each knowledge object can be tagged with `lane: <name>` to associate it with a specific context lane. See the framework's `CLAUDE.md` for details on lane filtering, selection policies, and scoring weights.
