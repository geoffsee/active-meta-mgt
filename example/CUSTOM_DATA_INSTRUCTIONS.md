# Data Ingestion

All data flows through the same ingest pattern - including the example dataset.

```
POST /api/ingest  →  data/ingest.jsonl  →  loadPatients()
```

Pipe in whatever you have. We'll figure it out.

## Quick Examples

```bash
# Single patient
curl -X POST localhost:3333/api/ingest \
  -H 'Content-Type: application/json' \
  -d '{"id": "P1", "age": 65, "diagnosis": "Chest Pain", "bp": "140/90"}'

# Multiple patients
curl -X POST localhost:3333/api/ingest \
  -H 'Content-Type: application/json' \
  -d '[
    {"id": "P1", "age": 65, "diagnosis": "Sepsis", "critical": true},
    {"id": "P2", "age": 42, "diagnosis": "Pneumonia", "spo2": 91}
  ]'

# From a file (JSONL)
cat mydata.jsonl | curl -X POST localhost:3333/api/ingest \
  -H 'Content-Type: application/x-ndjson' --data-binary @-

# Check what got ingested
curl localhost:3333/api/ingest/patients
```

## Field Aliases

Use whatever field names you have. We normalize them:

| Your Field | Also Accepts |
|------------|--------------|
| `id` | `patient_id`, `mrn`, `patientId`, `subject_id` |
| `age` | (just `age`) |
| `gender` | `sex` (M/F/Male/Female/1/0) |
| `diagnosis` | `primary_diagnosis`, `dx`, `chief_complaint` |
| `bp` | `blood_pressure` (parses "120/80" format) |
| `hr` | `heart_rate`, `pulse` |
| `spo2` | `o2sat`, `oxygen_saturation` |
| `temp` | `temperature` |
| `hgb` | `hemoglobin`, `hb` |
| `cr` | `creatinine` |
| `meds` | `medications`, `drugs` |

## Minimal Patient

Only `id` is truly required. Everything else has defaults:

```json
{"id": "P1", "diagnosis": "Chest Pain"}
```

## Rich Patient

Include whatever data you have:

```json
{
  "id": "P123",
  "age": 72,
  "gender": "F",
  "diagnosis": "Sepsis",
  "category": "infectious",
  "critical": true,
  "severity": 8,
  "bp": "90/60",
  "hr": 110,
  "spo2": 92,
  "temp": 101.5,
  "rr": 24,
  "labs": {
    "wbc": 18.5,
    "lactate": 4.2,
    "creatinine": 2.1
  },
  "medications": ["Vancomycin", "Norepinephrine"],
  "allergies": ["Penicillin"]
}
```

## Incremental Updates

Data is append-only. Send updates to the same patient ID:

```bash
# Initial admission
curl -X POST localhost:3333/api/ingest -d '{"id":"P1","diagnosis":"Chest Pain"}'

# Add vitals later
curl -X POST localhost:3333/api/ingest -d '{"id":"P1","bp":"140/90","hr":88}'

# Add labs later
curl -X POST localhost:3333/api/ingest -d '{"id":"P1","labs":{"troponin":0.04}}'
```

Latest values win when patient state is reconstructed.

## View Log

```bash
# See raw ingest log
curl localhost:3333/api/ingest/log

# See normalized patients
curl localhost:3333/api/ingest/patients
```

## Evaluate Ingested Patients

Once ingested, patients appear in the main list and can be evaluated:

```bash
# List all patients (CSV + ingested)
curl localhost:3333/api/patients

# Run multi-specialist evaluation
curl -X POST localhost:3333/api/scenarios/generate/P1/evaluate
```

## Storage

All patient data lives in `data/ingest.jsonl` (append-only JSONL).

The example dataset uses the same file - regenerate it with:
```bash
bun run scripts/prepare-dataset.ts
```

Delete the file to start fresh, or just append your own data on top.
