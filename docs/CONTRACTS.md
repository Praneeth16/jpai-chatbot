# Build contracts (shared by every component)

This file is the single source of truth for names, schemas and interfaces. Code must follow it. If a contract
must change, change this file in the same commit and say why.

Architecture: `docs/architecture/01-qa-routing-flow.drawio(.png)` and `02-databricks-architecture.drawio(.png)`.

## 0. Ground rules
- Everything deploys with this bundle (`databricks.yml` + `resources/*.yml`). No hard-coded workspace host, catalog,
  schema, ids or user names in code: read them from bundle variables (YAML) or env vars (app) or job parameters (Python).
- Install order (scripts/install.sh): `bundle deploy` → `bundle run ingest_job` → `bundle run bootstrap_job` → `bundle run app`.
  AI Search index and Lakebase synced tables need source tables, so `bootstrap_job` creates them (idempotent SDK calls).
- No generated text is ever shown to the user. Responses are an approved template (`templates`) or the verbatim
  `if_sections.markdown` of a section, optionally preceded by a template header.
- Template wording is placeholder until AZ Medical / Legal / Regulatory approves it. Mark `status = 'PLACEHOLDER'`.
- Customer repo: no internal Databricks material (Glean, Jira/ES tickets, internal FAQs, Slack).
- Verified facts from spikes (workspace fe-vm-lakebase-praneeth, Oct 2026):
  - System One: `POST {host}/ai-gateway/typesafe/v1/systemone`, model `system.ai.openjev-qwen35-4b`, ~2 s per call,
    Japanese works (AE hidden in a thank-you scored 0.93). Response `answers.<id>.{noul | choice, confidence, probabilities}`.
  - `ai_parse_document(content, map('version','2.0'))`: element `type` values seen: section_header, text, table, page_number,
    footnote, figure, page_header, title, caption, page_footer. `e:bbox[0]:page_id` is 0-based PDF page. Tables come as HTML.
  - Heading noise: `section_header` also tags things like `＜解説＞`, `〈切除不能な肝細胞癌〉`, `H鎖`, and quoted package-insert
    numbering such as `7. 用法及び用量に関連する注意` inside Ⅴ.4. The section builder must use a numbering sequence check.
  - `ai_prep_search` on a whole document crosses section boundaries (one chunk spanned Ⅱ.5 → Ⅲ.2), and its auto title was
    wrong. So: build sections first, then call `ai_prep_search(section_markdown_string, map('version', <pinned>, 'schema', ...))`.
    Enum schema uses `"labels"` not `"enum"`: `{"studies":{"type":"array","items":{"type":"enum","labels":[...]}}}`.
    Generated context sentences / table summaries are English; fine for retrieval, never displayed.

## 1. Bundle variables (databricks.yml)
`prefix, catalog, schema, warehouse_id, lakebase_project_id, lakebase_catalog, ai_search_endpoint,
classifier_model_service, embedding_endpoint, judge_endpoint, synced_schema, admin_emails`.
Derived names (use exactly):
- Volumes: `${catalog}.${schema}.docs` (source PDFs), `${catalog}.${schema}.page_images` (rendered pages).
- AI Search index: `${catalog}.${schema}.if_chunks_idx` on endpoint `${ai_search_endpoint}`.
- Lakebase: project `${lakebase_project_id}`, branch `projects/${lakebase_project_id}/branches/production`,
  database `projects/${lakebase_project_id}/branches/production/databases/databricks-postgres` (Postgres db `databricks_postgres`),
  UC registration catalog `${lakebase_catalog}`.
- Synced tables: `${lakebase_catalog}.${synced_schema}.<table>` → Postgres schema `${synced_schema}`, same table name.
  `lakebase_catalog` may be a standard catalog (the dev target uses `${catalog}`), so no CREATE CATALOG privilege is
  needed; `synced_schema` (default `jpai_chatbot_ref`) must differ from `schema`. App env `REF_SCHEMA = ${synced_schema}`.
- MLflow experiment: `/Shared/${prefix}-chatbot/traces` with UC trace location `${catalog}.${schema}`.
- App name: `${prefix}-chatbot`. Jobs: `${prefix} ingest`, `${prefix} bootstrap`, `${prefix} ae notifier`, `${prefix} eval`.

## 2. UC tables (`${catalog}.${schema}`)
| table | columns | notes |
|---|---|---|
| `docs_registry` | doc_id STRING PK, file_path, file_name, product_code, doc_type ('IF'), doc_rev STRING ('2024年11月改訂（第3版）'), revision_date DATE, sha256, ingested_at TIMESTAMP, is_current BOOLEAN | doc metadata set by CODE (cover-page regex + products.csv), not by LLM |
| `parsed_docs` | doc_id, file_path, parsed VARIANT, parsed_at | SDP streaming table, `ai_parse_document` version pinned '2.0', `imageOutputPath` = page_images volume |
| `if_sections` | section_id STRING PK (`{doc_id}::{section_path}`), doc_id, product_code, doc_rev, section_path STRING ('Ⅴ.5.(4)'), level INT, title STRING, parent_section_id, markdown STRING (verbatim parsed text/HTML tables of the section, sub-headings included), pages ARRAY<INT> (1-based PDF pages), approved_flag BOOLEAN, audience STRING ('HCP'), is_current BOOLEAN, qa_status STRING ('AUTO'/'APPROVED'/'REJECTED'), char_len INT | approved_flag = false for sections under Ⅴ.5 (臨床成績), ⅩⅡ (参考資料), ⅩⅢ (備考) — the IF itself says they may contain unapproved information. Plain Delta, CDF on |
| `if_chunks` | chunk_id STRING PK, section_id, doc_id, product_code, section_path, study_ids ARRAY<STRING>, chunk_to_embed STRING, chunk_to_retrieve STRING, approved_flag, audience, is_current | Plain Delta, CDF on. Index source |
| `products` | product_code PK ('IMJUDO'), brand_ja ('イジュド'), brand_en ('Imjudo'), generic_ja ('トレメリムマブ'), generic_en ('tremelimumab'), indications_ja, patient_materials_url, product_info_url | from data/reference/products.csv |
| `studies` | study_id PK ('HIMALAYA'), study_code ('D419CC00002'), product_codes ARRAY<STRING>, indication_ja, phase | from data/reference/studies.csv; codes must come from the IF text |
| `synonyms` | term PK, kind ('product'/'study'), target_id, lang | brand/generic/katakana/romaji/code variants |
| `templates` | template_id PK, route_id, lang ('ja'/'en'), text, version INT, status ('PLACEHOLDER'/'APPROVED') | PK is (template_id, lang) → store as `template_key = template_id||':'||lang` PK |
| `eval_results` | run_id, question_id, expected_route, actual_route, scores MAP<STRING,DOUBLE>, created_at | written by eval job |
| `pv_cases` | case_id, turn_id, conversation_id, message, ae_probability, detected_at, notified_at | written by AE notifier from Lakebase `app.ae_queue` |

## 3. Lakebase (Postgres, db `databricks_postgres`)
- Schema `${synced_schema}` (synced, read-only for app): `if_sections, docs_registry, products, studies, synonyms, templates`.
- Schema `app` (app-owned, created by app migrations on startup, idempotent):
```sql
CREATE SCHEMA IF NOT EXISTS app;
CREATE TABLE IF NOT EXISTS app.conversation_state (
  conversation_id TEXT PRIMARY KEY, user_email TEXT, lang TEXT DEFAULT 'ja',
  pending_clarification TEXT, pending_question TEXT, off_topic_streak INT DEFAULT 0,
  last_product_code TEXT, updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS app.turn_log (
  turn_id UUID PRIMARY KEY, conversation_id TEXT, user_email TEXT, message TEXT, merged_message TEXT,
  route_id TEXT, template_id TEXT, section_ids TEXT[], classification JSONB, retrieval JSONB,
  model_ids JSONB, trace_id TEXT, latency_ms INT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS app.ae_queue (
  ae_id UUID PRIMARY KEY, turn_id UUID, conversation_id TEXT, message TEXT, ae_probability DOUBLE PRECISION,
  status TEXT DEFAULT 'NEW', created_at TIMESTAMPTZ DEFAULT now(), notified_at TIMESTAMPTZ);
```
- `bootstrap_job` grants the app service principal `USAGE` on schema `${synced_schema}` and `SELECT` on its tables.
- App migration also grants `USAGE` on schema `app` and `SELECT, UPDATE` on `app.ae_queue` to role `databricks_superuser` (if it exists) so the AE notifier job (runs as the deployer) can read and mark cases.

## 4. App (AppKit, TypeScript) env vars (resources/app.yml `config.env`)
`LAKEBASE_ENDPOINT` (valueFrom postgres), `MODEL_SERVICE_NAME` (valueFrom model), `MLFLOW_EXPERIMENT_ID` (valueFrom experiment),
`DATABRICKS_WAREHOUSE_ID` (valueFrom warehouse), `INGEST_JOB_ID` (valueFrom ingest-job),
`AI_SEARCH_INDEX` = `${catalog}.${schema}.if_chunks_idx`, `REF_SCHEMA` = `${synced_schema}`, `ADMIN_EMAILS` = `${admin_emails}`,
`DOCS_VOLUME` = `/Volumes/${catalog}/${schema}/docs`, `PAGE_IMAGES_VOLUME` = `/Volumes/${catalog}/${schema}/page_images`,
`ROUTER_CONFIG` optional JSON overriding thresholds. `DATABRICKS_HOST`, `DATABRICKS_CLIENT_ID/SECRET` are injected by the platform.
App resources: postgres (CAN_CONNECT_AND_CREATE), model = uc_securable MODEL_SERVICE `${classifier_model_service}` EXECUTE,
docs volume WRITE_VOLUME, page_images volume READ_VOLUME, experiment CAN_EDIT, warehouse CAN_USE, ingest job CAN_MANAGE_RUN.
AI Search index SELECT is granted to the app SP by `bootstrap_job`.

## 5. Router API (the future AWS ECS contract) — `app/server/routes/openapi.yaml`
`POST /api/v1/route` (JSON)
```json
// request
{ "conversation_id": "string (client-generated uuid)", "message": "string", "lang": "ja | en", "audience": "HCP" }
// response
{ "turn_id": "uuid", "route_id": "4.2", "response": { "template_id": "T_4X_HEADER|null", "text": "string", "section_ids": ["..."],
  "citations": [{ "doc_id": "", "file_name": "", "doc_rev": "", "section_path": "", "title": "", "pages": [12] }] },
  "classification": { "adverse_event": 0.01, "injection": 0.0, "has_request": 0.9, "has_conditions": 0.2,
    "intent": { "choice": "drug_info", "confidence": 0.97, "probabilities": {} },
    "product_code": "IMJUDO", "study_ids": [], "model": "system.ai.openjev-qwen35-4b" },
  "retrieval": { "query": "", "filters": {}, "top_score": 0.71, "hits": [{ "section_id": "", "score": 0.7 }] },
  "pending_clarification": "target_study | product_focus | null", "ae_logged": false, "trace_id": "", "latency_ms": 2400 }
```
Other endpoints: `GET /api/v1/docs` (docs_registry + section counts), `POST /api/v1/docs/upload` (PDF → docs volume, then run ingest job),
`GET /api/v1/docs/:doc_id/pages/:page` (page image proxy), `GET /api/v1/ops/summary` (route mix, AE queue, recent turns),
`GET /api/v1/health`, `GET /api/me`. Callers outside the app use an OAuth M2M token for a service principal with CAN_USE on the app.

## 6. Routing flow (exactly the fixed diagram)
Route ids: `0a, 0b, 0c_greeting, 0c_closing, 0c_about, 1, 2, 3.1, 3.2, 4.1, 4.2, 5.1, 5.2, 6.1, 6.2, 7.1, 8.1, 8.2`.
1. If `pending_clarification` is set, merge: `merged = pending_question + ' ' + message` (store both).
2. 0-a code check: empty after trim, or no letters/kana/kanji, or repeated single char → `0a`. (No length rejection.)
3. One System One call with questions: `adverse_event` (noul), `injection` (noul), `has_request` (noul), `has_conditions` (noul),
   `smalltalk` (choice: greeting / closing / about_bot / other), `intent` (choice: unanswerable, patient_materials,
   hcp_materials, drug_info, efficacy_safety, website, contact_az, ambiguous_az, out_of_scope). Criteria text lives in
   `app/server/router/questions.ts` (Japanese + English descriptions).
4. Master data (code): normalise (NFKC, lower), match `synonyms` → product_code, study_ids. Fall back to last_product_code from state only when the message has no product but is a clarification reply.
5. Order: AE (`adverse_event ≥ τ_ae`=0.35) → log `app.ae_queue` + route `1` ; injection (≥ 0.6) → `0b` ;
   `has_request < 0.3` → `0c_*` by smalltalk ; then intent with `confidence ≥ τ_intent`=0.55:
   unanswerable→`2`, patient_materials→`3.1`, hcp_materials→`3.2`,
   drug_info AND product → (has_conditions ≥ 0.5 ? search(product+conditions)→`4.1` : search(product)→`4.2`),
   efficacy_safety AND product → (study known ? search(product+study)→`5.1` : `5.2` set pending `target_study`),
   website→`6.1`, contact_az→`6.2`; otherwise ambiguous_az or (drug_info/efficacy_safety without product) → `7.1` set pending `product_focus`;
   otherwise off_topic_streak+1 → (streak ≥ 3 ? `8.2` : `8.1`). Reset streak on any non-8.x route.
6. Search (`4.x`, `5.1`): AI Search hybrid query on `if_chunks_idx`, `num_results` 8, filters `product_code`, `is_current = true`,
   `approved_flag = true` for 4.x (5.1 allows approved_flag false only if `audience = 'HCP'`, and the template header says
   it is clinical study information), optional `study_ids` contains study. Group hits by `section_id`, take best section.
   If top score < `τ_ret` (start 0.0 → tuned on eval; read from config) → route `2`.
   4.1 returns the best subsection (deepest section_path among hits); 4.2 returns the best level-2 section (full text).
7. Response text = template header (route-specific, lang) + "\n\n" + `if_sections.markdown` (verbatim) for 4.x/5.1; template only otherwise.
9. Rule decisions after eval-set review (v1.1):
   - New intent option `report_ae` ("wants to report a side effect / adverse event"): route `1` even if `adverse_event` is
     below τ_ae; write `ae_queue` only when `adverse_event ≥ τ_ae` (an actual event was described).
   - Study implies product: if a study matches and no product matched, product_code = the study's only product in `studies.product_codes`.
   - Indication implies study: `synonyms.kind = 'indication'` rows map an indication term (肝細胞癌, HCC, 非小細胞肺癌, NSCLC…)
     to a study for a product. Use it only when exactly one study matches for that product; otherwise 5.2 asks.
   - `smalltalk = about_bot` with confidence ≥ τ_intent routes to `0c_about` even when `has_request` is high.
   - Empty or whitespace-only messages are valid API input (no 400) and return `0a`. Keyboard mash with letters goes to the
     classifier (usually 8.1); that is accepted behaviour.
   - Template text is returned exactly as stored (no placeholder substitution). `templates.route_id` uses the route ids above.
10. Implementation notes (v1.2, from the backend build): intent list includes `report_ae`; response adds
    `classification.thresholds`, `classification.degraded`, `classification.smalltalk`, `merged_message`, `retrieval.error`;
    `DocInfo.chunk_count`. Span names: merge, precheck, classify, masterdata, decide, search, lookup, respond.
    `docs_registry` is also synced to Lakebase so citations carry `file_name`. Model service EXECUTE for the app SP is
    granted by `bootstrap_job` (CLI v1.18 does not accept `MODEL_SERVICE` as an app `uc_securable` type).
8. Every turn: `turn_log` row + one MLflow trace (`mlflow-tracing` npm) with spans: merge, precheck, classify, masterdata, route, search, lookup.

## 7. File ownership (parallel build — do not edit other owners' files)
- Agent A (ingestion & jobs): `resources/{schema_volume,lakebase,ingest.pipeline,jobs,ai_search,experiment}.yml`, `src/ingest/**`,
  `src/jobs/**`, `data/**`, `scripts/install.sh`.
- Agent B (router backend): `app/server/**`, `app/shared/**`, `app/package.json`, `app/tsconfig*.json`, `app/vitest.config.ts`,
  `app/eslint.config.js`, `resources/app.yml`.
- Agent C (frontend): `app/client/**` (Agent B creates the AppKit project first; C only touches `client/`).
- Agent D (evaluation): `src/eval/**`, the `eval_job` block is added by A in `resources/jobs.yml` calling `src/eval/run_eval.py`.
- Opus (integrator): `databricks.yml`, `docs/**`, `README.md`, conflicts.

## 8. Review fixes (v1.3, after the Opus review)
Sections
- `FRONT` (cover, TOC, abbreviations) is never chunked and never answered. Sections with `level < 2` are never answered.
- Pseudo-sections: a section whose own body exceeds `SPLIT_CHARS` (6000) is split at sub-heading blocks in rank order
  〈…〉 > 【…】/◆ > ＜…＞ (except ＜解説＞, kept with the preceding item) > package-insert numbering `\d+\.\d+(\.\d+)?` >
  lines like "…試験における…". Recurse while a part is still too big; tables are atomic. Children get
  `section_path = parent + "#k"`, `level = parent + 1`, `title` = sub-heading text, `is_pseudo = true`,
  `approved_flag` = rule on the parent path, pages from their own blocks. Invariant (unit-tested):
  `parent.markdown == "\n\n".join(intro, *children in order)`, so every answer is an exact contiguous slice of the IF.
- Section-level `study_ids` (from heading study names, or an indication heading that maps to exactly one study for the
  product) are inherited by every chunk of that section. New `if_sections` columns: `is_pseudo BOOLEAN`, `study_ids ARRAY<STRING>`.
- Roman chapter labels are NFKC-normalised (Ⅺ → ⅩⅠ etc.) before the approved/unapproved rule.
- Index columns add `qa_status`; search filters `audience = <request audience>` and `qa_status != 'REJECTED'`
  (`require_qa_approved` config, default false for the demo, true = only 'APPROVED').
Router
- 4.2: from the best hit walk up while the parent has `level ≥ 2` and `char_len ≤ max_verbatim_chars` (config, 8000);
  small level-2 sections still come back whole, big ones return the largest ancestor that fits.
- Lookup re-checks `is_current`, `qa_status != 'REJECTED'`, and `approved_flag` (5.1 may return unapproved clinical
  sections only with the 5.1 header template). Refuse (route 2) a section whose subtree contains an unapproved child for 4.x.
- Response adds `response.header_text`, `response.section_text` (verbatim), `response.section_context`
  ({breadcrumb: [ancestor titles], part: "k/n" | null}); `response.text` stays = header + "\n\n" + section for API compatibility.
  New `GET /api/v1/sections/:section_id` returns one section (verbatim) for "show full parent section".
- AE safety: if classification is degraded, run a deterministic Japanese/English AE keyword check and always write an
  `ae_queue` row with `status = 'UNCLASSIFIED'` (route stays per flow, `ae_logged = true`). `ae_queue` insert is retried
  3 times; if it still fails the turn returns route 1 with `ae_logged = false` and an error is logged loudly.
- Conversation state is bound to `user_email`: a state row owned by another user is ignored.
- Clarification loop breaker: a second consecutive 7.1 counts as off-topic (feeds the 8.x streak).
- Templates: hard-coded fallback text is used only if the synced table is unavailable and is flagged `status = 'FALLBACK'`.
Access
- `ADMIN_EMAILS` (bundle var `admin_emails`, default the deployer) gates `POST /api/v1/docs/upload`, `GET /api/v1/ops/summary`
  raw messages, and the "Why this route?" debug panel. Non-admins see ops counts only and no model internals.
- Uploads: extension lower-cased; ingest reads with `allowOverwrites` so a re-uploaded file is re-parsed.
Jobs
- AE notifier fails loudly if task values cannot be set; empty `pv_notify_email` means no email block at all.
- `bootstrap_job` raises if the model-service EXECUTE grant fails and is not already effective.

v1.3 additions from the Python fix: after the five split ranks, a part still above SPLIT_CHARS is packed at block
boundaries (never ending on a heading block), titled "<title>（続き）". `if_chunks.qa_status` copied from its section at
publish time. The AE notifier forwards `NEW` and `UNCLASSIFIED` rows. `bootstrap_job` has job parameter
`recreate_index` (default false) to rebuild the index when columns change. Publish merges only the newest parse per doc_id.
PV email is configured per target with a `jobs.ae_notifier_job.email_notifications` override (see resources/jobs.yml comment).

## 9. Live install and tuning (v1.4, after the first deploy and eval on fe-vm-lakebase-praneeth)
Install
- Traces: the experiment has a UC trace location; the MLflow npm client cannot write there (it uploads span data to a
  presigned cloud URL the app cannot reach). The app exports OpenTelemetry spans to `{host}/api/2.0/otel/v1/traces`
  with header `X-Databricks-UC-Table-Name` = the experiment tag `mlflow.experiment.databricksTraceSpanStorageTable`.
  `bootstrap_job` (param `--experiment-id`) grants the app SP SELECT + MODIFY on that table.
- `bootstrap_job` starts one update of the shared synced-table pipeline when tables attached to it are still offline.
- System One services under `system.` cannot be read or granted by workspace users; bootstrap warns instead of failing.
- The eval calls the app with an OAuth token; a job task token is rejected (401), so the eval runs with `--local` and
  `DATABRICKS_TOKEN` from `databricks auth token`, and exits before evaluating when the app rejects the token.
Router
- AE has two tiers: `adverse_event >= tau_ae_route` (0.8) → route 1 + `ae_queue` status NEW; `tau_ae <= p < tau_ae_route`
  → routed by intent and queued with status REVIEW (`ae_logged = true`). The AE notifier forwards NEW, UNCLASSIFIED, REVIEW.
  Eval: true AE reports scored 0.92–1.00, questions about side effects 0.41–0.65. The band is a PV policy setting.
- Injection: deterministic keyword backstop (`injection-keywords.ts`) in addition to `injection >= tau_inj`.
- A study owned by several products (HIMALAYA, POSEIDON) with no product in the message: the last product of the
  conversation if it is one of them, otherwise 5.1 searches all of them (`product_code` filter is a list).
- drug_info counts as conditional (4.1) when an indication or study term matched.
- Search query = message without product names and polite filler (`searchQuery`); the product is already a filter and
  every chunk embeds the product name.
Eval set
- 52-04 → 5.1 (indication → unique study, v1.1 rule) and 71-05 → 4.2 IMFINZI (IMFINZI is now in the master data).
- `ae_false_positive` counts only answers on route 1; REVIEW queueing is intended.
Router, round 2
- 4.x section choice: table-of-contents match first. `titleScore` = share of the section title's character bigrams
  (title without brackets, footnote digits and glue words) found in the cleaned query; the best answerable, non-pseudo
  section scoring ≥ `tau_title` (0.6) is chosen (4.2 then walks up as before), otherwise the vector-search choice.
  `retrieval.selection` = `title | search`, `retrieval.title_score`.
- 5.1 prefers hits under IF chapter Ⅴ.5 (臨床成績, JSHP format); other chapters only mention the study.
- `tau_intent` 0.5 (System One `confidence` runs ~0.05 below the top probability). Below it, a turn without a request
  is off-topic (8.x), with a request it is 7.1.
- drug_info that names a trial (a study term, not an indication) is handled as efficacy_safety.
