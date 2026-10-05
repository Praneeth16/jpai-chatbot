"""Idempotent bootstrap of everything that needs the published Delta tables to exist first:

1. AI Search Delta Sync index  <catalog>.<schema>.if_chunks_idx  (embeds chunk_to_embed, hybrid search ready)
2. UC catalog <lakebase_catalog> for the Lakebase database (created here, not in the bundle, because it needs the
   CREATE CATALOG privilege; an existing catalog is reused) and Lakebase synced tables for if_sections, docs_registry,
   products, studies, synonyms, templates in <lakebase_catalog>.<synced_schema> -> Postgres schema <synced_schema>
3. Grants for the app service principal (UC: USE on catalog/schema, SELECT on the schema and the index, EXECUTE on the
   classifier model service when it is not already granted to all users; Postgres: USAGE + SELECT on the synced schema).
   Skipped with a message when the app does not exist yet; run the job again after the app was created.

Safe to run any number of times.

Index columns: `columns_to_sync` of an existing AI Search index cannot be changed. When an existing index lacks a column
listed in INDEX_COLUMNS (for example qa_status, added in v1.3), the job prints what to do and, after everything else was
done, exits with an error. Run it with `--recreate-index true` (bundle run bootstrap_job --params recreate_index=true)
to delete and recreate the index; the search endpoint is unavailable until the new index has synced.

Grant failures: a failing EXECUTE grant on the classifier model service makes the job fail, unless EXECUTE is already
effective for the app service principal.
"""
import argparse
import time

import psycopg
from databricks.sdk import WorkspaceClient
from databricks.sdk.errors import NotFound, PermissionDenied, ResourceDoesNotExist
from databricks.sdk.service import postgres as pg
from databricks.sdk.service.catalog import PermissionsChange, Privilege, SecurableType
from databricks.sdk.service.vectorsearch import (
    DeltaSyncVectorIndexSpecRequest,
    EmbeddingSourceColumn,
    PipelineType,
    VectorIndexType,
)


def connect(w, project_id, branch="production", dbname="databricks_postgres"):
    """Connect to the Lakebase project of this deployment with a short-lived OAuth credential (no shared module:
    `__file__` is not defined in serverless Python tasks, so scripts cannot import siblings)."""
    endpoints = list(w.postgres.list_endpoints(parent=f"projects/{project_id}/branches/{branch}"))
    if not endpoints:
        raise RuntimeError(f"no compute endpoint on projects/{project_id}/branches/{branch}")
    ep = endpoints[0]
    token = w.postgres.generate_database_credential(endpoint=ep.name).token
    return psycopg.connect(
        host=ep.status.hosts.host, port=5432, dbname=dbname, user=w.current_user.me().user_name, password=token, sslmode="require"
    )


INDEX_COLUMNS = [
    "chunk_id", "section_id", "doc_id", "product_code", "study_ids", "approved_flag", "audience", "is_current",
    "qa_status", "chunk_to_retrieve", "section_path",
]
SYNCED = {  # table -> primary key
    "if_sections": ["section_id"],
    "docs_registry": ["doc_id"],
    "products": ["product_code"],
    "studies": ["study_id"],
    "synonyms": ["synonym_id"],
    "templates": ["template_key"],
}


def _create_index(w, a, name, source):
    w.tables.get(source)  # fails with a clear message when publish_tables has not run
    w.vector_search_indexes.create_index(
        name=name,
        endpoint_name=a.endpoint,
        primary_key="chunk_id",
        index_type=VectorIndexType.DELTA_SYNC,
        delta_sync_index_spec=DeltaSyncVectorIndexSpecRequest(
            source_table=source,
            pipeline_type=PipelineType.TRIGGERED,
            embedding_source_columns=[
                EmbeddingSourceColumn(name="chunk_to_embed", embedding_model_endpoint_name=a.embedding_endpoint)
            ],
            columns_to_sync=INDEX_COLUMNS,
        ),
    )
    print(f"index created: {name}")


def missing_index_columns(w, name):
    """INDEX_COLUMNS that an existing index does not serve. The SDK does not expose columns_to_sync of an existing
    index, so ask the index for every column (one query per column only if the combined query fails)."""
    try:
        w.vector_search_indexes.query_index(index_name=name, columns=INDEX_COLUMNS, query_text="test", num_results=1)
        return []
    except Exception as first:
        missing = []
        for col in INDEX_COLUMNS:
            try:
                w.vector_search_indexes.query_index(index_name=name, columns=[col], query_text="test", num_results=1)
            except Exception:
                missing.append(col)
        if not missing:
            print(f"  could not check the columns of {name} ({first}); assuming they are complete")
        return missing


def recreate_instructions(name, missing):
    return (
        f"index {name} lacks the column(s) {missing}, and the columns of an existing index cannot be changed. "
        f"Recreate it: databricks bundle run bootstrap_job --params recreate_index=true  (deletes the index and builds it "
        f"again; search is unavailable until it is synced). Or delete the index in the UI and run bootstrap_job again."
    )


def ensure_index(w, a):
    """Create the index if needed. Returns (index name, missing columns of an existing index)."""
    name = f"{a.catalog}.{a.schema}.if_chunks_idx"
    source = f"{a.catalog}.{a.schema}.if_chunks"
    print(f"waiting for AI Search endpoint {a.endpoint} ...")
    w.vector_search_endpoints.wait_get_endpoint_vector_search_endpoint_online(a.endpoint)
    missing = []
    try:
        w.vector_search_indexes.get_index(name)
        print(f"index exists: {name}")
        if getattr(a, "recreate_index", False):
            print(f"--recreate-index: deleting {name}")
            w.vector_search_indexes.delete_index(name)
            deadline = time.time() + 10 * 60
            while time.time() < deadline:
                try:
                    w.vector_search_indexes.get_index(name)
                    time.sleep(10)
                except (NotFound, ResourceDoesNotExist):
                    break
            _create_index(w, a, name, source)
        else:
            idx = w.vector_search_indexes.get_index(name)
            if idx.status and idx.status.ready:
                missing = missing_index_columns(w, name)
                if missing:
                    print("WARNING: " + recreate_instructions(name, missing))
    except (NotFound, ResourceDoesNotExist):
        _create_index(w, a, name, source)
    deadline = time.time() + 40 * 60
    while time.time() < deadline:
        idx = w.vector_search_indexes.get_index(name)
        st = idx.status
        if st and st.ready:
            print(f"index ready, indexed rows: {st.indexed_row_count}")
            return name, missing
        print(f"  index not ready: {st.message if st else ''}")
        time.sleep(30)
    raise TimeoutError(f"index {name} not ready after 40 minutes")


def ensure_lakebase_catalog(w, a):
    """Make sure UC catalog <lakebase_catalog> exists and has the schema <synced_schema> that holds the synced tables.
    A standard catalog works too (no CREATE CATALOG needed); the synced schema must differ from the source schema."""
    try:
        w.catalogs.get(a.lakebase_catalog)
        print(f"catalog exists: {a.lakebase_catalog}")
    except (NotFound, ResourceDoesNotExist):
        branch = f"projects/{a.lakebase_project}/branches/production"
        try:
            op = w.postgres.create_catalog(
                pg.Catalog(spec=pg.CatalogCatalogSpec(branch=branch, postgres_database="databricks_postgres")),
                catalog_id=a.lakebase_catalog,
            )
            op.wait()
            print(f"Lakebase catalog created: {a.lakebase_catalog}")
        except PermissionDenied as e:
            raise RuntimeError(
                f"catalog '{a.lakebase_catalog}' does not exist and this identity cannot create it ({e}). Ask a metastore "
                f"admin for CREATE CATALOG, or create the catalog once and run this job again."
            ) from e
    try:
        w.schemas.get(f"{a.lakebase_catalog}.{a.synced_schema}")
    except (NotFound, ResourceDoesNotExist):
        w.schemas.create(name=a.synced_schema, catalog_name=a.lakebase_catalog, comment="Lakebase synced tables")
        print(f"schema created: {a.lakebase_catalog}.{a.synced_schema}")


def ensure_synced_tables(w, a):
    ensure_lakebase_catalog(w, a)
    branch = f"projects/{a.lakebase_project}/branches/production"
    pipeline_id = None
    for table, pk in SYNCED.items():
        synced_id = f"{a.lakebase_catalog}.{a.synced_schema}.{table}"
        try:
            st = w.postgres.get_synced_table(name=f"synced_tables/{synced_id}")
            pipeline_id = pipeline_id or (st.status.pipeline_id if st.status else None)
            print(f"synced table exists: {synced_id}")
            continue
        except (NotFound, ResourceDoesNotExist):
            pass
        spec = pg.SyncedTableSyncedTableSpec(
            source_table_full_name=f"{a.catalog}.{a.schema}.{table}",
            primary_key_columns=pk,
            scheduling_policy=pg.SyncedTableSyncedTableSpecSyncedTableSchedulingPolicy.TRIGGERED,
            branch=branch,
            postgres_database="databricks_postgres",
            create_database_objects_if_missing=True,
        )
        if pipeline_id:
            spec.existing_pipeline_id = pipeline_id  # one pipeline for all five tables
        else:
            spec.new_pipeline_spec = pg.NewPipelineSpec(storage_catalog=a.catalog, storage_schema=a.schema)
        op = w.postgres.create_synced_table(pg.SyncedTable(spec=spec), synced_table_id=synced_id)
        st = op.wait()
        pipeline_id = pipeline_id or (st.status.pipeline_id if st.status else None)
        print(f"synced table created: {synced_id}")
    wait_synced_online(w, a)


def wait_synced_online(w, a):
    deadline = time.time() + 30 * 60
    while time.time() < deadline:
        states = {}
        for table in SYNCED:
            st = w.postgres.get_synced_table(name=f"synced_tables/{a.lakebase_catalog}.{a.synced_schema}.{table}")
            states[table] = str(st.status.detailed_state) if st.status else "?"
        print("  synced tables:", states)
        if all("ONLINE" in s for s in states.values()):
            return
        time.sleep(30)
    print("WARNING: synced tables not all online after 30 minutes; continuing")


def _model_execute_effective(w, a, sp):
    base = f"/api/2.1/unity-catalog/effective-permissions/model_service/{a.classifier_model_service}"
    eff = w.api_client.do("GET", base, query={"principal": sp})
    privs = [p["privilege"] for pa in eff.get("privilege_assignments", []) for p in pa.get("privileges", [])]
    return "EXECUTE" in privs or "ALL_PRIVILEGES" in privs


def grant_model_service(w, a, sp):
    """EXECUTE on the classifier model service (bundle app resources cannot bind MODEL_SERVICE yet).
    Raises when the grant fails and EXECUTE is not already effective: without it every classification call of the app fails."""
    perms = f"/api/2.1/unity-catalog/permissions/model_service/{a.classifier_model_service}"
    try:
        if _model_execute_effective(w, a, sp):
            print(f"  model service {a.classifier_model_service}: EXECUTE already effective, nothing to grant")
            return
    except Exception as e:
        print(f"  could not read effective permissions on {a.classifier_model_service} ({e}); trying the grant")
    try:
        w.api_client.do("PATCH", perms, body={"changes": [{"principal": sp, "add": ["EXECUTE"]}]})
        print(f"  UC: EXECUTE on model service {a.classifier_model_service}")
    except Exception as e:
        try:
            if _model_execute_effective(w, a, sp):
                print(f"  grant failed ({e}) but EXECUTE is effective anyway")
                return
        except Exception:
            pass
        raise RuntimeError(
            f"could not grant EXECUTE on model service {a.classifier_model_service} to {sp} and it is not effective: {e}. "
            f"Ask the owner of the model service to grant EXECUTE to the app service principal, then run bootstrap_job again."
        ) from e


def grant_app(w, a, index_name):
    try:
        app = w.apps.get(a.app_name)
    except (NotFound, ResourceDoesNotExist):
        print(f"app '{a.app_name}' does not exist yet: grants skipped. Run bootstrap_job again after the app was created.")
        return
    sp = app.service_principal_client_id
    if not sp:
        print(f"app '{a.app_name}' has no service principal yet: grants skipped")
        return
    print(f"granting read access to app service principal {sp}")
    for stype, full, privs in [
        (SecurableType.CATALOG, a.catalog, [Privilege.USE_CATALOG]),
        (SecurableType.SCHEMA, f"{a.catalog}.{a.schema}", [Privilege.USE_SCHEMA, Privilege.SELECT]),
        (SecurableType.TABLE, index_name, [Privilege.SELECT]),
    ]:
        w.grants.update(securable_type=stype, full_name=full, changes=[PermissionsChange(principal=sp, add=privs)])
        print(f"  UC: {[p.value for p in privs]} on {full}")

    with connect(w, a.lakebase_project) as conn:
        cur = conn.cursor()
        role = f'"{sp}"'
        cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (sp,))
        if cur.fetchone() is None:
            cur.execute("CREATE EXTENSION IF NOT EXISTS databricks_auth")
            cur.execute("SELECT databricks_create_role(%s, 'SERVICE_PRINCIPAL')", (sp,))
            print("  Postgres: role created")
        schema = f'"{a.synced_schema}"'
        cur.execute(f"GRANT USAGE ON SCHEMA {schema} TO {role}")
        cur.execute(f"GRANT SELECT ON ALL TABLES IN SCHEMA {schema} TO {role}")
        cur.execute(f"ALTER DEFAULT PRIVILEGES IN SCHEMA {schema} GRANT SELECT ON TABLES TO {role}")
        conn.commit()
        print(f"  Postgres: USAGE + SELECT on schema {a.synced_schema}")

    # last, so that a failure here (it raises) does not skip the grants above
    grant_model_service(w, a, sp)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", required=True)
    ap.add_argument("--schema", required=True)
    ap.add_argument("--endpoint", required=True, help="AI Search endpoint name")
    ap.add_argument("--embedding-endpoint", required=True)
    ap.add_argument("--lakebase-project", required=True)
    ap.add_argument("--lakebase-catalog", required=True)
    ap.add_argument("--synced-schema", required=True, help="UC + Postgres schema of the synced tables (not the source schema)")
    ap.add_argument("--app-name", required=True)
    ap.add_argument("--classifier-model-service", required=True)
    ap.add_argument(
        "--recreate-index",
        nargs="?",
        const=True,
        default=False,
        type=lambda v: v if isinstance(v, bool) else str(v).lower() in ("1", "true", "yes"),
        help="delete and recreate the AI Search index (needed when INDEX_COLUMNS gained a column); default false",
    )
    a = ap.parse_args()
    w = WorkspaceClient()
    index_name, missing = ensure_index(w, a)
    ensure_synced_tables(w, a)
    grant_app(w, a, index_name)
    if missing:
        raise RuntimeError(recreate_instructions(index_name, missing))
    print("bootstrap done")


if __name__ == "__main__":
    main()
