#!/usr/bin/env bash
# Install (or update) the whole JPAI chatbot into YOUR Databricks workspace with one command.
#
#   bash scripts/install.sh                       # interactive: asks for the workspace, catalog and SQL warehouse
#   bash scripts/install.sh --host https://adb-123.azuredatabricks.net --catalog main --warehouse-id abc123 --yes
#
# Options (all optional; anything missing is asked for):
#   --host URL          workspace URL, e.g. https://adb-1234567890123456.7.azuredatabricks.net (a URL copied from
#                       the browser is fine; the path and ?o=... are dropped)
#   --profile NAME      existing Databricks CLI profile to use instead of --host
#   --catalog NAME      Unity Catalog catalog for the schema (you need CREATE SCHEMA on it)
#   --warehouse-id ID   serverless SQL warehouse id
#   --target NAME       bundle target (default az)
#   --yes               do not ask anything (CI); every missing value is then an error
#
# Values already set for the target (databricks.yml, BUNDLE_VAR_* env vars, or a previous run of this script) are used
# as they are. Values you enter here are saved to .databricks/bundle/<target>/variable-overrides.json after you confirm,
# so later `databricks bundle ...` commands only need `--profile <profile>`.
#
# Order matters: the AI Search index and the Lakebase synced tables need the tables that ingest_job publishes, and the
# grants for the app service principal need the app to exist. Every step is idempotent, so the script can be re-run.
# If bootstrap_job stops with "index ... lacks the column(s) ...", run once:
#   databricks bundle run bootstrap_job --params recreate_index=true --profile <profile>
set -euo pipefail
cd "$(dirname "$0")/.."

die() { echo "ERROR: $*" >&2; exit 1; }
need() { [ $# -ge 2 ] && [ -n "$2" ] || die "$1 needs a value (see --help)"; }

HOST="" PROFILE="" CATALOG="" WAREHOUSE="" TARGET="az" YES=""
while [ $# -gt 0 ]; do
  case "$1" in
    --host) need "$@"; HOST="$2"; shift 2 ;;
    --profile) need "$@"; PROFILE="$2"; shift 2 ;;
    --catalog) need "$@"; CATALOG="$2"; shift 2 ;;
    --warehouse-id) need "$@"; WAREHOUSE="$2"; shift 2 ;;
    --target) need "$@"; TARGET="$2"; shift 2 ;;
    --yes) YES=1; shift ;;
    -h|--help) sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
done

step() { printf '\n==> %s\n' "$*"; }
ask() {
  [ -z "$YES" ] || die "missing value for: $1 (pass it as an option; --yes never asks)"
  local v
  { exec 3</dev/tty; } 2>/dev/null || die "no terminal to ask '$1'; pass all values as options and --yes"
  read -r -u 3 -p "$1" v; exec 3<&-
  printf '%s' "$v"
}

# --- prerequisites -------------------------------------------------------------------------------------------------
command -v databricks >/dev/null || die "Databricks CLI not found. Install it: https://docs.databricks.com/dev-tools/cli/install.html"
command -v python3 >/dev/null || die "python3 not found"
CLI_VERSION="$(databricks --version | sed -E 's/[^0-9]*([0-9]+\.[0-9]+\.[0-9]+).*/\1/')"
python3 -c "import sys; sys.exit(0 if tuple(map(int, '$CLI_VERSION'.split('.'))) >= (1, 18, 0) else 1)" \
  || die "Databricks CLI $CLI_VERSION is too old; version 1.18 or newer is needed (brew upgrade databricks)"

# --- workspace and login ---------------------------------------------------------------------------------------------
profiles_json() { databricks auth profiles --output json 2>/dev/null || echo '{}'; }
if [ -z "$PROFILE" ]; then
  [ -n "$HOST" ] || HOST="$(ask 'Databricks workspace URL (e.g. https://adb-1234567890123456.7.azuredatabricks.net): ')"
  HOST="$(python3 -c '
import sys, urllib.parse
u = sys.argv[1].strip()
u = u if "://" in u else "https://" + u
p = urllib.parse.urlsplit(u)
print("https://" + p.netloc if p.netloc else "")' "$HOST")"
  [ -n "$HOST" ] || die "not a workspace URL"
  PROFILE="$(profiles_json | python3 -c '
import json, sys
host = sys.argv[1]
print(next((p["name"] for p in json.load(sys.stdin).get("profiles", [])
            if (p.get("host") or "").rstrip("/") == host and p.get("valid")), ""))' "$HOST")"
  if [ -z "$PROFILE" ]; then
    # "jpai" unless that name is already used for another workspace
    PROFILE="$(profiles_json | python3 -c '
import json, re, sys
names = {p["name"] for p in json.load(sys.stdin).get("profiles", [])}
print("jpai" if "jpai" not in names else "jpai-" + re.sub(r"[^A-Za-z0-9]+", "-", sys.argv[1][8:])[:40])' "$HOST")"
    step "log in to $HOST as CLI profile '$PROFILE' (a browser window opens)"
    databricks auth login --host "$HOST" --profile "$PROFILE"
  fi
fi
ME="$(databricks current-user me --profile "$PROFILE" --output json | python3 -c 'import json,sys; print(json.load(sys.stdin)["userName"])')" \
  || die "cannot call the workspace with profile $PROFILE; run: databricks auth login --profile $PROFILE"
HOST="$(profiles_json | python3 -c '
import json, sys
print(next((p.get("host", "") for p in json.load(sys.stdin).get("profiles", []) if p["name"] == sys.argv[1]), ""))' "$PROFILE")"
HOST="${HOST%/}"
echo "Workspace: $HOST   user: $ME   CLI profile: $PROFILE   bundle target: $TARGET"

# --- catalog and warehouse -------------------------------------------------------------------------------------------
# Saved answers belong to one workspace: a run against another workspace starts from scratch.
OVERRIDES=".databricks/bundle/${TARGET}/variable-overrides.json"
SAVED_HOST=".databricks/bundle/${TARGET}/install-host"
if [ -f "$OVERRIDES" ] && [ "$(cat "$SAVED_HOST" 2>/dev/null)" != "$HOST" ]; then
  echo "Saved answers in $OVERRIDES are for another workspace; moving them to $OVERRIDES.bak."
  mv "$OVERRIDES" "$OVERRIDES.bak"
fi

# Resolved bundle variables (databricks.yml, BUNDLE_VAR_*, saved answers, options). "-" = not set.
resolve() {
  local extra=()
  [ -n "$CATALOG" ] && extra+=(--var "catalog=$CATALOG")
  [ -n "$WAREHOUSE" ] && extra+=(--var "warehouse_id=$WAREHOUSE")
  { databricks bundle validate --profile "$PROFILE" --target "$TARGET" --output json ${extra[@]+"${extra[@]}"} 2>/dev/null || true; } \
    | python3 -c '
import json, sys
try:
    v = json.load(sys.stdin).get("variables", {})
except ValueError:
    v = {}
print(" ".join(str((v.get(k) or {}).get("value") or "-") for k in ("catalog", "warehouse_id", "prefix", "schema", "synced_schema")))'
}
read -r R_CATALOG R_WAREHOUSE _ _ _ <<<"$(resolve)"
if [ -z "$CATALOG" ] && [ "$R_CATALOG" != "-" ]; then CATALOG="$R_CATALOG"; fi
if [ -z "$WAREHOUSE" ] && [ "$R_WAREHOUSE" != "-" ]; then WAREHOUSE="$R_WAREHOUSE"; fi
NEW_CATALOG="" NEW_WAREHOUSE=""

if [ -z "$CATALOG" ]; then
  if [ -z "$YES" ]; then
    echo; echo "Unity Catalog catalogs you can see (the bundle creates its schema in the one you pick):"
    databricks catalogs list --profile "$PROFILE" --output json | python3 -c '
import json, sys
data = json.load(sys.stdin)
rows = data if isinstance(data, list) else data.get("catalogs", [])
for c in rows:
    if c["name"] not in ("system", "samples", "hive_metastore") and not c["name"].startswith("__"):
        print("  -", c["name"])'
  fi
  CATALOG="$(ask 'Catalog: ')"; NEW_CATALOG=1
fi
[ -n "$CATALOG" ] || die "a catalog is required"

if [ -z "$WAREHOUSE" ]; then
  if [ -z "$YES" ]; then
    echo; echo "SQL warehouses (pick a serverless one):"
    databricks warehouses list --profile "$PROFILE" --output json | python3 -c '
import json, sys
data = json.load(sys.stdin)
rows = data if isinstance(data, list) else data.get("warehouses", [])
for w in rows:
    kind = "serverless" if w.get("enable_serverless_compute") else (w.get("warehouse_type") or "classic").lower()
    print("  - %s  %s  (%s, %s)" % (w["id"], w["name"], kind, w.get("state", "?")))'
  fi
  WAREHOUSE="$(ask 'Warehouse id: ')"; NEW_WAREHOUSE=1
fi
[ -n "$WAREHOUSE" ] || die "a SQL warehouse id is required"

read -r _ _ PREFIX SCHEMA SYNCED <<<"$(resolve)"
[ "$PREFIX" != "-" ] || die "the bundle does not validate with these values; run: databricks bundle validate --profile $PROFILE --target $TARGET --var catalog=$CATALOG --var warehouse_id=$WAREHOUSE"

cat <<EOF

About to install into $HOST (bundle target $TARGET):
  catalog / schema      ${CATALOG}.${SCHEMA}   (+ ${CATALOG}.${SYNCED} for the Lakebase synced tables)
  SQL warehouse         ${WAREHOUSE}
  app / jobs prefix     ${PREFIX}   (app: ${PREFIX}-chatbot)
  also creates          Lakebase project, AI Search endpoint, pipeline, 4 jobs, MLflow experiment
  takes                 30-60 minutes on a fresh workspace
EOF
if [ -z "$YES" ]; then
  ANSWER="$(ask 'Continue? [y/N] ')"
  [[ "$ANSWER" =~ ^[Yy] ]] || { echo "cancelled; nothing was saved or installed" >&2; exit 1; }
fi

# Save only what was entered here, so values set in databricks.yml or BUNDLE_VAR_* keep winning.
if [ -n "$NEW_CATALOG$NEW_WAREHOUSE" ]; then
  mkdir -p "$(dirname "$OVERRIDES")"
  python3 - "$OVERRIDES" "${NEW_CATALOG:+$CATALOG}" "${NEW_WAREHOUSE:+$WAREHOUSE}" <<'PY'
import json, os, sys
path, catalog, warehouse = sys.argv[1:]
data = json.load(open(path)) if os.path.exists(path) else {}
if catalog:
    data["catalog"] = catalog
if warehouse:
    data["warehouse_id"] = warehouse
json.dump(data, open(path, "w"), indent=2)
PY
  printf '%s' "$HOST" > "$SAVED_HOST"
  echo "Saved your answers to $OVERRIDES"
fi

# --- install --------------------------------------------------------------------------------------------------------
db() { databricks "$@" --profile "$PROFILE" --target "$TARGET" --var "catalog=$CATALOG" --var "warehouse_id=$WAREHOUSE"; }

step "1/7 validate bundle"
db bundle validate

step "2/7 workspace folder /Shared/${PREFIX}-chatbot (MLflow experiment parent)"
databricks workspace mkdirs "/Shared/${PREFIX}-chatbot" --profile "$PROFILE"

step "3/7 deploy bundle (schema, volumes, Lakebase, AI Search endpoint, pipeline, jobs, experiment, app)"
db bundle deploy

step "4/7 ingest_job: seed master data, copy PDFs, parse, chunk, publish"
db bundle run ingest_job

step "5/7 bootstrap_job: AI Search index, Lakebase synced tables, grants for the app"
db bundle run bootstrap_job

step "6/7 start app"
db bundle run chatbot

step "7/7 bootstrap_job again (grants now that the app is running)"
db bundle run bootstrap_job

APP_URL="$(databricks apps get "${PREFIX}-chatbot" --profile "$PROFILE" --output json | python3 -c 'import json,sys; print(json.load(sys.stdin).get("url",""))')"
cat <<EOF

Done.
  App:          ${APP_URL:-<see Compute > Apps in the workspace>}
  Health:       ${APP_URL:-<app-url>}/api/v1/health  (every check should be true)
  CLI profile:  $PROFILE   (use it in every later command)
  Later:        databricks bundle deploy --profile $PROFILE --target $TARGET          (after code or data changes)
                databricks bundle run ingest_job --profile $PROFILE --target $TARGET  (after adding PDFs)
EOF
