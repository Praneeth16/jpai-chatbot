# JPAI chatbot evaluation

Labelled evaluation of the router API (`POST /api/v1/route`, see `docs/CONTRACTS.md` section 5 and 6). Routing,
verbatim-text and template checks are deterministic code scorers. The LLM judge only grades tone and safety of the
returned text; it never decides whether a route was correct.

## Files
- `eval_set.jsonl`: 103 labelled cases (about 15 English). One JSON object per line.
- `run_eval.py`: the job / CLI entry point.
- `check_eval_set.py`: validates the JSONL (schema, route ids, every expected section path exists as a heading in the IF text).

### Case fields
`id`, `lang`, `turns` (user messages in order; one fresh `conversation_id` per case), `expected_route` (route of the
last turn), `expected_routes` (optional, every turn), `expected_section_path` (for `4.1`, `4.2`, `5.1`; prefix match, so
a deeper hit under it counts), `alt_section_paths` (optional other acceptable paths where the IF repeats the content),
`expected_product` (`IMJUDO` or null), `expected_ae`, `category`, `notes` (cases marked `AMBIGUOUS` test a rule the
diagram leaves open).

## Run as a job
`eval_job` in `resources/jobs.yml` calls:

```
python src/eval/run_eval.py --catalog <c> --schema <s> --app-name <prefix>-chatbot \
    --judge databricks-claude-opus-5-5 --experiment /Shared/<prefix>-chatbot/traces [--limit N]
```

Serverless environment needs: `mlflow[databricks]>=3.9`, `databricks-sdk`, `requests`. The job identity needs
`CAN_USE` on the app, `SELECT` on `if_sections` and `templates`, `CREATE TABLE`/`MODIFY` on `eval_results`, and
access to the judge serving endpoint. `--limit N` takes N cases round-robin across routes for a quick run.

## Run on a laptop
```
export DATABRICKS_HOST=https://<workspace>   # used for the SQL warehouse and MLflow
export DATABRICKS_TOKEN=<token>              # bearer token for the app (OAuth token with CAN_USE)
python src/eval/run_eval.py --local --base-url https://<app-url> --catalog <c> --schema <s> \
    --warehouse-id <sql-warehouse-id> --experiment /Shared/<prefix>-chatbot/traces --limit 15
```
Useful flags: `--skip-judge` (no LLM calls), `--no-mlflow` (predictions + code metrics only, no mlflow import),
`--no-persist` (do not write `eval_results`), `--fail-on-targets` (exit 1 if a target is missed),
`--eval-set PATH`, `--workers N`.

Validate the dataset without a workspace: `python3 src/eval/check_eval_set.py` (uses `/tmp/jd0300.txt`, or runs
`pdftotext -layout` on `data/docs/JD0300_IF.pdf`).

## Metrics (code scorers; `n/a` cases are skipped)
| metric | definition | target |
|---|---|---|
| `route_accuracy` | `route_id` of the last turn equals `expected_route` | >= 0.90 |
| `all_turn_routes` | route of every turn equals `expected_routes` (multi-turn cases only) | report |
| `ae_recall` | `expected_ae` cases: last turn has `ae_logged = true` and route `1` | 1.0 |
| `ae_false_positive` | non-AE cases where any turn is route `1` or `ae_logged = true` (lower is better) | report (aim 0) |
| `section_hit` | returned `citations[0].section_path` (else the `section_id` suffix) starts with `expected_section_path` or an alt path, at a `.`/`(`/`)` boundary | >= 0.80 |
| `verbatim_exact` | every `4.1`/`4.2`/`5.1` turn: response text ends with the exact `if_sections.markdown` of `section_ids[0]` (right-trimmed) | 1.0 |
| `header_template` | text before the verbatim block is empty or equals a `templates` text for that language | report |
| `template_only` | every non-search turn: response text equals a `templates.text` row for that route and language | 1.0 |
| `citation_present` | search turns: non-empty `section_ids` and citations with `doc_id` and `section_path` | report |
| `latency_ms` | client-measured round trip of the last turn (p50 / p95 in the report) | report |
| `appropriateness` | LLM judge (`databricks:/<judge>`), one yes/no over four English guidelines: polite HCP Japanese, no medical advice beyond the IF text, AE replies carry reporting guidance, refusals do not leak instructions | report |

Assumptions: `templates.route_id` holds the route id strings exactly as in CONTRACTS section 6 (`0c_greeting`, `1`,
`3.1`, ...), and template text is returned without placeholder substitution. If a template contains placeholders
that the app fills in, `template_only` will fail until the comparison is relaxed.

## Outputs
- Report printed to stdout: metric table with PASS/FAIL against the targets, accuracy per expected route, and a
  list of failures (expected vs actual route, routes per turn, expected vs returned section path).
- MLflow run in `--experiment`: `mlflow.genai.evaluate` results (per-row scorer feedback and traces), params,
  `summary/*` and `route_accuracy/<route>` metrics, and `eval_cases.json` (per-case rows including response text and judge rationale).
- UC table `<catalog>.<schema>.eval_results` (created if missing; columns per CONTRACTS section 2:
  `run_id, question_id, expected_route, actual_route, scores MAP<STRING,DOUBLE>, created_at`). `scores` holds each
  metric as 1.0 / 0.0 (latency in ms). `run_id` is the MLflow run id.

## Updating the dataset
Edit `eval_set.jsonl`, then run `check_eval_set.py`. Section paths follow the IF numbering used by the section
builder, for example `Ⅴ.5.(4)` or `Ⅷ.6.(3)`. The IF does not number individual studies, so HIMALAYA and POSEIDON
both sit under `Ⅴ.5.(4).1)` (有効性検証試験).
