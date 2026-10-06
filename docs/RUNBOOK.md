# Runbook: install, operate, uninstall

Everything is one Databricks Asset Bundle (`databricks.yml` + `resources/*.yml`). `scripts/install.sh` runs the steps
below in order; each step is idempotent, so the script can be re-run after a failure.

## Prerequisites (target workspace)
- Databricks CLI 1.18 or newer, logged in: `databricks auth login --host https://<workspace> --profile <profile>`.
- Unity Catalog catalog where you can `CREATE SCHEMA` (the bundle creates `<catalog>.<schema>` and two volumes).
- Serverless SQL warehouse (`warehouse_id`), serverless jobs and pipelines, Databricks Apps.
- Lakebase Autoscaling (the bundle creates a project), AI Search (the bundle creates a STANDARD endpoint).
- Model services: System One `system.ai.openjev-qwen35-4b` (routing), `databricks-qwen3-embedding-0-6b` (index
  embeddings). Optional: `databricks-claude-opus-5-5` (evaluation judge only). In regions where a model is not served
  locally, cross-geo processing must be enabled for the workspace.

## Install into a new workspace
Follow `README.md` section 2: `bash scripts/install.sh` (asks for the workspace URL, catalog and SQL warehouse) or the
step-by-step commands. The default bundle target `az` has no workspace host: it comes from the CLI profile, and
`catalog` / `warehouse_id` come from `install.sh` (saved in `.databricks/bundle/az/variable-overrides.json`), `--var`
or `BUNDLE_VAR_*` environment variables. Order of the steps and why:
1. `/Shared/<prefix>-chatbot` must exist before the MLflow experiment is created;
2. `bundle deploy`: schema, volumes, Lakebase project, AI Search endpoint, pipeline, jobs, experiment, app;
3. `ingest_job`: seeds master data, copies `data/docs/*.pdf` to the docs volume, parses and chunks, publishes tables;
4. `bootstrap_job`: AI Search index and Lakebase synced tables (they need the published tables);
5. start the app, then `bootstrap_job` again to grant the app service principal its access (UC, Postgres, traces).

Existing installs made before the `az` target existed (the old `install.sh <profile> [target]`, default target
`dev`) keep their bundle state under that target: keep deploying them with `--target dev` (or the target you used).
Running the new default target against the same workspace would try to create every resource a second time.

A pinned target for a known workspace (like `dev` in `databricks.yml`) is optional: copy `dev`, set `workspace.host`
and the variables, and pass `--target <name>`.

## Add or update documents
- In the app: Sources → upload a PDF (admins only). It lands in the docs volume and `ingest_job` runs.
- Or put the PDF in `data/docs/`, run `databricks bundle deploy --profile <profile>` (uploads it) and then
  `databricks bundle run ingest_job --profile <profile>`.
- A product that is not in `data/reference/products.csv` needs a row there (and synonyms / studies) first.
- `ingest_job` ends with `sync_index --wait`: when it succeeds the new content is searchable.

## Evaluate
See `src/eval/README.md`. Short form (the app needs an OAuth token, so run it from a laptop):
```
export DATABRICKS_HOST=https://<workspace>
export DATABRICKS_TOKEN=$(databricks auth token --profile <profile> -o json | jq -r .access_token)
python src/eval/run_eval.py --local --base-url <app-url> --catalog <catalog> --schema <schema> \
  --warehouse-id <warehouse-id> --experiment /Shared/<prefix>-chatbot/traces
```
Results: MLflow evaluation run in the experiment, and the table `<catalog>.<schema>.eval_results`.

## Operate
- Thresholds: `ROUTER_CONFIG` env var on the app (JSON, keys in `app/server/router/config.ts`), redeploy to apply.
- Pharmacovigilance: `ae_notifier_job` (paused by default) moves `app.ae_queue` rows (NEW, UNCLASSIFIED, REVIEW) into
  `<catalog>.<schema>.pv_cases` every 15 minutes. Set the PV e-mail with a per-target
  `jobs.ae_notifier_job` task override under the target you deploy (`targets: az:`; example in `resources/jobs.yml`) and unpause the schedule.
- Traces: the MLflow experiment `/Shared/<prefix>-chatbot/traces` (UC tables `<catalog>.<schema>.experiment_*`).
- Turn log, conversation state and AE queue: Lakebase schema `app`.

## Troubleshooting
| symptom | cause and fix |
|---|---|
| app build fails with npm 404 / checksum errors | `app/package-lock.json` points at a private registry. Resolved URLs must be `https://registry.npmjs.org/`. |
| templates show `FALLBACK`, product never detected | synced tables offline. Re-run `bootstrap_job`; it starts the synced-table pipeline. |
| `bootstrap_job`: "index ... lacks the column(s)" | `databricks bundle run bootstrap_job --params recreate_index=true` once. |
| `bootstrap_job` warns it cannot grant EXECUTE on `system.ai...` | expected: Databricks-owned services are executable by all users. A real gap shows as `classification.degraded` in responses. |
| eval stops with "the app rejected this identity's token" | use an OAuth token (`databricks auth token`), not a job or PAT token. |

## Uninstall
`databricks bundle destroy --profile <profile>` removes everything the bundle created. The index, the
synced tables and their pipeline are created by `bootstrap_job`; delete them first if the schema must be dropped:
`<catalog>.<schema>.if_chunks_idx`, `<lakebase_catalog>.<synced_schema>.*`.
