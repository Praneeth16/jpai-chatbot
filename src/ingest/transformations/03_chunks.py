"""Chunks: ai_prep_search on the text of each section (never across sections).

Input is sections_stg.own_markdown, i.e. the text of a section before its first child. For a leaf section that is the
whole section, for a parent it is only its introduction, so every character of the IF is chunked exactly once and
every chunk has exactly one section_id. FRONT (cover, table of contents, abbreviations) is never chunked. Pseudo-sections
are chunked like any other section. A chunk's study_ids are the study_ids of its section (heading-derived, inherited
from parents) united with the studies detected in the chunk text. The section header line (product, revision, path, title) is put in front so the
embedding keeps that context. ai_prep_search runs inside the serverless pipeline (verified), version pinned to 2.0
(the first version that supports the `schema` option).
"""
import csv

from pyspark import pipelines as dp
from pyspark.sql import functions as F

PREP_VERSION = "2.0"

with open(spark.conf.get("studies_csv"), encoding="utf-8") as _f:
    STUDIES = [(r["study_id"], r["study_code"]) for r in csv.DictReader(_f)]

_labels = ",".join(f'"{sid}"' for sid, _ in STUDIES)
PREP_OPTIONS = (
    f"map('version', '{PREP_VERSION}', 'schema', "
    f"'{{\"studies\":{{\"type\":\"array\",\"items\":{{\"type\":\"enum\",\"labels\":[{_labels}]}}}}}}')"
)
# deterministic study detection (study name or study code appears in the text), merged with the model tags
_ids = ",".join(f"'{sid}'" for sid, _ in STUDIES)
_pairs = ",".join(f"named_struct('id','{sid}','code','{code}')" for sid, code in STUDIES)
STUDY_IDS = f"""array_sort(array_distinct(array_union(
    coalesce(section_study_ids, array()),
    array_union(
      coalesce(variant_get(c, '$.metadata.studies', 'ARRAY<STRING>'), array()),
      array_union(
        filter(array({_ids}), x -> instr(lower(c_text), lower(x)) > 0),
        transform(filter(array({_pairs}), p -> instr(lower(c_text), lower(p.code)) > 0), p -> p.id))))))"""


@dp.table(
    name="chunks_stg",
    comment="RAG chunks (ai_prep_search) with the section they belong to",
    table_properties={"delta.enableChangeDataFeed": "true"},
)
def chunks_stg():
    sections = spark.readStream.table("sections_stg").where("own_body_len > 0 AND section_path <> 'FRONT'")
    prepped = sections.select(
        "section_id",
        "doc_id",
        "product_code",
        "section_path",
        "approved_flag",
        "audience",
        "ingested_at",
        F.col("study_ids").alias("section_study_ids"),
        F.expr(f"ai_prep_search(concat(header_line, '\\n\\n', own_markdown), {PREP_OPTIONS})").alias("prep"),
    )
    chunks = prepped.select(
        "section_id",
        "doc_id",
        "product_code",
        "section_path",
        "approved_flag",
        "audience",
        "ingested_at",
        "section_study_ids",
        F.explode(F.expr("variant_get(prep, '$.document.contents', 'ARRAY<VARIANT>')")).alias("c"),
    ).withColumn("c_text", F.expr("variant_get(c, '$.chunk_to_retrieve', 'STRING')"))
    return chunks.select(
        F.expr("concat(section_id, '#', variant_get(c, '$.chunk_position', 'INT'))").alias("chunk_id"),
        F.expr("variant_get(c, '$.chunk_position', 'INT')").alias("chunk_position"),
        "section_id",
        "doc_id",
        "product_code",
        "section_path",
        F.expr(STUDY_IDS).alias("study_ids"),
        F.expr("variant_get(c, '$.chunk_to_embed', 'STRING')").alias("chunk_to_embed"),
        F.col("c_text").alias("chunk_to_retrieve"),
        "approved_flag",
        "audience",
        "ingested_at",
    )
