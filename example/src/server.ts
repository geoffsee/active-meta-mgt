import { makeOpenAIClient } from "./openaiClient";
import {
  createContextForScenario,
  listScenarios,
  type AvailableScenarioId,
} from "./scenarios";
import {
  loadPatients,
  getPatient,
  getDatasetStats,
  filterPatients,
} from "./data/loaders/patients";
import {
  generateScenario,
  generateScenarioFromPatient,
  listAvailablePatients,
  getScenarioStats,
} from "./data/generators/scenario";
import { getPatientSummary, transformPatient } from "./data/transformers/patient";
import { labRanges, getLabNames } from "./data/reference/labRanges";
import { icdToScenario, getMappedIcdCodes } from "./data/reference/icdMapping";
import { drugConstraints } from "./data/reference/drugRules";
import { makeDefaultActiveMetaContext } from "active-meta-mgt";
import { SPECIALISTS, type Specialist } from "./specialists";

const port = Number(process.env.PORT ?? process.env.BUN_PORT ?? 3333);
const publicDir = new URL("../public/", import.meta.url);
const publicDirFallback = new URL("./example/public/", `file://${process.cwd()}/`);
async function resolvePublicFile(path: string): Promise<{ file: Blob; url: URL }> {
  const primaryUrl = new URL(path, publicDir);
  const fallbackUrl = new URL(path, publicDirFallback);
  const primaryFile = Bun.file(primaryUrl);
  if (await primaryFile.exists()) return { file: primaryFile, url: primaryUrl };

  const fallbackFile = Bun.file(fallbackUrl);
  return { file: fallbackFile, url: fallbackUrl };
}

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

function notFound(message = "Not found") {
  return json({ error: message }, { status: 404 });
}

function badRequest(message = "Bad request") {
  return json({ error: message }, { status: 400 });
}

Bun.serve({
  port,
  hostname: "0.0.0.0",
  idleTimeout: 120, // 2 minutes for multi-specialist evaluation
  routes: {
    // ============================================================================
    // Original endpoints (preserved)
    // ============================================================================

    "/scenarios": {
      GET: () => json(listScenarios()),
    },

    // Simple static file serving for the demo UI
    "/": {
      GET: async () => {
        const { file } = await resolvePublicFile("index.html");
        if (!(await file.exists())) return notFound("UI not built");
        return new Response(file, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    },

    "/public/:path+": {
      GET: async (req) => {
        const relPath = req.params.path;
        try {
          const { file, url } = await resolvePublicFile(relPath);
          // Prevent escaping the public directory
          const allowed =
            url.pathname.startsWith(publicDir.pathname) ||
            url.pathname.startsWith(publicDirFallback.pathname);
          if (!allowed) return notFound();

          if (!(await file.exists())) return notFound();

          return new Response(file, {
            headers: { "content-type": file.type || "application/octet-stream" },
          });
        } catch {
          return notFound();
        }
      },
    },

    "/scenarios/:id/context": {
      GET: (req) => {
        const id = req.params.id as AvailableScenarioId | undefined;
        if (!id) return notFound();
        try {
          const { ctx, scenario } = createContextForScenario(id);
          return json({
            scenario: {
              id: scenario.id,
              title: scenario.title,
              description: scenario.description,
            },
            workingMemory: ctx.workingMemory,
            lanes: Array.from(ctx.lanes.entries()).map(([laneId, lane]) => ({
              id: laneId,
              name: lane.name,
              selected: lane.window.selected,
            })),
            activeWindow: ctx.activeWindow.selected,
          });
        } catch (err) {
          return notFound((err as Error).message);
        }
      },
    },

    "/scenarios/:id/llm": {
      POST: async (req) => {
        const id = req.params.id as AvailableScenarioId | undefined;
        if (!id) return notFound();
        let ctx, scenario;
        try {
          ({ ctx, scenario } = createContextForScenario(id));
        } catch (err) {
          return notFound((err as Error).message);
        }

        try {
          const openai = makeOpenAIClient();
          const system =
            "You are a clinical decision support assistant. Ground responses strictly in the provided working memory.";
          const user = `Working memory for scenario "${scenario.title}":\n${ctx.workingMemory.text}\n\nReturn a concise plan and cite which lane items you used.`;

          const completion = await openai.responses.create({
            model: "gpt-4o-mini-2024-07-18",
            input: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          });

          return json({
            scenario: scenario.id,
            workingMemory: ctx.workingMemory,
            response: completion.output_text,
          });
        } catch (err) {
          return json({ error: (err as Error).message }, { status: 500 });
        }
      },
    },

    // ============================================================================
    // New API endpoints for HTML UI
    // ============================================================================

    // --- Patients ---

    "/api/patients": {
      GET: (req) => {
        const url = new URL(req.url);
        const category = url.searchParams.get("category") || undefined;
        const critical = url.searchParams.get("critical");
        const minSeverity = url.searchParams.get("minSeverity");
        const maxSeverity = url.searchParams.get("maxSeverity");
        const limit = url.searchParams.get("limit");

        const patients = filterPatients({
          category,
          critical: critical ? critical === "true" : undefined,
          minSeverity: minSeverity ? parseInt(minSeverity) : undefined,
          maxSeverity: maxSeverity ? parseInt(maxSeverity) : undefined,
        });

        const limitNum = limit ? parseInt(limit) : 50;
        const summaries = patients.slice(0, limitNum).map(getPatientSummary);

        return json({
          patients: summaries,
          total: patients.length,
          stats: getDatasetStats(),
        });
      },
    },

    "/api/patients/:id": {
      GET: (req) => {
        const id = req.params.id;
        if (!id) return notFound();

        const patient = getPatient(id);
        if (!patient) return notFound(`Patient ${id} not found`);

        return json(patient);
      },
    },

    // --- Dynamic scenario generation ---

    "/api/scenarios/generate": {
      POST: async (req) => {
        try {
          const body = await req.json();
          const patientId = body.patientId as string;

          if (!patientId) {
            return badRequest("patientId is required");
          }

          const patient = getPatient(patientId);
          if (!patient) {
            return notFound(`Patient ${patientId} not found`);
          }

          const scenario = generateScenarioFromPatient(patient, body.config);

          return json(scenario);
        } catch (err) {
          return json({ error: (err as Error).message }, { status: 500 });
        }
      },
    },

    "/api/scenarios/generate/:patientId": {
      GET: (req) => {
        const patientId = req.params.patientId;
        if (!patientId) return notFound();

        const scenario = generateScenario(patientId);
        if (!scenario) return notFound(`Patient ${patientId} not found`);

        return json(scenario);
      },
    },

    "/api/scenarios/generate/:patientId/context": {
      GET: (req) => {
        const patientId = req.params.patientId;
        if (!patientId) return notFound();

        const patient = getPatient(patientId);
        if (!patient) return notFound(`Patient ${patientId} not found`);

        // Generate scenario from patient data
        const scenario = generateScenarioFromPatient(patient);

        // Create context and populate with scenario data
        const ctx = makeDefaultActiveMetaContext(`generated-${patientId}`);

        // Add knowledge objects from generated scenario
        scenario.goals.forEach((g) => ctx.upsertGoal(g));
        scenario.constraints.forEach((c) => ctx.upsertConstraint(c));
        scenario.assumptions.forEach((a) => ctx.upsertAssumption(a));
        scenario.evidence.forEach((e) => ctx.upsertEvidence(e));
        scenario.questions.forEach((q) => ctx.upsertQuestion(q));
        scenario.decisions.forEach((d) => ctx.upsertDecision(d));

        // Refresh lanes and synthesize working memory
        ctx.refreshAllLanes();
        ctx.mergeLanesToActiveWindow();
        ctx.synthesizeWorkingMemory({ tokenBudget: 700, archiveRawItems: false });

        return json({
          scenario: {
            id: scenario.id,
            title: scenario.title,
            description: scenario.description,
            patient: scenario.patient,
          },
          workingMemory: ctx.workingMemory,
          lanes: Array.from(ctx.lanes.entries()).map(([laneId, lane]) => ({
            id: laneId,
            name: lane.name,
            selected: lane.window.selected,
          })),
          activeWindow: ctx.activeWindow.selected,
        });
      },
    },

    "/api/scenarios/generate/:patientId/llm": {
      POST: async (req) => {
        const patientId = req.params.patientId;
        if (!patientId) return notFound();

        const patient = getPatient(patientId);
        if (!patient) return notFound(`Patient ${patientId} not found`);

        const scenario = generateScenarioFromPatient(patient);

        // Create context and populate
        const ctx = makeDefaultActiveMetaContext(`generated-${patientId}`);
        scenario.goals.forEach((g) => ctx.upsertGoal(g));
        scenario.constraints.forEach((c) => ctx.upsertConstraint(c));
        scenario.assumptions.forEach((a) => ctx.upsertAssumption(a));
        scenario.evidence.forEach((e) => ctx.upsertEvidence(e));
        scenario.questions.forEach((q) => ctx.upsertQuestion(q));
        scenario.decisions.forEach((d) => ctx.upsertDecision(d));

        ctx.refreshAllLanes();
        ctx.mergeLanesToActiveWindow();
        ctx.synthesizeWorkingMemory({ tokenBudget: 700, archiveRawItems: false });

        try {
          const openai = makeOpenAIClient();
          const system =
            "You are a clinical decision support assistant. Ground responses strictly in the provided working memory.";
          const user = `Working memory for scenario "${scenario.title}":\n${ctx.workingMemory.text}\n\nReturn a concise plan and cite which lane items you used.`;

          const completion = await openai.responses.create({
            model: "gpt-4o-mini-2024-07-18",
            input: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          });

          return json({
            scenario: scenario.id,
            patient: scenario.patient,
            workingMemory: ctx.workingMemory,
            response: completion.output_text,
          });
        } catch (err) {
          return json({ error: (err as Error).message }, { status: 500 });
        }
      },
    },

    // --- Multi-specialist evaluation (core active-meta-mgt pattern) ---

    "/api/specialists": {
      GET: () =>
        json({
          specialists: SPECIALISTS.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            color: s.color,
            icon: s.icon,
          })),
        }),
    },

    "/api/scenarios/generate/:patientId/evaluate": {
      POST: async (req) => {
        const patientId = req.params.patientId;
        if (!patientId) return notFound();

        const patient = getPatient(patientId);
        if (!patient) return notFound(`Patient ${patientId} not found`);

        // Parse request body for optional specialist filter
        let requestedSpecialists: string[] | undefined;
        try {
          const body = await req.json();
          requestedSpecialists = body.specialists;
        } catch {
          // No body or invalid JSON - use all specialists
        }

        const scenario = generateScenarioFromPatient(patient);
        const patientSummary = `${patient.age}${patient.gender} with ${patient.primary_diagnosis}`;

        // Filter specialists if requested
        const activeSpecialists = requestedSpecialists
          ? SPECIALISTS.filter((s) => requestedSpecialists!.includes(s.id))
          : SPECIALISTS;

        // Create a specialist-specific context and LLM call
        async function evaluateSpecialist(specialist: Specialist) {
          const ctx = makeDefaultActiveMetaContext(
            `${patientId}-${specialist.id}`
          );

          // Configure lane for this specialist
          const lane = ctx.lanes.get("task");
          if (lane) {
            lane.setWindowPolicy({
              wSeverity: specialist.policy.wSeverity,
              wConfidence: specialist.policy.wConfidence,
              wPriority: specialist.policy.wPriority,
              wRecency: specialist.policy.wRecency,
              maxItems: specialist.policy.maxItems,
              includeTagsAny: specialist.laneTags,
            });
          }

          // Add knowledge objects with specialist-relevant tags
          scenario.goals.forEach((g) => {
            // Add specialist tags to items that match
            const tags = [...g.tags];
            if (specialist.id === "monitoring") {
              tags.push({ key: "lane", value: "monitoring" });
            }
            ctx.upsertGoal({ ...g, tags });
          });

          scenario.constraints.forEach((c) => {
            const tags = [...c.tags];
            if (specialist.id === "medications") {
              tags.push({ key: "lane", value: "medications" });
            }
            ctx.upsertConstraint({ ...c, tags });
          });

          scenario.assumptions.forEach((a) => ctx.upsertAssumption(a));

          scenario.evidence.forEach((e) => {
            const tags = [...e.tags];
            if (specialist.id === "differential") {
              tags.push({ key: "lane", value: "differential" });
            }
            if (specialist.id === "risk") {
              tags.push({ key: "lane", value: "threat-model" });
            }
            ctx.upsertEvidence({ ...e, tags });
          });

          scenario.questions.forEach((q) => ctx.upsertQuestion(q));
          scenario.decisions.forEach((d) => ctx.upsertDecision(d));

          // Refresh and synthesize with specialist's token budget
          ctx.refreshAllLanes();
          ctx.mergeLanesToActiveWindow();
          ctx.synthesizeWorkingMemory({
            tokenBudget: specialist.tokenBudget,
            archiveRawItems: false,
          });

          const workingMemory = ctx.workingMemory.text;

          // Call LLM with specialist-specific prompts
          try {
            const openai = makeOpenAIClient();
            const userPrompt = specialist.userPromptTemplate
              .replace("{patient}", patientSummary)
              .replace("{workingMemory}", workingMemory);

            const completion = await openai.responses.create({
              model: "gpt-4o-mini-2024-07-18",
              input: [
                { role: "system", content: specialist.systemPrompt },
                { role: "user", content: userPrompt },
              ],
            });

            return {
              id: specialist.id,
              name: specialist.name,
              icon: specialist.icon,
              color: specialist.color,
              status: "success" as const,
              workingMemory,
              response: completion.output_text,
            };
          } catch (err) {
            return {
              id: specialist.id,
              name: specialist.name,
              icon: specialist.icon,
              color: specialist.color,
              status: "error" as const,
              workingMemory,
              error: (err as Error).message,
            };
          }
        }

        // Fan out to all specialists in parallel
        const results = await Promise.all(
          activeSpecialists.map(evaluateSpecialist)
        );

        return json({
          patientId,
          patient: {
            summary: patientSummary,
            diagnosis: patient.primary_diagnosis,
            category: patient.condition_category,
            severity: patient.severity_score,
            critical: patient.critical_flag,
          },
          scenario: {
            id: scenario.id,
            title: scenario.title,
          },
          specialists: results,
          timestamp: new Date().toISOString(),
        });
      },
    },

    // --- Scenario stats ---

    "/api/scenarios/stats": {
      GET: () => json(getScenarioStats()),
    },

    // --- Reference data ---

    "/api/reference/lab-ranges": {
      GET: () => {
        return json({
          ranges: labRanges,
          labs: getLabNames(),
        });
      },
    },

    "/api/reference/lab-ranges/:labName": {
      GET: (req) => {
        const labName = req.params.labName;
        if (!labName) return notFound();

        const range = labRanges[labName];
        if (!range) return notFound(`Lab ${labName} not found`);

        return json(range);
      },
    },

    "/api/reference/conditions": {
      GET: () => {
        const codes = getMappedIcdCodes();
        const conditions = codes.map((code) => ({
          icd9_code: code,
          ...icdToScenario[code],
        }));

        return json({
          conditions,
          total: conditions.length,
        });
      },
    },

    "/api/reference/conditions/:code": {
      GET: (req) => {
        const code = req.params.code;
        if (!code) return notFound();

        const mapping = icdToScenario[code];
        if (!mapping) return notFound(`ICD code ${code} not mapped`);

        return json({
          icd9_code: code,
          ...mapping,
        });
      },
    },

    "/api/reference/medications": {
      GET: () => {
        const medications = Object.entries(drugConstraints).map(
          ([name, rules]) => ({
            name,
            ...rules,
          })
        );

        return json({
          medications,
          total: medications.length,
        });
      },
    },

    "/api/reference/medications/:name": {
      GET: (req) => {
        const name = req.params.name?.toLowerCase();
        if (!name) return notFound();

        const rules = drugConstraints[name];
        if (!rules) return notFound(`Medication ${name} not found`);

        return json({
          name,
          ...rules,
        });
      },
    },

    // --- Health check ---

    "/api/health": {
      GET: () =>
        json({
          status: "ok",
          timestamp: new Date().toISOString(),
          patients: loadPatients().length,
        }),
    },
  },
  fetch() {
    return notFound();
  },
  error(err) {
    return json({ error: err.message }, { status: 500 });
  },
});

console.log(`Example server running on http://localhost:${port}`);
console.log(`
API Endpoints:
  Original:
    GET  /scenarios                          - List static scenarios
    GET  /scenarios/:id/context              - Get scenario context
    POST /scenarios/:id/llm                  - Query LLM with scenario

  New (for HTML UI):
    GET  /api/patients                       - List patients (with filters)
    GET  /api/patients/:id                   - Get patient details
    POST /api/scenarios/generate             - Generate scenario from patient
    GET  /api/scenarios/generate/:id         - Generate scenario (GET)
    GET  /api/scenarios/generate/:id/context - Get generated scenario context
    POST /api/scenarios/generate/:id/llm     - Query LLM with generated scenario
    GET  /api/scenarios/stats                - Get scenario statistics

  Multi-Specialist Evaluation (core active-meta-mgt pattern):
    GET  /api/specialists                    - List available specialists
    POST /api/scenarios/generate/:id/evaluate - Fan-out to all specialists in parallel

  Reference Data:
    GET  /api/reference/lab-ranges           - Get all lab reference ranges
    GET  /api/reference/lab-ranges/:name     - Get specific lab range
    GET  /api/reference/conditions           - List ICD condition mappings
    GET  /api/reference/conditions/:code     - Get specific ICD mapping
    GET  /api/reference/medications          - List medication rules
    GET  /api/reference/medications/:name    - Get specific medication rules
    GET  /api/health                         - Health check
`);
