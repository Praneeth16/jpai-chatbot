"""Trigger the AI Search index sync and the Lakebase synced tables after new content was published.

Both exist only after bootstrap_job has run once; on the first install this task simply reports that and succeeds.

With `--wait` (set in ingest_job) the task does not finish before the index sync and the synced-table pipeline updates
have finished, so "ingest_job succeeded" means the new content can be searched. It prints the pipeline state every
30 s and fails on a FAILED / CANCELED update or when `--wait-timeout-minutes` (default 30) is over.
"""
import argparse
import time

from databricks.sdk import WorkspaceClient
from databricks.sdk.errors import BadRequest, NotFound, ResourceDoesNotExist

TABLES = ["if_sections", "docs_registry", "products", "studies", "synonyms", "templates"]
TERMINAL_OK = {"COMPLETED"}
TERMINAL_BAD = {"FAILED", "CANCELED"}
POLL_SECONDS = 30
NEW_UPDATE_GRACE_SECONDS = 90  # a sync with nothing to do may not create a new update at all


def _bool(value):
    return value if isinstance(value, bool) else str(value).lower() in ("1", "true", "yes")


def _state(update):
    s = getattr(update, "state", None)
    return str(getattr(s, "value", s)) if s is not None else ""


def latest_update(w, pipeline_id):
    """(update_id, state) of the newest update of a pipeline, or (None, '')."""
    updates = w.pipelines.get(pipeline_id).latest_updates or []
    return (updates[0].update_id, _state(updates[0])) if updates else (None, "")


def wait_for_update(w, pipeline_id, label, before_id, deadline, sleep=time.sleep, now=time.time):
    """Block until the update that was triggered after `before_id` reaches a terminal state."""
    started = now()
    while True:
        update_id, state = latest_update(w, pipeline_id)
        is_new = update_id is not None and update_id != before_id
        waited_long = now() - started > NEW_UPDATE_GRACE_SECONDS
        print(f"  {label}: pipeline {pipeline_id} update {update_id} state {state or '?'}{'' if is_new else ' (previous update)'}")
        if (is_new or waited_long) and state in TERMINAL_BAD:
            raise RuntimeError(f"{label}: pipeline update {update_id} ended in {state}")
        if (is_new or waited_long) and state in TERMINAL_OK:
            return
        if now() > deadline:
            raise TimeoutError(f"{label}: pipeline {pipeline_id} update {update_id} still {state or '?'} at the timeout")
        sleep(POLL_SECONDS)


def run(w, a, sleep=time.sleep, now=time.time):
    waits = []  # (label, pipeline_id, update id before the trigger)

    index = f"{a.catalog}.{a.schema}.if_chunks_idx"
    try:
        idx = w.vector_search_indexes.get_index(index)
        spec = idx.delta_sync_index_spec
        pid = spec.pipeline_id if spec else None
        before = latest_update(w, pid)[0] if pid else None
        w.vector_search_indexes.sync_index(index)
        print(f"sync started: {index}")
        if pid:
            waits.append((f"index {index}", pid, before))
        else:
            print(f"  index {index} reports no pipeline id: cannot wait for it")
    except (NotFound, ResourceDoesNotExist):
        print(f"index {index} does not exist yet (run bootstrap_job); skipped")
    except BadRequest as e:
        print(f"index sync not started: {e}")

    pipelines = set()
    for t in TABLES:
        try:
            st = w.postgres.get_synced_table(name=f"synced_tables/{a.lakebase_catalog}.{a.synced_schema}.{t}")
        except (NotFound, ResourceDoesNotExist):
            print(f"synced table {t} does not exist yet (run bootstrap_job); skipped")
            continue
        if st.status and st.status.pipeline_id:
            pipelines.add(st.status.pipeline_id)
    for pid in sorted(pipelines):
        before = latest_update(w, pid)[0]
        try:
            w.pipelines.start_update(pid)
            print(f"synced-table pipeline update started: {pid}")
        except Exception as e:  # an update may already be running: it is the one to wait for
            print(f"pipeline {pid} not started: {e}")
        waits.append((f"synced tables ({pid})", pid, before))

    if not a.wait:
        print("not waiting for the syncs to finish (--wait not set)")
        return
    deadline = now() + a.wait_timeout_minutes * 60
    for label, pid, before in waits:
        wait_for_update(w, pid, label, before, deadline, sleep, now)
    print(f"all {len(waits)} sync(s) finished")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", required=True)
    ap.add_argument("--schema", required=True)
    ap.add_argument("--lakebase-catalog", required=True)
    ap.add_argument("--synced-schema", required=True)
    ap.add_argument("--wait", nargs="?", const=True, default=False, type=_bool, help="wait until the syncs have finished")
    ap.add_argument("--wait-timeout-minutes", type=int, default=30)
    run(WorkspaceClient(), ap.parse_args(argv))


if __name__ == "__main__":
    main()
