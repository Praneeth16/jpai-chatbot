# Router API

The app backend is API-first: the React UI is one client of the same REST API that the AWS ECS controller would call.
Full schema: `app/server/routes/openapi.yaml`. Request and response fields: `docs/CONTRACTS.md` section 5 and 8.

## Authentication
Databricks Apps accept OAuth access tokens only.
- A user: `databricks auth token --profile <profile>` (U2M).
- A server (ECS controller): a service principal with `CAN_USE` on the app and an OAuth secret, token from
  `POST https://<workspace>/oidc/v1/token` with `grant_type=client_credentials&scope=all-apis` (M2M).

## Route one turn
```
curl -s https://<app-url>/api/v1/route \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"conversation_id":"8f6c…","message":"イジュドの貯法を教えてください","lang":"ja","audience":"HCP"}'
```
Response (abridged):
```json
{
  "route_id": "4.2",
  "response": {
    "template_id": "T_4X_HEADER", "header_text": "…", "section_text": "<verbatim IF section>",
    "text": "<header>\n\n<section>", "section_ids": ["JD0300_IF::Ⅹ.3"],
    "citations": [{"doc_id": "JD0300_IF", "file_name": "JD0300_IF.pdf", "doc_rev": "2024年11月改訂（第3版）",
                   "section_path": "Ⅹ.3", "title": "貯法・保存条件", "pages": [52]}]
  },
  "classification": {"adverse_event": 0.08, "intent": {"choice": "drug_info", "confidence": 0.9}, "product_code": "IMJUDO"},
  "retrieval": {"query": "貯法", "top_score": 0.97},
  "pending_clarification": null, "ae_logged": false, "trace_id": "…", "latency_ms": 1800
}
```
- Keep `conversation_id` for the whole conversation: clarifications (7.1 product, 5.2 study) are merged with the next turn.
- `ae_logged: true` means the turn was written to the pharmacovigilance queue.
- The client must display `response.text` (or `header_text` + `section_text`) exactly as returned.

## Other endpoints
| method | path | purpose |
|---|---|---|
| GET | `/api/v1/sections/{section_id}` | one section, verbatim (for "show the full parent section") |
| GET | `/api/v1/docs` | indexed documents with revision and section / chunk counts |
| POST | `/api/v1/docs/upload` | upload a PDF and start ingestion (admins) |
| GET | `/api/v1/docs/{doc_id}/pages/{page}` | rendered page image |
| GET | `/api/v1/ops/summary` | route mix, AE queue, recent turns (raw messages for admins only) |
| GET | `/api/v1/health` | Lakebase, classifier, search and tracing checks |
| GET | `/api/me` | caller e-mail and admin flag |
