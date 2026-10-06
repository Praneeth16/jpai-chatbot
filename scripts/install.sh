#!/usr/bin/env bash
# Install (or update) the whole JPAI chatbot into a Databricks workspace.
#
#   scripts/install.sh <cli-profile> [bundle-target]
#
# Order matters: the AI Search index and the Lakebase synced tables need the tables that ingest_job publishes, and the
# grants for the app service principal need the app to exist. Every step is idempotent, so the script can be re-run.
#
# Upgrading an existing install: ingest_job adds new table columns in place (ALTER TABLE ADD COLUMNS), but the columns of
# an existing AI Search index cannot change. If bootstrap_job stops with "index ... lacks the column(s) ...", run
#   databricks bundle run bootstrap_job --params recreate_index=true --profile <profile>
# once (search is unavailable until the recreated index has synced).
set -euo pipefail

PROFILE="${1:?usage: scripts/install.sh <cli-profile> [bundle-target]}"
TARGET="${2:-}"
cd "$(dirname "$0")/.."

ARGS=(--profile "$PROFILE")
if [ -n "$TARGET" ]; then ARGS+=(--target "$TARGET"); fi
db() { databricks "$@" "${ARGS[@]}"; }

step() { printf '\n==> %s\n' "$*"; }

step "validate bundle"
db bundle validate

# MLflow experiments cannot be created in a folder that does not exist yet
PREFIX="$(db bundle validate --output json | python3 -c 'import json,sys; print(json.load(sys.stdin)["variables"]["prefix"]["value"])')"
step "workspace folder /Shared/${PREFIX}-chatbot (experiment parent)"
databricks workspace mkdirs "/Shared/${PREFIX}-chatbot" --profile "$PROFILE"

step "deploy bundle"
db bundle deploy

step "ingest_job: seed master data, copy PDFs, parse, chunk, publish"
db bundle run ingest_job

step "bootstrap_job: AI Search index, Lakebase synced tables, grants"
db bundle run bootstrap_job

step "start app"
db bundle run chatbot

step "bootstrap_job again: grants for the app service principal"
db bundle run bootstrap_job

step "done"
APP_URL="$(databricks apps get "${PREFIX}-chatbot" --profile "$PROFILE" --output json | python3 -c 'import json,sys; print(json.load(sys.stdin).get("url",""))')"
echo "App URL: ${APP_URL:-<not available, see the Apps page>}"
