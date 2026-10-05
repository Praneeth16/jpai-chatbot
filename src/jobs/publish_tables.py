"""Publish step: MERGE the pipeline output into plain Delta tables with Change Data Feed.

Why a separate step: the AI Search Delta Sync index and the Lakebase synced tables need plain Delta source tables with
CDF, and a MERGE gives stable primary keys, deletes stale sections when a document is re-parsed, and lets us compute
`is_current` (latest doc_rev per product wins) across all documents.

human QA (`qa_status`) and `is_current` are not overwritten by the section merge. is_current is recomputed from
docs_registry at the end. qa_status of a chunk follows the qa_status of its section (the index filters on it).

A document that was uploaded again is parsed again (read_files allowOverwrites), so the staging tables can hold several
parses of one doc_id. Only the latest parse (max ingested_at) of every document is merged; rows of older parses that no
longer exist are deleted from the published tables.

Schema evolution: columns added after a table was first created (is_pseudo, study_ids on if_sections; qa_status on
if_chunks) are added with ALTER TABLE ... ADD COLUMNS before the MERGE, so an existing deployment upgrades in place.
"""
import argparse

from pyspark.sql import SparkSession

DOCS_COLS = ["doc_id", "file_path", "file_name", "product_code", "doc_type", "doc_rev", "revision_date", "sha256", "ingested_at"]
SECTION_COLS = [
    "section_id", "doc_id", "product_code", "doc_rev", "section_path", "level", "title", "parent_section_id", "markdown",
    "pages", "approved_flag", "audience", "qa_status", "char_len", "is_pseudo", "study_ids",
]
CHUNK_COLS = [
    "chunk_id", "section_id", "doc_id", "product_code", "section_path", "study_ids", "chunk_to_embed", "chunk_to_retrieve",
    "approved_flag", "audience", "qa_status",
]
# columns that older deployments do not have yet: name -> type
ADDED_COLUMNS = {
    "if_sections": {"is_pseudo": "BOOLEAN", "study_ids": "ARRAY<STRING>"},
    "if_chunks": {"qa_status": "STRING"},
}


def ensure_columns(spark, fq, table, columns):
    """ALTER TABLE ADD COLUMNS for the columns the existing table does not have yet. Returns the names added."""
    have = {f.name.lower() for f in spark.table(fq(table)).schema.fields}
    missing = {c: t for c, t in columns.items() if c.lower() not in have}
    if missing:
        spark.sql(f"ALTER TABLE {fq(table)} ADD COLUMNS ({', '.join(f'{c} {t}' for c, t in missing.items())})")
        print(f"{table}: added columns {list(missing)}")
    return list(missing)


def latest_parse(src, cols):
    """Rows of the newest parse of every document (several parses exist after a re-upload)."""
    return (
        f"SELECT {', '.join(cols)} FROM (SELECT *, max(ingested_at) OVER (PARTITION BY doc_id) AS _latest FROM {src}) "
        f"WHERE ingested_at = _latest"
    )


def changed(cols):
    return "NOT (" + " AND ".join(f"t.{c} <=> s.{c}" for c in cols) + ")"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", required=True)
    ap.add_argument("--schema", required=True)
    a = ap.parse_args()
    spark = SparkSession.builder.getOrCreate()
    fq = lambda t: f"`{a.catalog}`.`{a.schema}`.`{t}`"  # noqa: E731
    cdf = "TBLPROPERTIES (delta.enableChangeDataFeed = true)"

    spark.sql(
        f"""CREATE TABLE IF NOT EXISTS {fq('docs_registry')} (doc_id STRING NOT NULL, file_path STRING, file_name STRING,
            product_code STRING, doc_type STRING, doc_rev STRING, revision_date DATE, sha256 STRING, ingested_at TIMESTAMP,
            is_current BOOLEAN) {cdf}"""
    )
    spark.sql(
        f"""CREATE TABLE IF NOT EXISTS {fq('if_sections')} (section_id STRING NOT NULL, doc_id STRING, product_code STRING,
            doc_rev STRING, section_path STRING, level INT, title STRING, parent_section_id STRING, markdown STRING,
            pages ARRAY<INT>, approved_flag BOOLEAN, audience STRING, is_current BOOLEAN, qa_status STRING, char_len INT,
            is_pseudo BOOLEAN, study_ids ARRAY<STRING>) {cdf}"""
    )
    spark.sql(
        f"""CREATE TABLE IF NOT EXISTS {fq('if_chunks')} (chunk_id STRING NOT NULL, section_id STRING, doc_id STRING,
            product_code STRING, section_path STRING, study_ids ARRAY<STRING>, chunk_to_embed STRING,
            chunk_to_retrieve STRING, approved_flag BOOLEAN, audience STRING, is_current BOOLEAN, qa_status STRING) {cdf}"""
    )
    for table, columns in ADDED_COLUMNS.items():
        ensure_columns(spark, fq, table, columns)

    # ---- documents (one row per doc from the section stream) and is_current across ALL documents
    spark.sql(
        f"""CREATE OR REPLACE TEMP VIEW stg_docs AS
            SELECT doc_id, any_value(file_path) AS file_path, regexp_extract(any_value(file_path), '[^/]+$', 0) AS file_name,
                   any_value(product_code) AS product_code, 'IF' AS doc_type, any_value(doc_rev) AS doc_rev,
                   any_value(revision_date) AS revision_date, any_value(sha256) AS sha256, max(ingested_at) AS ingested_at
            FROM ({latest_parse(fq('sections_stg'), ['doc_id', 'file_path', 'product_code', 'doc_rev', 'revision_date', 'sha256', 'ingested_at'])})
            GROUP BY doc_id"""
    )
    spark.sql(
        f"""MERGE INTO {fq('docs_registry')} t USING (
              WITH all_docs AS (
                SELECT {', '.join(DOCS_COLS)} FROM stg_docs
                UNION ALL
                SELECT {', '.join(DOCS_COLS)} FROM {fq('docs_registry')} WHERE doc_id NOT IN (SELECT doc_id FROM stg_docs))
              SELECT *, row_number() OVER (
                       PARTITION BY coalesce(product_code, doc_id)
                       ORDER BY revision_date DESC NULLS LAST,
                                CAST(regexp_extract(doc_rev, '第(\\\\d+)版', 1) AS INT) DESC NULLS LAST,
                                ingested_at DESC) = 1 AS is_current
              FROM all_docs) s
            ON t.doc_id = s.doc_id
            WHEN MATCHED AND ({changed(DOCS_COLS + ['is_current'])}) THEN UPDATE SET *
            WHEN NOT MATCHED THEN INSERT *"""
    )

    # Delta does not allow a subquery in the DELETE condition, so the document ids are inlined
    doc_ids = [r["doc_id"] for r in spark.sql("SELECT doc_id FROM stg_docs").collect()]
    in_list = ", ".join("'" + d.replace("'", "''") + "'" for d in doc_ids) or "NULL"

    # ---- sections and chunks: upsert the latest parse, and drop rows of a re-parsed document that no longer exist
    for table, key, cols, src in [
        ("if_sections", "section_id", SECTION_COLS, "sections_stg"),
        ("if_chunks", "chunk_id", CHUNK_COLS, "chunks_stg"),
    ]:
        if table == "if_sections":
            update_cols = [c for c in cols if c != "qa_status"]  # keep human QA decisions
            staged = latest_parse(fq(src), cols)
            select_src = f"SELECT x.*, coalesce(d.is_current, false) AS is_current FROM ({staged}) x"
        else:
            update_cols = cols  # a chunk follows the qa_status of its section (already merged above)
            staged = latest_parse(fq(src), [c for c in cols if c != "qa_status"])
            select_src = (
                "SELECT x.*, coalesce(sec.qa_status, 'AUTO') AS qa_status, coalesce(d.is_current, false) AS is_current "
                f"FROM ({staged}) x LEFT JOIN {fq('if_sections')} sec ON x.section_id = sec.section_id"
            )
        set_clause = ", ".join(f"t.{c} = s.{c}" for c in update_cols)
        spark.sql(
            f"""MERGE INTO {fq(table)} t USING (
                  {select_src}
                  LEFT JOIN {fq('docs_registry')} d ON x.doc_id = d.doc_id) s
                ON t.{key} = s.{key}
                WHEN MATCHED AND ({changed(update_cols)}) THEN UPDATE SET {set_clause}
                WHEN NOT MATCHED THEN INSERT *
                WHEN NOT MATCHED BY SOURCE AND t.doc_id IN ({in_list}) THEN DELETE"""
        )
        # documents that already existed: follow the is_current decision of docs_registry
        spark.sql(
            f"""MERGE INTO {fq(table)} t USING {fq('docs_registry')} d ON t.doc_id = d.doc_id
                WHEN MATCHED AND NOT (t.is_current <=> d.is_current) THEN UPDATE SET t.is_current = d.is_current"""
        )

    for t in ["docs_registry", "if_sections", "if_chunks"]:
        n = spark.sql(f"SELECT count(*) c FROM {fq(t)}").first()["c"]
        print(f"{t}: {n} rows")
    spark.sql(
        f"SELECT doc_id, product_code, doc_rev, revision_date, is_current FROM {fq('docs_registry')} ORDER BY product_code, revision_date DESC"
    ).show(truncate=False)


if __name__ == "__main__":
    main()
