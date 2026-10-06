# JPAI chatbot: deterministic HCP Q&A router on Databricks

Reference implementation of the AstraZeneca Japan HCP website chatbot flow. A question is routed by code using
classifier probabilities; the answer is always an approved template or the verbatim text of an Interview Form (IF)
section. No generated text is shown to the user.

- Routing flow: `docs/architecture/01-qa-routing-flow.drawio.png`
- Databricks architecture: `docs/architecture/02-databricks-architecture.drawio.png`
- Contracts (names, schemas, API, routing rules, decisions): `docs/CONTRACTS.md`
- Install in any workspace, operate, uninstall: `docs/RUNBOOK.md`
- Router API (the contract for the AWS ECS controller): `docs/API.md`, `app/server/routes/openapi.yaml`
- Evaluation: `src/eval/README.md`

## How it works
| step | Databricks component |
|---|---|
| PDF → parsed elements (+ page images) | `ai_parse_document` 2.0 in a serverless Lakeflow pipeline (`src/ingest`) |
| elements → IF sections (heading hierarchy, verbatim markdown) | section builder (Python, unit-tested) |
| sections → search chunks with context | `ai_prep_search` per section |
| chunks → hybrid index | AI Search Delta Sync index, `databricks-qwen3-embedding-0-6b` |
| master data, templates, sections for the app | Lakebase synced tables |
| one classification call per turn (AE, injection, request, conditions, small talk, intent) | System One API, `system.ai.openjev-qwen35-4b` |
| routing, retrieval, response assembly, AE queue, conversation state | Databricks App (AppKit, TypeScript), Lakebase |
| traces | MLflow experiment with a Unity Catalog trace location (OpenTelemetry export) |
| PV hand-off | `ae_notifier_job` → `pv_cases` |
| quality | `src/eval` (103 labelled cases, code scorers + LLM judge for tone and safety) |

## Repository
```
databricks.yml, resources/   bundle: variables, targets, schema, volumes, Lakebase, AI Search, pipeline, jobs, app
src/ingest/                  pipeline: parse, sections, chunks
src/jobs/                    seed, upload, publish, bootstrap (index, synced tables, grants), sync, AE notifier
src/eval/                    evaluation set and runner
data/docs/, data/reference/  IF PDFs; products, studies, synonyms, templates (template wording is PLACEHOLDER)
app/                         AppKit app: server/router (flow), server/routes (REST API), client (React UI, JA/EN)
scripts/install.sh           one-command install
```

## Quick start
```
databricks auth login --host https://<workspace> --profile <profile>
bash scripts/install.sh <profile> <target>
```
See `docs/RUNBOOK.md` for adding a target for a new workspace.

## Status
Template wording is placeholder (`status = PLACEHOLDER`) until AZ Medical / Legal / Regulatory approves it. Thresholds
are tuned on the evaluation set; the adverse-event band (`tau_ae`, `tau_ae_route`) is a pharmacovigilance policy
decision for AZ.
