"""Unit tests for the job scripts (no Databricks, no Spark: fakes and stubs)."""
import importlib.util
import os
import sys
import types

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
JOBS = os.path.join(ROOT, "src", "jobs")


def _stub(name, **attrs):
    mod = sys.modules.get(name) or types.ModuleType(name)
    for k, v in attrs.items():
        setattr(mod, k, v)
    sys.modules[name] = mod
    return mod


def _ensure_pyspark():
    try:
        import pyspark  # noqa: F401
    except ImportError:
        class SparkSession:  # pragma: no cover - replaced by tests
            builder = None

        _stub("pyspark")
        _stub("pyspark.sql", SparkSession=SparkSession)
        _stub("pyspark.sql.types", **{n: (lambda *a, **k: None) for n in ("StructType", "StructField", "StringType", "DoubleType", "TimestampType")})
        sys.modules["pyspark"].sql = sys.modules["pyspark.sql"]
        sys.modules["pyspark.sql"].types = sys.modules["pyspark.sql.types"]


def load(name):
    _ensure_pyspark()
    spec = importlib.util.spec_from_file_location(f"jobs_{name}", os.path.join(JOBS, f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class NS(types.SimpleNamespace):
    pass


# ---- publish_tables ---------------------------------------------------------------------------------------------

class FakeSpark:
    def __init__(self, columns):
        self.columns = columns
        self.sql_log = []

    def table(self, name):
        return NS(schema=NS(fields=[NS(name=c) for c in self.columns[name.split(".")[-1].strip("`")]]))

    def sql(self, q):
        self.sql_log.append(q)


def test_publish_columns_include_the_new_section_and_chunk_columns():
    pt = load("publish_tables")
    assert {"is_pseudo", "study_ids"} <= set(pt.SECTION_COLS)
    assert "qa_status" in pt.CHUNK_COLS
    assert pt.ADDED_COLUMNS["if_sections"] == {"is_pseudo": "BOOLEAN", "study_ids": "ARRAY<STRING>"}


def test_ensure_columns_alters_an_existing_table_and_is_idempotent():
    pt = load("publish_tables")
    fq = lambda t: f"`c`.`s`.`{t}`"  # noqa: E731
    spark = FakeSpark({"if_sections": ["section_id", "markdown", "char_len"]})
    added = pt.ensure_columns(spark, fq, "if_sections", pt.ADDED_COLUMNS["if_sections"])
    assert added == ["is_pseudo", "study_ids"]
    assert spark.sql_log == ["ALTER TABLE `c`.`s`.`if_sections` ADD COLUMNS (is_pseudo BOOLEAN, study_ids ARRAY<STRING>)"]
    spark = FakeSpark({"if_sections": ["section_id", "IS_PSEUDO", "study_ids"]})  # case-insensitive, nothing to add
    assert pt.ensure_columns(spark, fq, "if_sections", pt.ADDED_COLUMNS["if_sections"]) == [] and spark.sql_log == []


def test_latest_parse_keeps_only_the_newest_parse_of_each_document():
    pt = load("publish_tables")
    q = pt.latest_parse("`c`.`s`.`sections_stg`", ["section_id", "doc_id"])
    assert "max(ingested_at) OVER (PARTITION BY doc_id)" in q and "ingested_at = _latest" in q
    assert q.startswith("SELECT section_id, doc_id FROM")


def test_main_adds_columns_before_the_first_merge():
    pt = load("publish_tables")
    spark = FakeSpark({"if_sections": ["section_id"], "if_chunks": ["chunk_id"], "docs_registry": ["doc_id"]})
    spark.sql_log = log = []
    orig_sql = spark.sql

    def sql(q):
        log.append(q)
        return NS(collect=lambda: [], first=lambda: {"c": 0}, show=lambda **k: None)

    spark.sql = sql
    pt.SparkSession = NS(builder=NS(getOrCreate=lambda: spark))
    sys.argv = ["publish_tables.py", "--catalog", "c", "--schema", "s"]
    pt.main()
    kinds = [("ALTER" if q.lstrip().startswith("ALTER") else "MERGE" if q.lstrip().startswith("MERGE") else "") for q in log]
    assert kinds.index("ALTER") < kinds.index("MERGE")
    merges = [q for q in log if q.lstrip().startswith("MERGE INTO `c`.`s`.`if_sections`")]
    assert any("is_pseudo" in q and "study_ids" in q and "max(ingested_at)" in q for q in merges)
    chunk_merge = [q for q in log if q.lstrip().startswith("MERGE INTO `c`.`s`.`if_chunks`")][0]
    assert "coalesce(sec.qa_status, 'AUTO') AS qa_status" in chunk_merge and "t.qa_status = s.qa_status" in chunk_merge
    assert orig_sql  # keep flake quiet


# ---- bootstrap --------------------------------------------------------------------------------------------------

def test_index_columns_add_qa_status_and_audience():
    bs = load("bootstrap")
    assert {"qa_status", "audience", "study_ids", "approved_flag", "is_current"} <= set(bs.INDEX_COLUMNS)


class FakeIndexes:
    def __init__(self, have, ready=True):
        self.have, self.ready = set(have), ready
        self.deleted = self.created = False
        self.exists = True

    def get_index(self, name):
        if not self.exists:
            from databricks.sdk.errors import NotFound
            raise NotFound("gone")
        return NS(status=NS(ready=self.ready, indexed_row_count=5, message=""))

    def query_index(self, index_name, columns, query_text, num_results):
        bad = [c for c in columns if c not in self.have]
        if bad:
            raise RuntimeError(f"Requested columns to return not found: {bad}")

    def delete_index(self, name):
        self.deleted, self.exists = True, False

    def create_index(self, **kw):
        self.created, self.exists = True, True
        self.create_kw = kw


def fake_client(indexes):
    return NS(
        vector_search_endpoints=NS(wait_get_endpoint_vector_search_endpoint_online=lambda n: None),
        vector_search_indexes=indexes,
        tables=NS(get=lambda n: None),
    )


ARGS = dict(catalog="c", schema="s", endpoint="e", embedding_endpoint="emb", recreate_index=False)


def test_existing_index_missing_a_column_is_reported_with_instructions():
    bs = load("bootstrap")
    old = [c for c in bs.INDEX_COLUMNS if c != "qa_status"]
    idx = FakeIndexes(old)
    name, missing = bs.ensure_index(fake_client(idx), NS(**ARGS))
    assert name == "c.s.if_chunks_idx" and missing == ["qa_status"] and not idx.deleted
    text = bs.recreate_instructions(name, missing)
    assert "qa_status" in text and "recreate_index=true" in text


def test_existing_complete_index_is_left_alone():
    bs = load("bootstrap")
    idx = FakeIndexes(bs.INDEX_COLUMNS)
    assert bs.ensure_index(fake_client(idx), NS(**ARGS))[1] == [] and not idx.deleted and not idx.created


def test_recreate_index_flag_deletes_and_recreates_with_the_full_column_list():
    bs = load("bootstrap")
    idx = FakeIndexes([c for c in bs.INDEX_COLUMNS if c != "qa_status"])
    name, missing = bs.ensure_index(fake_client(idx), NS(**dict(ARGS, recreate_index=True)))
    assert idx.deleted and idx.created and missing == []
    assert idx.create_kw["delta_sync_index_spec"].columns_to_sync == bs.INDEX_COLUMNS
    assert "qa_status" in idx.create_kw["delta_sync_index_spec"].columns_to_sync


def test_recreate_index_flag_parsing():
    bs = load("bootstrap")
    src = open(os.path.join(JOBS, "bootstrap.py"), encoding="utf-8").read()
    assert '"--recreate-index"' in src and "default=False" in src
    assert bs.recreate_instructions("i", ["x"])


class FakeApi:
    def __init__(self, effective, patch_fails):
        self.effective, self.patch_fails, self.calls = effective, patch_fails, []

    def do(self, method, path, query=None, body=None):
        self.calls.append((method, path))
        if method == "GET":
            privs = [{"privilege": "EXECUTE"}] if self.effective else []
            return {"privilege_assignments": [{"privileges": privs}]}
        if self.patch_fails:
            raise PermissionError("not allowed")
        return {}


MODEL_ARGS = NS(classifier_model_service="main.models.m")


def test_model_service_grant_failure_raises_when_not_effective():
    bs = load("bootstrap")
    w = NS(api_client=FakeApi(effective=False, patch_fails=True))
    with pytest.raises(RuntimeError, match="could not grant EXECUTE"):
        bs.grant_model_service(w, MODEL_ARGS, "sp-1")


def test_model_service_grant_failure_on_a_system_service_only_warns():
    bs = load("bootstrap")
    w = NS(api_client=FakeApi(effective=False, patch_fails=True))
    bs.grant_model_service(w, NS(classifier_model_service="system.ai.m"), "sp-1")  # no exception


def test_model_service_grant_is_skipped_when_already_effective_and_ok_when_it_succeeds():
    bs = load("bootstrap")
    w = NS(api_client=FakeApi(effective=True, patch_fails=True))
    bs.grant_model_service(w, MODEL_ARGS, "sp-1")  # no exception, no PATCH
    assert [m for m, _ in w.api_client.calls] == ["GET"]
    w = NS(api_client=FakeApi(effective=False, patch_fails=False))
    bs.grant_model_service(w, MODEL_ARGS, "sp-1")
    assert [m for m, _ in w.api_client.calls] == ["GET", "PATCH"]


def test_model_service_grant_failure_is_tolerated_only_if_effective_after_all():
    bs = load("bootstrap")

    class Flaky(FakeApi):
        def do(self, method, path, query=None, body=None):
            if method == "GET":
                self.calls.append((method, path))
                effective = len([c for c in self.calls if c[0] == "GET"]) > 1  # becomes effective after the first check
                return {"privilege_assignments": [{"privileges": [{"privilege": "EXECUTE"}] if effective else []}]}
            raise PermissionError("already a grantee")

    bs.grant_model_service(NS(api_client=Flaky(False, True)), MODEL_ARGS, "sp-1")


# ---- ae_notifier ------------------------------------------------------------------------------------------------

def test_task_value_failure_is_loud():
    ae = load("ae_notifier")

    class Boom:
        class jobs:
            class taskValues:
                @staticmethod
                def set(key, value):
                    raise RuntimeError("no job context")

    _stub("databricks.sdk.runtime", dbutils=Boom)
    with pytest.raises(RuntimeError, match="new_cases=3"):
        ae.set_task_value(3)


class FakeCursor:
    def __init__(self, log, rows):
        self.log, self.rows, self._last = log, rows, None

    def execute(self, q, params=None):
        self.log.append(q.strip().split()[0] + ":" + " ".join(q.split())[:60])
        self._last = q

    def fetchone(self):
        return ("app.ae_queue",)

    def fetchall(self):
        return self.rows


class FakeConn:
    def __init__(self, rows):
        self.log, self.committed, self.rows = [], False, rows

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def cursor(self):
        return FakeCursor(self.log, self.rows)

    def commit(self):
        self.committed = True


class FakeDF:
    def createOrReplaceTempView(self, n):
        pass


def run_ae_main(ae, conn, set_value):
    spark = NS(sql=lambda q: None, createDataFrame=lambda rows, schema: FakeDF())
    ae.SparkSession = NS(builder=NS(getOrCreate=lambda: spark))
    ae.WorkspaceClient = lambda: NS()
    ae.connect = lambda w, project: conn
    ae.set_task_value = set_value
    ae.T = NS(**{n: (lambda *a, **k: None) for n in ("StructType", "StructField", "StringType", "DoubleType", "TimestampType")})
    sys.argv = ["ae_notifier.py", "--catalog", "c", "--schema", "s", "--lakebase-project", "p"]
    ae.main()


def test_ae_notifier_does_not_mark_cases_notified_when_the_task_value_cannot_be_set():
    ae = load("ae_notifier")
    conn = FakeConn([("id1", "t1", "c1", "m", 0.9, None)])

    def fail(n):
        raise RuntimeError("no task values")

    with pytest.raises(RuntimeError, match="no task values"):
        run_ae_main(ae, conn, fail)
    assert not conn.committed and not any(l.startswith("UPDATE") for l in conn.log)


def test_ae_notifier_sets_the_value_then_marks_notified_and_includes_unclassified():
    ae = load("ae_notifier")
    conn = FakeConn([("id1", "t1", "c1", "m", 0.9, None)])
    seen = []
    run_ae_main(ae, conn, lambda n: seen.append((n, list(conn.log))))
    assert seen[0][0] == 1 and not any(l.startswith("UPDATE") for l in seen[0][1])  # value first
    assert any(l.startswith("UPDATE") for l in conn.log) and conn.committed
    select = [l for l in conn.log if l.startswith("SELECT:")]
    assert "UNCLASSIFIED" in open(os.path.join(JOBS, "ae_notifier.py"), encoding="utf-8").read() and select


# ---- sync_index -------------------------------------------------------------------------------------------------

class Clock:
    def __init__(self):
        self.t = 0.0

    def now(self):
        return self.t

    def sleep(self, s):
        self.t += s


class FakePipelines:
    def __init__(self, script):
        self.script = list(script)  # list of (update_id, state) returned by successive get()
        self.started = []

    def get(self, pid):
        u = self.script.pop(0) if len(self.script) > 1 else self.script[0]
        return NS(latest_updates=[NS(update_id=u[0], state=NS(value=u[1]))])

    def start_update(self, pid):
        self.started.append(pid)


def test_wait_for_update_waits_for_the_new_update_to_complete():
    si = load("sync_index")
    clk = Clock()
    w = NS(pipelines=FakePipelines([("u1", "COMPLETED"), ("u2", "RUNNING"), ("u2", "COMPLETED")]))
    si.wait_for_update(w, "p", "index", "u1", 10**6, clk.sleep, clk.now)
    assert clk.t >= si.POLL_SECONDS  # it did not return on the previous update


def test_wait_for_update_fails_on_failed_update_and_on_timeout():
    si = load("sync_index")
    clk = Clock()
    w = NS(pipelines=FakePipelines([("u2", "FAILED")]))
    with pytest.raises(RuntimeError, match="FAILED"):
        si.wait_for_update(w, "p", "index", "u1", 10**6, clk.sleep, clk.now)
    clk = Clock()
    w = NS(pipelines=FakePipelines([("u2", "RUNNING")]))
    with pytest.raises(TimeoutError, match="timeout"):
        si.wait_for_update(w, "p", "index", "u1", 30 * 60, clk.sleep, clk.now)
    assert clk.t >= 30 * 60


def test_wait_for_update_accepts_a_sync_that_created_no_new_update():
    si = load("sync_index")
    clk = Clock()
    w = NS(pipelines=FakePipelines([("u1", "COMPLETED")]))
    si.wait_for_update(w, "p", "index", "u1", 10**6, clk.sleep, clk.now)
    assert clk.t >= si.NEW_UPDATE_GRACE_SECONDS


def test_run_triggers_syncs_and_only_waits_with_the_wait_flag():
    si = load("sync_index")
    args = dict(catalog="c", schema="s", lakebase_catalog="lc", synced_schema="ss", wait_timeout_minutes=30)

    def client():
        synced = NS(status=NS(pipeline_id="pipe-sync"))
        calls = []
        w = NS(
            vector_search_indexes=NS(
                get_index=lambda n: NS(delta_sync_index_spec=NS(pipeline_id="pipe-idx")),
                sync_index=lambda n: calls.append(("sync_index", n)),
            ),
            postgres=NS(get_synced_table=lambda name: synced),
            pipelines=FakePipelines([("u1", "COMPLETED"), ("u2", "COMPLETED")]),
        )
        return w, calls

    w, calls = client()
    si.run(w, NS(**args, wait=False))
    assert calls == [("sync_index", "c.s.if_chunks_idx")] and w.pipelines.started == ["pipe-sync"]
    w, calls = client()
    clk = Clock()
    si.run(w, NS(**args, wait=True), clk.sleep, clk.now)
    assert w.pipelines.started == ["pipe-sync"]


def test_wait_flag_parsing_defaults_to_false_and_bare_flag_means_true():
    si = load("sync_index")
    assert si._bool("true") is True and si._bool("false") is False and si._bool(True) is True


# ---- bundle files -----------------------------------------------------------------------------------------------

def _yaml(name):
    import yaml

    with open(os.path.join(ROOT, "resources", name), encoding="utf-8") as f:
        return yaml.safe_load(f)


def test_ae_job_has_no_email_block_and_stays_paused():
    jobs = _yaml("jobs.yml")["resources"]["jobs"]
    ae = jobs["ae_notifier_job"]
    assert ae["schedule"]["pause_status"] == "PAUSED"
    assert "email_notifications" not in ae
    assert all("email_notifications" not in t for t in ae["tasks"])  # an empty address list would be invalid


def test_ingest_job_waits_for_the_syncs_and_bootstrap_passes_recreate_flag():
    jobs = _yaml("jobs.yml")["resources"]["jobs"]
    task = [t for t in jobs["ingest_job"]["tasks"] if t["task_key"] == "sync_index"][0]
    params = task["spark_python_task"]["parameters"]
    assert params[params.index("--wait") + 1] == "true"
    boot = jobs["bootstrap_job"]
    assert boot["parameters"][0]["name"] == "recreate_index" and boot["parameters"][0]["default"] == "false"
    bp = boot["tasks"][0]["spark_python_task"]["parameters"]
    assert bp[bp.index("--recreate-index") + 1] == "{{job.parameters.recreate_index}}"


def test_experiment_trace_schema_references_the_schema_resource():
    exp = _yaml("experiment.yml")["resources"]["experiments"]["traces"]
    assert exp["trace_location"]["uc_trace_location"]["schema"] == "${resources.schemas.chatbot_schema.name}"
    assert "chatbot_schema" in _yaml("schema_volume.yml")["resources"]["schemas"]


def test_ingest_reads_with_allow_overwrites_and_a_case_insensitive_glob():
    sql = open(os.path.join(ROOT, "src", "ingest", "transformations", "01_parsed_docs.sql"), encoding="utf-8").read()
    assert "allowOverwrites => true" in sql
    assert "pathGlobFilter => '*.[pP][dD][fF]'" in sql
    assert "(?i)" in sql  # doc_id is extracted from .PDF names too


def test_front_is_never_chunked_and_chunks_union_section_study_ids():
    src = open(os.path.join(ROOT, "src", "ingest", "transformations", "03_chunks.py"), encoding="utf-8").read()
    assert "section_path <> 'FRONT'" in src
    assert "coalesce(section_study_ids, array())" in src
    sec = open(os.path.join(ROOT, "src", "ingest", "transformations", "02_sections.py"), encoding="utf-8").read()
    assert '"is_pseudo"' in sec and '"study_ids"' in sec


def test_upload_docs_copies_uppercase_pdf_extensions():
    import tempfile

    ud = load("upload_docs")
    with tempfile.TemporaryDirectory() as src, tempfile.TemporaryDirectory() as dst:
        for n in ("a.pdf", "B.PDF", "c.txt"):
            open(os.path.join(src, n), "w").write("x")
        sys.argv = ["upload_docs.py", "--src-dir", src, "--volume-path", dst]
        ud.main()
        assert sorted(os.listdir(dst)) == ["B.PDF", "a.pdf"]


def test_offline_synced_tables_get_one_pipeline_update_then_wait_until_online():
    bs = load("bootstrap")
    calls = {"get": 0, "start": 0}

    def get_synced_table(name):
        calls["get"] += 1
        online = calls["start"] and calls["get"] > 2 * len(bs.SYNCED)
        state = "SYNCED_TABLE_ONLINE_NO_PENDING_UPDATE" if online or name.endswith(".if_sections") else "SYNCED_TABLE_OFFLINE"
        return NS(status=NS(detailed_state=state))

    w = NS(
        postgres=NS(get_synced_table=get_synced_table),
        pipelines=NS(get=lambda pid: NS(state="IDLE"), start_update=lambda pid: calls.__setitem__("start", calls["start"] + 1)),
    )
    bs.wait_synced_online(w, NS(lakebase_catalog="c", synced_schema="s"), "p1", sleep=lambda s: None)
    assert calls["start"] == 1
