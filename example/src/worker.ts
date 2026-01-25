/**
 * Cloudflare Worker entry point for active-meta-mgt example.
 *
 * Uses the shared repository abstraction for portable persistence.
 */

/// <reference types="@cloudflare/workers-types" />

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { makeDefaultActiveMetaContext } from "active-meta-mgt";
import { SPECIALISTS, type Specialist } from "./specialists";
import {
  detectConflicts,
  makeSpecialistCoordinator,
  snapshotRuns,
  snapshotConflicts,
  snapshotFindings,
  snapshotFollowUps,
  structureSpecialistResponse,
  makeRunId,
} from "./specialistCoordinator";
import {
  listScenarios,
  createContextForScenario,
  type AvailableScenarioId,
} from "./scenarios";
import { labRanges, getLabNames } from "./data/reference/labRanges";
import { icdToScenario, getMappedIcdCodes } from "./data/reference/icdMapping";
import { drugConstraints } from "./data/reference/drugRules";
import type { Patient } from "./data/loaders/patients";
import OpenAI from "openai";
import { parseAndAlignCases, generateCredentials } from "./data/importer";
import { Buffer } from "node:buffer";

// Repository abstraction
import {
  createRepoContext,
  type IRepoContext,
  DEFAULT_PATIENT_COOLDOWN_MS,
} from "./repo";

// Polyfill Buffer for the Workers runtime
if (typeof globalThis.Buffer === "undefined") {
  (globalThis as any).Buffer = Buffer;
}

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

interface Env {
  PATIENTS_KV: KVNamespace;
  OPENAI_API_KEY: string;
  INGEST_API_KEY: string;
  INGEST_API_SECRET: string;
}

type Bindings = Env;

type Variables = {
  repo: IRepoContext;
};

// --------------------------------------------------------------------------
// App
// --------------------------------------------------------------------------

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Middleware
app.use("*", cors());
app.use("*", logger());

// Initialize repository context for each request
app.use("*", async (c, next) => {
  const repo = createRepoContext({
    runtime: "cloudflare",
    kv: c.env.PATIENTS_KV,
  });
  c.set("repo", repo);
  await next();
});

// --------------------------------------------------------------------------
// Authentication Helpers
// --------------------------------------------------------------------------

const AUTH_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

function getClientIP(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function computeHmacSha256(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, messageData);
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface AuthResult {
  authenticated: boolean;
  error?: string;
  statusCode?: number;
  patientId?: string;
}

async function verifyIngestAuth(
  env: Env,
  repo: IRepoContext,
  req: Request,
  body: string
): Promise<AuthResult> {
  // Try case-based authentication first (Basic Auth)
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Basic ")) {
    const base64 = authHeader.slice(6);
    const decoded = Buffer.from(base64, "base64").toString("utf-8");
    const [username, password] = decoded.split(":");

    if (username) {
      const cred = await repo.credentials.get(username);
      if (cred && timingSafeEqual(password || "", cred.password)) {
        return { authenticated: true, patientId: cred.patientId };
      }
      return { authenticated: false, error: "Invalid credentials", statusCode: 401 };
    }
  }

  // Try custom headers (X-Case-Username, X-Case-Password)
  const caseUsername = req.headers.get("X-Case-Username");
  const casePassword = req.headers.get("X-Case-Password");
  if (caseUsername && casePassword) {
    const cred = await repo.credentials.get(caseUsername);
    if (cred && timingSafeEqual(casePassword, cred.password)) {
      return { authenticated: true, patientId: cred.patientId };
    }
    return { authenticated: false, error: "Invalid credentials", statusCode: 401 };
  }

  // Fall back to HMAC authentication
  if (!env.INGEST_API_KEY || !env.INGEST_API_SECRET) {
    return {
      authenticated: false,
      error: "Ingest authentication not configured. Set INGEST_API_KEY and INGEST_API_SECRET secrets.",
      statusCode: 503,
    };
  }

  const apiKey = req.headers.get("X-API-Key");
  const signature = req.headers.get("X-Signature");
  const timestamp = req.headers.get("X-Timestamp");

  if (!apiKey || !signature || !timestamp) {
    return {
      authenticated: false,
      error: "Missing required authentication headers: X-API-Key, X-Signature, X-Timestamp",
      statusCode: 401,
    };
  }

  if (!timingSafeEqual(apiKey, env.INGEST_API_KEY)) {
    return { authenticated: false, error: "Invalid API key", statusCode: 401 };
  }

  const requestTime = parseInt(timestamp, 10);
  if (isNaN(requestTime)) {
    return { authenticated: false, error: "Invalid timestamp format", statusCode: 401 };
  }

  const now = Date.now();
  if (Math.abs(now - requestTime) > AUTH_TIMESTAMP_TOLERANCE_MS) {
    return {
      authenticated: false,
      error: "Request timestamp expired or invalid (must be within 5 minutes)",
      statusCode: 401,
    };
  }

  const url = new URL(req.url);
  const signaturePayload = `${timestamp}${req.method}${url.pathname}${body}`;
  const expectedSignature = await computeHmacSha256(env.INGEST_API_SECRET, signaturePayload);

  if (!timingSafeEqual(signature, expectedSignature)) {
    return { authenticated: false, error: "Invalid signature", statusCode: 401 };
  }

  return { authenticated: true };
}

// --------------------------------------------------------------------------
// Scenario Generation
// --------------------------------------------------------------------------

function generateScenarioFromPatient(patient: Patient) {
  const id = `generated-${patient.patient_id}`;
  const title = `${patient.primary_diagnosis} - ${patient.age}${patient.gender}`;
  const description = `Automated scenario for patient ${patient.patient_id}`;

  const goals = [
    {
      id: `${id}-goal-1`,
      title: `Manage ${patient.primary_diagnosis}`,
      description: `Primary treatment goal for ${patient.primary_diagnosis}`,
      priority: "p0" as const,
      tags: [{ key: "lane", value: "task" }],
    },
  ];

  const constraints = patient.allergies.map((allergy, i) => ({
    id: `${id}-constraint-${i}`,
    statement: `Allergy: ${allergy} - Patient has documented allergy to ${allergy}`,
    tags: [{ key: "lane", value: "medications" }],
  }));

  const assumptions = [
    {
      id: `${id}-assumption-1`,
      statement: `Patient demographics: ${patient.age}${patient.gender}, ${patient.admission_type}`,
      confidence: "high" as const,
      tags: [{ key: "lane", value: "task" }],
    },
  ];

  const evidence: any[] = [];
  const v = patient.vitals;

  if (v.spo2 != null) {
    evidence.push({
      id: `${id}-ev-spo2`,
      summary: `SpO2: ${v.spo2}%`,
      severity: v.spo2 < 90 ? "critical" : v.spo2 < 94 ? "high" : "low",
      confidence: 0.95,
      tags: [{ key: "lane", value: "monitoring" }],
    });
  }
  if (v.heart_rate != null) {
    evidence.push({
      id: `${id}-ev-hr`,
      summary: `Heart rate: ${v.heart_rate} bpm`,
      severity: v.heart_rate > 120 ? "critical" : v.heart_rate > 100 ? "high" : "low",
      confidence: 0.95,
      tags: [{ key: "lane", value: "monitoring" }],
    });
  }
  if (v.systolic_bp != null && v.diastolic_bp != null) {
    evidence.push({
      id: `${id}-ev-bp`,
      summary: `BP: ${Math.round(v.systolic_bp)}/${Math.round(v.diastolic_bp)} mmHg`,
      severity: v.systolic_bp < 90 ? "critical" : v.systolic_bp < 100 ? "high" : "low",
      confidence: 0.95,
      tags: [{ key: "lane", value: "monitoring" }],
    });
  }

  const l = patient.labs;
  if (l.lactate != null) {
    evidence.push({
      id: `${id}-ev-lactate`,
      summary: `Lactate: ${l.lactate} mmol/L`,
      severity: l.lactate > 4 ? "critical" : l.lactate > 2 ? "high" : "low",
      confidence: 0.9,
      tags: [
        { key: "lane", value: "differential" },
        { key: "lane", value: "threat-model" },
      ],
    });
  }
  if (l.creatinine != null) {
    evidence.push({
      id: `${id}-ev-creat`,
      summary: `Creatinine: ${l.creatinine} mg/dL`,
      severity: l.creatinine > 2 ? "critical" : l.creatinine > 1.3 ? "high" : "low",
      confidence: 0.9,
      tags: [{ key: "lane", value: "differential" }],
    });
  }

  const questions = [
    {
      id: `${id}-q-1`,
      question: `What is the optimal treatment approach for ${patient.primary_diagnosis}?`,
      tags: [{ key: "lane", value: "task" }],
    },
  ];

  const decisions: any[] = [];

  return {
    id,
    title,
    description,
    patient: {
      id: patient.patient_id,
      age: patient.age,
      gender: patient.gender,
      diagnosis: patient.primary_diagnosis,
      category: patient.condition_category,
      severity: patient.severity_score,
      critical: patient.critical_flag,
    },
    goals,
    constraints,
    assumptions,
    evidence,
    questions,
    decisions,
  };
}

function getPatientSummary(p: Patient) {
  return {
    id: p.patient_id,
    age: p.age,
    gender: p.gender,
    primaryDiagnosis: p.primary_diagnosis,
    category: p.condition_category,
    severityScore: p.severity_score,
    criticalFlag: p.critical_flag,
  };
}

// --------------------------------------------------------------------------
// OpenAI Helper
// --------------------------------------------------------------------------

function makeOpenAI(apiKey: string): OpenAI {
  return new OpenAI({ apiKey });
}

// --------------------------------------------------------------------------
// Routes
// --------------------------------------------------------------------------

// Health check
app.get("/api/health", async (c) => {
  const repo = c.get("repo");
  const patients = await repo.patients.loadAll();
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    patients: patients.length,
    runtime: "cloudflare-workers",
  });
});

// Scenarios (hardcoded)
app.get("/scenarios", (c) => {
  return c.json(listScenarios());
});

app.get("/scenarios/:id/context", (c) => {
  const id = c.req.param("id") as AvailableScenarioId;
  try {
    const { ctx, scenario } = createContextForScenario(id);
    return c.json({
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
    return c.json({ error: (err as Error).message }, 404);
  }
});

app.post("/scenarios/:id/llm", async (c) => {
  const id = c.req.param("id") as AvailableScenarioId;
  let ctx, scenario;
  try {
    ({ ctx, scenario } = createContextForScenario(id));
  } catch (err) {
    return c.json({ error: (err as Error).message }, 404);
  }

  try {
    const openai = makeOpenAI(c.env.OPENAI_API_KEY);
    const system =
      "You are a clinical decision support assistant. Ground responses strictly in the provided working memory.";
    const user = `Working memory for scenario "${scenario.title}":\n${ctx.workingMemory.text}\n\nReturn a concise plan and cite which lane items you used.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    return c.json({
      scenario: scenario.id,
      workingMemory: ctx.workingMemory,
      response: completion.choices[0]?.message?.content,
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Patients
app.get("/api/patients", async (c) => {
  const repo = c.get("repo");
  const url = new URL(c.req.url);
  const category = url.searchParams.get("category") || undefined;
  const critical = url.searchParams.get("critical");
  const minSeverity = url.searchParams.get("minSeverity");
  const maxSeverity = url.searchParams.get("maxSeverity");
  const limit = url.searchParams.get("limit");

  const allPatients = await repo.patients.loadAll();
  const patients = await repo.patients.filter({
    category,
    critical: critical ? critical === "true" : undefined,
    minSeverity: minSeverity ? parseInt(minSeverity) : undefined,
    maxSeverity: maxSeverity ? parseInt(maxSeverity) : undefined,
  });

  const limitNum = limit ? parseInt(limit) : 50;
  const summaries = patients.slice(0, limitNum).map(getPatientSummary);
  const stats = await repo.patients.getStats();

  return c.json({
    patients: summaries,
    total: patients.length,
    stats,
  });
});

app.get("/api/patients/:id", async (c) => {
  const repo = c.get("repo");
  const id = c.req.param("id");

  // Check for case credentials (Basic Auth or custom headers)
  const authHeader = c.req.header("authorization");
  const customUsername = c.req.header("x-case-username");
  const customPassword = c.req.header("x-case-password");

  let username: string | undefined;
  let password: string | undefined;

  if (authHeader?.startsWith("Basic ")) {
    try {
      const decoded = atob(authHeader.slice(6));
      const [u, p] = decoded.split(":");
      username = u;
      password = p;
    } catch {
      // Invalid base64
    }
  } else if (customUsername && customPassword) {
    username = customUsername;
    password = customPassword;
  }

  // Verify credentials grant access to this specific patient
  if (!username || !password) {
    return c.json(
      { error: "Authentication required", message: "Provide case credentials to access patient details" },
      401,
      { "WWW-Authenticate": 'Basic realm="case"' }
    );
  }

  const storedCred = await repo.credentials.get(username);
  if (!storedCred || storedCred.password !== password) {
    return c.json(
      { error: "Invalid credentials", message: "Username or password is incorrect" },
      401
    );
  }

  // Ensure credentials are for THIS patient only
  if (storedCred.patientId !== id) {
    return c.json(
      { error: "Access denied", message: "These credentials do not grant access to this patient" },
      403
    );
  }

  const patient = await repo.patients.getById(id);
  if (!patient) {
    return c.json({ error: `Patient ${id} not found` }, 404);
  }
  return c.json(patient);
});

// Specialists
app.get("/api/specialists", (c) => {
  return c.json({
    specialists: SPECIALISTS.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      color: s.color,
      icon: s.icon,
    })),
  });
});

// Scenario generation
app.get("/api/scenarios/generate/:patientId", async (c) => {
  const repo = c.get("repo");
  const patientId = c.req.param("patientId");
  const patient = await repo.patients.getById(patientId);
  if (!patient) {
    return c.json({ error: `Patient ${patientId} not found` }, 404);
  }
  const scenario = generateScenarioFromPatient(patient);
  return c.json(scenario);
});

app.get("/api/scenarios/generate/:patientId/context", async (c) => {
  const repo = c.get("repo");
  const patientId = c.req.param("patientId");
  const patient = await repo.patients.getById(patientId);
  if (!patient) {
    return c.json({ error: `Patient ${patientId} not found` }, 404);
  }

  const scenario = generateScenarioFromPatient(patient);
  const ctx = makeDefaultActiveMetaContext(`generated-${patientId}`);

  scenario.goals.forEach((g) => ctx.upsertGoal(g));
  scenario.constraints.forEach((con) => ctx.upsertConstraint(con));
  scenario.assumptions.forEach((a) => ctx.upsertAssumption(a));
  scenario.evidence.forEach((e) => ctx.upsertEvidence(e));
  scenario.questions.forEach((q) => ctx.upsertQuestion(q));
  scenario.decisions.forEach((d) => ctx.upsertDecision(d));

  ctx.refreshAllLanes();
  ctx.mergeLanesToActiveWindow();
  ctx.synthesizeWorkingMemory({ tokenBudget: 700, archiveRawItems: false });

  return c.json({
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
});

// Multi-specialist evaluation
app.post("/api/scenarios/generate/:patientId/evaluate", async (c) => {
  const repo = c.get("repo");
  const patientId = c.req.param("patientId");
  const patient = await repo.patients.getById(patientId);
  if (!patient) {
    return c.json({ error: `Patient ${patientId} not found` }, 404);
  }

  // Check per-patient rate limit (cooldown)
  const cooldown = await repo.cooldown.check(patientId, DEFAULT_PATIENT_COOLDOWN_MS);
  if (!cooldown.allowed) {
    const remainingSeconds = Math.ceil(cooldown.remainingMs / 1000);
    return c.json(
      {
        error: "Rate limited",
        message: `Patient ${patientId} was recently evaluated. Please wait ${remainingSeconds} seconds before re-evaluating.`,
        retryAfter: remainingSeconds,
        patientId,
      },
      {
        status: 429,
        headers: { "Retry-After": String(remainingSeconds) },
      }
    );
  }

  let requestedSpecialists: string[] | undefined;
  let forceRefresh = false;
  try {
    const body = await c.req.json();
    requestedSpecialists = body.specialists;
    forceRefresh = body.refresh === true;
  } catch {
    // No body or invalid JSON
  }

  const url = new URL(c.req.url);
  if (url.searchParams.get("refresh") === "true") {
    forceRefresh = true;
  }

  // Check cached evaluation unless forced refresh
  if (!forceRefresh) {
    const cached = await repo.evaluations.getCached(patientId, DEFAULT_PATIENT_COOLDOWN_MS);
    if (cached) {
      return c.json({ ...cached, cached: true });
    }
  }

  let openai: OpenAI;
  try {
    openai = makeOpenAI(c.env.OPENAI_API_KEY);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }

  const scenario = generateScenarioFromPatient(patient);
  const patientSummary = `${patient.age}${patient.gender} with ${patient.primary_diagnosis}`;

  const activeSpecialists = requestedSpecialists
    ? SPECIALISTS.filter((s) => requestedSpecialists!.includes(s.id))
    : SPECIALISTS;

  async function evaluateSpecialist(specialist: Specialist) {
    const ctx = makeDefaultActiveMetaContext(`${patientId}-${specialist.id}`);

    const lane = ctx.lanes.get("task");
    if (lane) {
      lane.setWindowPolicy({
        wSeverity: specialist.policy.wSeverity,
        wConfidence: specialist.policy.wConfidence,
        wPriority: specialist.policy.wPriority,
        wRecency: specialist.policy.wRecency,
        maxItems: specialist.policy.maxItems,
      });
      lane.setIncludeTagsAny(specialist.laneTags);
    }

    scenario.goals.forEach((g) => {
      const tags = [...g.tags];
      if (specialist.id === "monitoring") {
        tags.push({ key: "lane", value: "monitoring" });
      }
      ctx.upsertGoal({ ...g, tags });
    });

    scenario.constraints.forEach((con) => {
      const tags = [...con.tags];
      if (specialist.id === "medications") {
        tags.push({ key: "lane", value: "medications" });
      }
      ctx.upsertConstraint({ ...con, tags });
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

    ctx.refreshAllLanes();
    ctx.mergeLanesToActiveWindow();
    ctx.synthesizeWorkingMemory({
      tokenBudget: specialist.tokenBudget,
      archiveRawItems: false,
    });

    const workingMemory = ctx.workingMemory.text;

    try {
      const userPrompt = specialist.userPromptTemplate
        .replace("{patient}", patientSummary)
        .replace("{workingMemory}", workingMemory);

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
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
        response: completion.choices[0]?.message?.content,
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

  const results = await Promise.all(activeSpecialists.map(evaluateSpecialist));

  // Post-process
  const coordinator = makeSpecialistCoordinator();

  for (const result of results) {
    if (result.status !== "success") continue;
    try {
      const specialist = SPECIALISTS.find((s) => s.id === result.id);
      if (!specialist) continue;
      const findings = await structureSpecialistResponse({
        openai,
        specialist,
        patientId,
        patientSummary,
        workingMemory: result.workingMemory,
        rawResponse: result.response ?? "",
        maxItems: 8,
      });
      coordinator.addRun({
        id: makeRunId(patientId, result.id, result.response ?? ""),
        specialistId: result.id,
        workingMemory: result.workingMemory,
        rawText: result.response ?? "",
        findings,
      });
    } catch {
      coordinator.addRun({
        id: `${patientId}-${result.id}-${Date.now().toString(36)}-err`,
        specialistId: result.id,
        workingMemory: result.workingMemory,
        rawText: result.response ?? "",
        findings: [],
      });
    }
  }

  try {
    const conflicts = await detectConflicts({
      openai,
      findings: snapshotFindings(coordinator),
      maxItems: 6,
    });
    coordinator.setConflicts(conflicts);
  } catch {
    // leave conflicts empty
  }

  const response = {
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
    structured: {
      runs: snapshotRuns(coordinator.runs),
      findings: snapshotFindings(coordinator),
      conflicts: snapshotConflicts(coordinator),
      followUps: snapshotFollowUps(coordinator),
    },
    timestamp: new Date().toISOString(),
  };

  // Record evaluation for rate limiting (fire and forget)
  repo.cooldown.record(patientId, DEFAULT_PATIENT_COOLDOWN_MS).catch(() => {});

  // Persist evaluation to audit log (fire and forget)
  repo.evaluations.append(response).catch((err) => {
    console.error("Failed to persist evaluation:", err);
  });

  return c.json({ ...response, cached: false });
});

// Ingest (protected with HIPAA-compliant authentication)
app.post("/api/ingest", async (c) => {
  const repo = c.get("repo");
  const clientIP = getClientIP(c.req.raw);
  const userAgent = c.req.header("user-agent") || "unknown";
  const apiKeyPrefix = (c.req.header("X-API-Key") || "").slice(0, 8) || "none";

  let bodyText: string;
  try {
    bodyText = await c.req.text();
  } catch {
    return c.json({ error: "Failed to read request body" }, 400);
  }

  const authResult = await verifyIngestAuth(c.env, repo, c.req.raw, bodyText);
  if (!authResult.authenticated) {
    repo.auditLog.log({
      timestamp: new Date().toISOString(),
      action: "ingest_auth_failure",
      apiKeyPrefix,
      ip: clientIP,
      userAgent,
      path: "/api/ingest",
      method: "POST",
      reason: authResult.error,
    }).catch(() => {});

    const status = (authResult.statusCode || 401) as ContentfulStatusCode;
    return c.json(
      {
        error: "Authentication failed",
        message: authResult.error,
        documentation: "https://docs.example.com/api/authentication",
      },
      status,
      { "WWW-Authenticate": 'HMAC-SHA256 realm="ingest"' }
    );
  }

  try {
    const contentType = c.req.header("content-type") || "";
    const casePatientId = authResult.patientId;

    const enforcePatientId = (item: Record<string, unknown>) => {
      if (casePatientId) {
        return { ...item, patient_id: casePatientId };
      }
      return item;
    };

    let records: any[] = [];

    if (contentType.includes("application/x-ndjson") || contentType.includes("text/plain")) {
      const lines = bodyText.split("\n").filter(Boolean);
      for (const line of lines) {
        records.push(await repo.ingest.append(enforcePatientId(JSON.parse(line))));
      }
    } else {
      const body = JSON.parse(bodyText);
      if (Array.isArray(body)) {
        for (const item of body) {
          records.push(await repo.ingest.append(enforcePatientId(item)));
        }
      } else {
        records.push(await repo.ingest.append(enforcePatientId(body)));
      }
    }

    // Invalidate patient cache after ingest
    repo.patients.invalidateCache();

    repo.auditLog.log({
      timestamp: new Date().toISOString(),
      action: "ingest_auth_success",
      apiKeyPrefix,
      ip: clientIP,
      userAgent,
      path: "/api/ingest",
      method: "POST",
      recordCount: records.length,
    }).catch(() => {});

    return c.json({ ingested: records.length, records });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// Import (align + ingest) - no auth, intended for demo UI
app.post("/api/import", async (c) => {
  const repo = c.get("repo");
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const content = body?.content;
  const format = body?.format as "json" | "csv" | undefined;

  if (!content || typeof content !== "string") {
    return c.json({ error: "content (string) is required" }, 400);
  }

  try {
    const aligned = parseAndAlignCases(content, format);
    const records: any[] = [];

    for (const cased of aligned) {
      records.push(await repo.ingest.append(cased.aligned));
      // Register credentials
      await repo.credentials.set(cased.credentials.username, {
        password: cased.credentials.password,
        patientId: cased.aligned.patient_id as string,
      });
    }

    // Invalidate patient cache
    repo.patients.invalidateCache();

    return c.json({
      ingested: records.length,
      cases: aligned.map((cased, idx) => ({
        patientId: cased.aligned.patient_id,
        username: cased.credentials.username,
        password: cased.credentials.password,
        timestamp: records[idx]?._ts,
      })),
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// Create case with auto-generated credentials (for demo UI)
app.post("/api/cases", async (c) => {
  const repo = c.get("repo");
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  // Ensure patient_id exists
  const patientId = body.patient_id || `P${Date.now()}`;
  const patientData = { ...body, patient_id: patientId };

  try {
    // Generate credentials for this case
    const creds = generateCredentials(patientId);

    // Store the patient record
    const record = await repo.ingest.append({
      ...patientData,
      _source: "cases-api",
    });

    // Store the credentials
    await repo.credentials.set(creds.username, {
      password: creds.password,
      patientId: patientId,
    });

    // Invalidate patient cache
    repo.patients.invalidateCache();

    return c.json({
      success: true,
      patientId,
      credentials: {
        username: creds.username,
        password: creds.password,
      },
      record,
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// Debug: List all stored credentials (for development only)
app.get("/api/credentials", async (c) => {
  const repo = c.get("repo");
  const creds = await repo.credentials.loadAll();
  const entries: { username: string; patientId: string }[] = [];
  creds.forEach((val, key) => {
    entries.push({ username: key, patientId: val.patientId });
  });
  return c.json({ count: entries.length, credentials: entries });
});

// Generate credentials for an existing case (if none exist)
app.post("/api/cases/:id/credentials", async (c) => {
  const repo = c.get("repo");
  const patientId = c.req.param("id");

  // Check if patient exists
  const patient = await repo.patients.getById(patientId);
  if (!patient) {
    return c.json({ error: `Patient ${patientId} not found` }, 404);
  }

  // Check if credentials already exist for this patient
  const allCreds = await repo.credentials.loadAll();
  let existingUsername: string | null = null;
  allCreds.forEach((cred, username) => {
    if (cred.patientId === patientId) {
      existingUsername = username;
    }
  });

  if (existingUsername) {
    return c.json({
      error: "Credentials already exist for this patient",
      message: `Use username: ${existingUsername}`,
    }, 409);
  }

  // Generate new credentials
  const creds = generateCredentials(patientId);
  await repo.credentials.set(creds.username, {
    password: creds.password,
    patientId: patientId,
  });

  return c.json({
    success: true,
    patientId,
    credentials: {
      username: creds.username,
      password: creds.password,
    },
  });
});

app.get("/api/ingest/log", async (c) => {
  const repo = c.get("repo");
  const url = new URL(c.req.url);
  const limit = parseInt(url.searchParams.get("limit") || "100");
  const log = await repo.ingest.readLog();
  return c.json({
    total: log.length,
    records: log.slice(-limit),
  });
});

app.get("/api/ingest/patients", async (c) => {
  const repo = c.get("repo");
  const patients = await repo.patients.loadAll();
  return c.json({
    total: patients.length,
    patients: patients.map((p) => ({
      id: p.patient_id,
      age: p.age,
      gender: p.gender,
      diagnosis: p.primary_diagnosis,
      category: p.condition_category,
      severity: p.severity_score,
      critical: p.critical_flag,
    })),
  });
});

// Audit log access (requires API key)
app.get("/api/ingest/audit", async (c) => {
  const repo = c.get("repo");
  const apiKey = c.req.header("X-API-Key");
  if (!c.env.INGEST_API_KEY || apiKey !== c.env.INGEST_API_KEY) {
    return c.json(
      { error: "Unauthorized - API key required to access audit logs" },
      401
    );
  }

  const url = new URL(c.req.url);
  const limit = parseInt(url.searchParams.get("limit") || "100");
  const action = url.searchParams.get("action") as "ingest_auth_success" | "ingest_auth_failure" | null;

  const entries = await repo.auditLog.getEntries({
    limit,
    action: action || undefined,
  });

  return c.json({
    total: await repo.auditLog.count(),
    entries,
  });
});

// Reference data
app.get("/api/reference/lab-ranges", (c) => {
  return c.json({
    ranges: labRanges,
    labs: getLabNames(),
  });
});

app.get("/api/reference/lab-ranges/:labName", (c) => {
  const labName = c.req.param("labName");
  const range = labRanges[labName];
  if (!range) {
    return c.json({ error: `Lab ${labName} not found` }, 404);
  }
  return c.json(range);
});

app.get("/api/reference/conditions", (c) => {
  const codes = getMappedIcdCodes();
  const conditions = codes.map((code) => ({
    icd9_code: code,
    ...icdToScenario[code],
  }));
  return c.json({
    conditions,
    total: conditions.length,
  });
});

app.get("/api/reference/conditions/:code", (c) => {
  const code = c.req.param("code");
  const mapping = icdToScenario[code];
  if (!mapping) {
    return c.json({ error: `ICD code ${code} not mapped` }, 404);
  }
  return c.json({
    icd9_code: code,
    ...mapping,
  });
});

app.get("/api/reference/medications", (c) => {
  const medications = Object.entries(drugConstraints).map(([name, rules]) => ({
    name,
    ...rules,
  }));
  return c.json({
    medications,
    total: medications.length,
  });
});

app.get("/api/reference/medications/:name", (c) => {
  const name = c.req.param("name")?.toLowerCase();
  if (!name) {
    return c.json({ error: "Medication name required" }, 400);
  }
  const rules = drugConstraints[name];
  if (!rules) {
    return c.json({ error: `Medication ${name} not found` }, 404);
  }
  return c.json({
    name,
    ...rules,
  });
});

app.get("/api/scenarios/stats", async (c) => {
  const repo = c.get("repo");
  const patients = await repo.patients.loadAll();
  return c.json({
    totalPatients: patients.length,
    categories: Array.from(new Set(patients.map((p) => p.condition_category))),
  });
});

// --- Evaluation history ---

app.get("/api/evaluations", async (c) => {
  const repo = c.get("repo");
  const stats = await repo.evaluations.getStats();
  return c.json(stats);
});

app.get("/api/evaluations/:patientId", async (c) => {
  const repo = c.get("repo");
  const patientId = c.req.param("patientId");
  if (!patientId) {
    return c.json({ error: "Patient ID required" }, 400);
  }

  const evals = await repo.evaluations.getByPatient(patientId);
  return c.json({
    patientId,
    evaluations: evals,
    count: evals.length,
  });
});

app.get("/api/evaluations/:patientId/latest", async (c) => {
  const repo = c.get("repo");
  const patientId = c.req.param("patientId");
  if (!patientId) {
    return c.json({ error: "Patient ID required" }, 400);
  }

  const latest = await repo.evaluations.getLatest(patientId);
  if (!latest) {
    return c.json({ error: `No evaluations found for patient ${patientId}` }, 404);
  }

  return c.json(latest);
});

// --- Request logs ---

app.get("/api/logs/requests", async (c) => {
  const repo = c.get("repo");
  const url = new URL(c.req.url);
  const limit = parseInt(url.searchParams.get("limit") || "100", 10);
  const path = url.searchParams.get("path") || undefined;
  const method = url.searchParams.get("method") || undefined;
  const minStatus = url.searchParams.get("minStatus")
    ? parseInt(url.searchParams.get("minStatus")!, 10)
    : undefined;

  const logs = await repo.requestLog.getEntries({ limit, path, method, minStatus });
  return c.json({
    logs,
    count: logs.length,
  });
});

app.get("/api/logs/requests/stats", async (c) => {
  const repo = c.get("repo");
  const stats = await repo.requestLog.getStats();
  return c.json(stats);
});

// Catch-all for 404
app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

export default app;
