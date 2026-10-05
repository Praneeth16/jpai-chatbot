"""Move new adverse-event candidates from the app queue (Lakebase app.ae_queue) into the UC table pv_cases.

Runs every 15 minutes. Each row is written to pv_cases (MERGE on case_id = ae_id, so a retry never duplicates) and then
marked NOTIFIED in Postgres. The number of new cases is published as task value `new_cases`; the job sends the e-mail
to the PV address only when it is greater than zero. The e-mail contains no message text (it is pharmacovigilance data).

The task value is set BEFORE the rows are marked NOTIFIED and the Postgres transaction is committed, and failing to set
it raises: a case must never be marked notified when the condition task cannot see it. After a failure the rows are still
queued and the next run moves them again (the pv_cases MERGE on case_id makes that safe).

Rows with status UNCLASSIFIED (written when the classifier was unavailable, CONTRACTS section 8) are notified like NEW
ones: they are exactly the cases nobody has looked at.
"""
import argparse

import psycopg
from databricks.sdk import WorkspaceClient
from pyspark.sql import SparkSession
from pyspark.sql import types as T

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


def set_task_value(n):
    """Publish `new_cases` for the condition task. Fails loudly: without it the PV e-mail would silently never be sent."""
    try:
        from databricks.sdk.runtime import dbutils

        dbutils.jobs.taskValues.set(key="new_cases", value=n)
    except Exception as e:
        raise RuntimeError(
            f"could not set the task value new_cases={n}; the condition task would never trigger the PV notification ({e})"
        ) from e


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", required=True)
    ap.add_argument("--schema", required=True)
    ap.add_argument("--lakebase-project", required=True)
    a = ap.parse_args()
    spark = SparkSession.builder.getOrCreate()
    w = WorkspaceClient()
    pv = f"`{a.catalog}`.`{a.schema}`.pv_cases"
    spark.sql(
        f"""CREATE TABLE IF NOT EXISTS {pv} (case_id STRING, turn_id STRING, conversation_id STRING, message STRING,
            ae_probability DOUBLE, detected_at TIMESTAMP, notified_at TIMESTAMP)"""
    )
    with connect(w, a.lakebase_project) as conn:
        cur = conn.cursor()
        cur.execute("SELECT to_regclass('app.ae_queue')")
        if cur.fetchone()[0] is None:
            print("app.ae_queue does not exist yet (the app creates it on first start): nothing to do")
            set_task_value(0)
            return
        cur.execute(
            """SELECT ae_id::text, turn_id::text, conversation_id, message, ae_probability, created_at
               FROM app.ae_queue WHERE status IN ('NEW', 'UNCLASSIFIED') ORDER BY created_at FOR UPDATE SKIP LOCKED"""
        )
        rows = cur.fetchall()
        if rows:
            schema = T.StructType(
                [
                    T.StructField("case_id", T.StringType()), T.StructField("turn_id", T.StringType()),
                    T.StructField("conversation_id", T.StringType()), T.StructField("message", T.StringType()),
                    T.StructField("ae_probability", T.DoubleType()), T.StructField("detected_at", T.TimestampType()),
                ]
            )
            spark.createDataFrame(rows, schema).createOrReplaceTempView("new_ae")
            spark.sql(
                f"""MERGE INTO {pv} t USING (SELECT *, current_timestamp() AS notified_at FROM new_ae) s ON t.case_id = s.case_id
                    WHEN NOT MATCHED THEN INSERT *"""
            )
        set_task_value(len(rows))  # before marking the rows: if this raises they stay NEW and are picked up again
        if rows:
            cur.execute(
                "UPDATE app.ae_queue SET status = 'NOTIFIED', notified_at = now() WHERE ae_id = ANY(%s::uuid[])",
                ([r[0] for r in rows],),
            )
        conn.commit()
    print(f"{len(rows)} new AE case(s) moved to {a.catalog}.{a.schema}.pv_cases")


if __name__ == "__main__":
    main()
