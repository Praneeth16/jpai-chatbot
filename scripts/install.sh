#!/usr/bin/env bash
# Install (or update) the whole JPAI chatbot into YOUR Databricks workspace with one command.
#
#   bash scripts/install.sh                       # interactive: asks for the workspace, catalog and SQL warehouse
#   bash scripts/install.sh --host https://adb-123.azuredatabricks.net --catalog main --warehouse-id abc123 --yes
#
# Options (all optional; anything missing is asked for):
#   --host URL          workspace URL, e.g. https://adb-1234567890123456.7.azuredatabricks.net
#   --profile NAME      existing Databricks CLI profile to use instead of --host
#   --catalog NAME      Unity Catalog catalog for the schema (you need CREATE SCHEMA on it)
#   --warehouse-id ID   serverless SQL warehouse id
#   --prefix NAME       resource name prefix (default jpai)
#   --target NAME       bundle target (default az)
#   --yes               do not ask for confirmation
#
# Choices are saved to .databricks/bundle/<target>/variable-overrides.json, so later `databricks bundle ...` commands
# (deploy, run ingest_job, ...) only need `--profile <profile>`.
#
# Order matters: the AI Search index and the Lakebase synced tables need the tables that ingest_job publishes, and the
# grants for the app service principal need the app to exist. Every step is idempotent, so the script can be re-run.
#
# Upgrading an existing install: if bootstrap_job stops with "index ... lacks the column(s) ...", run
#   databricks bundle run bootstrap_job --params recreate_index=true --profile <profile>
# once (search is unavailable until the recreated index has synced).
set -euo pipefail
cd "$(dirname "$0")/.."

HOST="" PROFILE="" CATALOG="" WAREHOUSE="" PREFIX="" TARGET="az" YES=""
while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --profile) PROFILE="$2"; shift 2 ;;
    --catalog) CATALOG="$2"; shift 2 ;;
    --warehouse-id) WAREHOUSE="$2"; shift 2 ;;
    --prefix) PREFIX="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    --yes) YES=1; shift ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

step() { printf '\n==> %s\n' "$*"; }
ask() { local v; read -r -p "$1" v </dev/tty; printf '%s' "$v"; }
die() { echo "ERROR: $*" >&2; exit 1; }

# --- prerequisites -------------------------------------------------------------------------------------------------
command -v databricks >/dev/null || die "Databricks CLI not found. Install it: https://docs.databricks.com/dev-tools/cli/install.html"
command -v python3 >/dev/null || die "python3 not found"
CLI_VERSION="$(databricks --version | sed -E 's/[^0-9]*([0-9]+\.[0-9]+\.[0-9]+).*/\1/')"
python3 -c "import sys; sys.exit(0 if tuple(map(int, '$CLI_VERSION'.split('.'))) >= (1, 18, 0) else 1)" \
  || die "Databricks CLI $CLI_VERSION is too old; version 1.18 or newer is needed (brew upgrade databricks)"

# --- workspace and login ---------------------------------------------------------------------------------------------
if [ -z "$PROFILE" ]; then
  [ -n "$HOST" ] || HOST="$(ask 'Databricks workspace URL (e.g. https://adb-1234567890123456.7.azuredatabricks.net): ')"
  HOST="${HOST%/}"
  [[ "$HOST" == https://* ]] || HOST="https://${HOST}"
  PROFILE="$(databricks auth profiles --output json 2>/dev/null | python3 -c '
import json, sys
host = sys.argv[1].rstrip("/")
for p in json.load(sys.stdin).get("profiles", []):
    if (p.get("host") or "").rstrip("/") == host and p.get("valid"):
        print(p["name"]); break' "$HOST" || true)"
  if [ -z "$PROFILE" ]; then
    PROFILE="jpai-$(printf '%s' "$HOST" | sed -E 's#https://##; s#[^A-Za-z0-9]+#-#g' | cut -c1-40)"
    step "log in to $HOST (a browser window opens)"
    databricks auth login --host "$HOST" --profile "$PROFILE"
  fi
fi
ME="$(databricks current-user me --profile "$PROFILE" --output json | python3 -c 'import json,sys; print(json.load(sys.stdin)["userName"])')" \
  || die "cannot call the workspace with profile $PROFILE; run: databricks auth login --profile $PROFILE"
HOST="$(databricks auth profiles --output json 2>/dev/null | python3 -c '
import json, sys
print(next((p.get("host", "") for p in json.load(sys.stdin).get("profiles", []) if p["name"] == sys.argv[1]), ""))' "$PROFILE" || true)"
echo "Workspace: ${HOST:-<from profile $PROFILE>}   user: $ME   profile: $PROFILE"

# --- catalog and warehouse -------------------------------------------------------------------------------------------
OVERRIDES=".databricks/bundle/${TARGET}/variable-overrides.json"
saved() { [ -f "$OVERRIDES" ] && python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get(sys.argv[2],""))' "$OVERRIDES" "$1" || true; }
[ -n "$CATALOG" ] || CATALOG="$(saved catalog)"
[ -n "$WAREHOUSE" ] || WAREHOUSE="$(saved warehouse_id)"
[ -n "$PREFIX" ] || PREFIX="$(saved prefix)"
PREFIX="${PREFIX:-jpai}"

if [ -z "$CATALOG" ]; then
  echo; echo "Unity Catalog catalogs you can see (the bundle creates schema 'jpai_chatbot' in the one you pick):"
  databricks catalogs list --profile "$PROFILE" --output json | python3 -c '
import json, sys
data = json.load(sys.stdin)
rows = data if isinstance(data, list) else data.get("catalogs", [])
for c in rows:
    if c["name"] not in ("system", "samples", "hive_metastore") and not c["name"].startswith("__"):
        print("  -", c["name"])'
  CATALOG="$(ask 'Catalog: ')"
fi
[ -n "$CATALOG" ] || die "a catalog is required"

if [ -z "$WAREHOUSE" ]; then
  echo; echo "SQL warehouses (pick a serverless one):"
  databricks warehouses list --profile "$PROFILE" --output json | python3 -c '
import json, sys
data = json.load(sys.stdin)
rows = data if isinstance(data, list) else data.get("warehouses", [])
for w in rows:
    kind = "serverless" if w.get("enable_serverless_compute") else (w.get("warehouse_type") or "classic").lower()
    print("  - %s  %s  (%s, %s)" % (w["id"], w["name"], kind, w.get("state", "?")))'
  WAREHOUSE="$(ask 'Warehouse id: ')"
fi
[ -n "$WAREHOUSE" ] || die "a SQL warehouse id is required"

mkdir -p "$(dirname "$OVERRIDES")"
python3 - "$OVERRIDES" "$CATALOG" "$WAREHOUSE" "$PREFIX" <<'PY'
import json, os, sys
path, catalog, warehouse, prefix = sys.argv[1:]
data = json.load(open(path)) if os.path.exists(path) else {}
data.update(catalog=catalog, warehouse_id=warehouse, prefix=prefix)
json.dump(data, open(path, "w"), indent=2)
PY

cat <<EOF

About to install into ${HOST:-profile $PROFILE}:
  catalog / schema      ${CATALOG}.jpai_chatbot   (+ ${CATALOG}.jpai_chatbot_ref for Lakebase synced tables)
  SQL warehouse         ${WAREHOUSE}
  app / jobs prefix     ${PREFIX}  (app: ${PREFIX}-chatbot)
  also creates          Lakebase project, AI Search endpoint, pipeline, 4 jobs, MLflow experiment
  takes                 30-60 minutes on a fresh workspace
EOF
if [ -z "$YES" ]; then
  [[ "$(ask 'Continue? [y/N] ')" =~ ^[Yy] ]] || { echo "cancelled"; exit 0; }
fi

# --- install --------------------------------------------------------------------------------------------------------
db() { databricks "$@" --profile "$PROFILE" --target "$TARGET"; }

step "1/7 validate bundle"
db bundle validate

step "2/7 workspace folder /Shared/${PREFIX}-chatbot (MLflow experiment parent)"
databricks workspace mkdirs "/Shared/${PREFIX}-chatbot" --profile "$PROFILE"

step "3/7 deploy bundle (schema, volumes, Lakebase, AI Search endpoint, pipeline, jobs, experiment, app)"
db bundle deploy

step "4/7 ingest_job: seed master data, copy PDFs, parse, chunk, publish"
db bundle run ingest_job

step "5/7 bootstrap_job: AI Search index, Lakebase synced tables, grants"
db bundle run bootstrap_job

step "6/7 start app"
db bundle run chatbot

step "7/7 bootstrap_job again: grants for the app service principal"
db bundle run bootstrap_job

APP_URL="$(databricks apps get "${PREFIX}-chatbot" --profile "$PROFILE" --output json | python3 -c 'import json,sys; print(json.load(sys.stdin).get("url",""))')"
cat <<EOF

Done.
  App:     ${APP_URL:-<see Compute > Apps in the workspace>}
  Health:  ${APP_URL:-<app-url>}/api/v1/health  (every check should be true)
  Later:   databricks bundle deploy --profile $PROFILE          (after code changes)
           databricks bundle run ingest_job --profile $PROFILE  (after adding PDFs to data/docs/)
EOF
