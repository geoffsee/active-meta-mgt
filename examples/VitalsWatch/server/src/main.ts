const base = process.env.BASE_URL ?? "http://localhost:3333";
const scenarioId = process.env.SCENARIO_ID || undefined;

async function run() {
  console.log(`Target server: ${base}`);

  const scenariosRes = await fetch(`${base}/scenarios`);
  if (!scenariosRes.ok) {
    console.error(`Failed to fetch /scenarios: ${scenariosRes.status}`);
    process.exit(1);
  }
  const scenarios = (await scenariosRes.json()) as Array<{ id: string; title: string }>;
  if (!scenarios.length) {
    console.error("No scenarios available");
    process.exit(1);
  }

  const firstScenario = scenarios[0];
  if (!firstScenario) {
    console.error("Scenario list empty");
    process.exit(1);
  }
  const chosen = scenarioId ?? firstScenario.id;
  console.log(`Using scenario: ${chosen}`);

  const ctxRes = await fetch(`${base}/scenarios/${chosen}/context`);
  if (!ctxRes.ok) {
    console.error(`Failed to fetch context: ${ctxRes.status}`);
    process.exit(1);
  }
  const contextPayload = (await ctxRes.json()) as { workingMemory?: { text?: string } };
  console.log("Working memory:\n", contextPayload.workingMemory?.text ?? "<none>");

  // Optional: exercise the /llm endpoint if the server has OPENAI_API_KEY
  try {
    const llmRes = await fetch(`${base}/scenarios/${chosen}/llm`, { method: "POST" });
    if (llmRes.ok) {
      const llmPayload = (await llmRes.json()) as { response?: string };
      console.log("Model reply:\n", llmPayload.response ?? llmPayload);
    } else {
      console.warn(`/llm returned status ${llmRes.status}; skipping display`);
    }
  } catch (err) {
    console.warn("Skipping /llm call:", (err as Error).message);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
