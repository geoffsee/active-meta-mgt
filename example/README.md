# Active Meta-Context Example

Runnable Bun server that demonstrates how `active-meta-mgt` seeds lanes, synthesizes working memory, and calls the OpenAI SDK using clinical scenarios generated from real patient data.

## Data Sources

This example uses clinical datasets from Kaggle to generate realistic patient scenarios. See [`data/README.md`](./data/README.md) for full dataset documentation, licenses, and download instructions.

**Quick setup:**
```bash
# Install Kaggle CLI
pipx install kaggle

# Configure credentials (get token from https://www.kaggle.com/settings → API)
export KAGGLE_USERNAME=your_username
export KAGGLE_KEY=your_api_key

# Download datasets and generate unified patient data
./scripts/download-data.sh
```

The script downloads ~100MB of clinical data from 5 Kaggle datasets, then generates:
- `data/reference-ranges.json` — Lab reference ranges derived from CDC NHANES
- `data/patients.csv` — 129 unified patient records for scenario generation

## Run
```bash
cd example
bun install                 # installs active-meta-mgt from the parent folder
export OPENAI_API_KEY=sk-...  # required
bun run src/server.ts       # Bun.serve on port 3333 (override with PORT or BUN_PORT)
```

### One-shot run (server + client)
```bash
cd example
OPENAI_API_KEY=sk-... ./run_example.sh   # starts the server, waits, then runs the client probe
# Optional envs:
#   PORT=3333
#   BASE_URL=http://localhost:3333
#   SCENARIO_ID=acute-diabetes
#   LOG_FILE=/tmp/active-meta-mgt-example.log
```

### Client probe
With the server running, you can exercise the endpoints:
```bash
cd example
bun run src/main.ts               # hits /scenarios, /:id/context, then /:id/llm if available
# Optional envs:
#   BASE_URL=http://localhost:3333
#   SCENARIO_ID=acute-diabetes
```

## Endpoints
- `GET /scenarios` — list demo scenarios.
- `GET /scenarios/:id/context` — lane selections + working memory.
- `POST /scenarios/:id/llm` — sends working memory to OpenAI and returns the model reply.

## Files
- `src/server.ts` — Bun.serve routes.
- `src/scenarios.ts` — preset clinical-style scenarios.
- `src/openaiClient.ts` — OpenAI client helper.
