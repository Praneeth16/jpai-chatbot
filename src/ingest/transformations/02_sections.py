"""Section builder: parsed_docs -> sections_stg (one row per section, every level).

The pure logic lives in ../section_builder.py (unit-tested). This file only wires it into the pipeline:
elements are reduced to JSON in SQL, a Python UDF builds the sections, and the result is exploded.
"""
import sys

from pyspark import cloudpickle
from pyspark import pipelines as dp
from pyspark.sql import functions as F
from pyspark.sql import types as T

# `__file__` is not defined in pipeline source files, so the folder with section_builder.py comes from the configuration
sys.path.insert(0, spark.conf.get("ingest_src_dir"))
import section_builder  # noqa: E402

# the module is not installed on the UDF workers: ship it inside the pickled function
cloudpickle.register_pickle_by_value(section_builder)

SECTION_TYPE = T.StructType(
    [
        T.StructField("section_id", T.StringType()),
        T.StructField("section_path", T.StringType()),
        T.StructField("level", T.IntegerType()),
        T.StructField("title", T.StringType()),
        T.StructField("parent_section_id", T.StringType()),
        T.StructField("markdown", T.StringType()),
        T.StructField("own_markdown", T.StringType()),
        T.StructField("own_body_len", T.IntegerType()),
        T.StructField("header_line", T.StringType()),
        T.StructField("pages", T.ArrayType(T.IntegerType())),
        T.StructField("approved_flag", T.BooleanType()),
        T.StructField("audience", T.StringType()),
        T.StructField("qa_status", T.StringType()),
        T.StructField("char_len", T.IntegerType()),
        T.StructField("is_pseudo", T.BooleanType()),
        T.StructField("study_ids", T.ArrayType(T.StringType())),
    ]
)
DOC_TYPE = T.StructType(
    [
        T.StructField("product_code", T.StringType()),
        T.StructField("doc_rev", T.StringType()),
        T.StructField("revision_date", T.DateType()),
        T.StructField("sections", T.ArrayType(SECTION_TYPE)),
    ]
)


def _build(doc_id, elements_json, products_json, studies_json, synonyms_json):
    import json

    doc = section_builder.build_document(
        json.loads(elements_json), doc_id, json.loads(products_json), json.loads(studies_json), json.loads(synonyms_json)
    )
    return {
        "product_code": doc["product_code"],
        "doc_rev": doc["doc_rev"],
        "revision_date": doc["revision_date"],
        "sections": [{k: s.get(k) for k in [f.name for f in SECTION_TYPE.fields]} for s in doc["sections"]],
    }


build_doc = F.udf(_build, DOC_TYPE)

ELEMENTS_JSON = """to_json(transform(cast(parsed:document:elements AS array<variant>),
    e -> named_struct('id', cast(e:id AS int), 'type', cast(e:type AS string),
                      'content', cast(e:content AS string), 'page_id', cast(e:bbox[0].page_id AS int))))"""


@dp.table(
    name="sections_stg",
    comment=(
        "Sections of every level, pseudo-sections included (parent markdown includes its children); "
        "own_markdown is the text before the first child"
    ),
    table_properties={"delta.enableChangeDataFeed": "true"},
)
def sections_stg():
    # master data: cover-page product match and the study ids named in headings; static side of a stream-static join
    products = spark.read.table("products").agg(
        F.to_json(
            F.collect_list(F.struct("product_code", "brand_ja", "brand_en", "generic_ja", "generic_en"))
        ).alias("products_json")
    )
    studies = spark.read.table("studies").agg(
        F.to_json(F.collect_list(F.struct("study_id", "study_code", "product_codes"))).alias("studies_json")
    )
    synonyms = (
        spark.read.table("synonyms")
        .where("kind IN ('study', 'indication')")
        .agg(F.to_json(F.collect_list(F.struct("term", "kind", "target_id"))).alias("synonyms_json"))
    )
    parsed = (
        spark.readStream.table("parsed_docs")
        .where("cast(parsed:error_status AS string) IS NULL")  # a JSON null is not a SQL NULL
        .withColumn("elements_json", F.expr(ELEMENTS_JSON))
        .crossJoin(products)
        .crossJoin(studies)
        .crossJoin(synonyms)
        .withColumn("doc", build_doc("doc_id", "elements_json", "products_json", "studies_json", "synonyms_json"))
    )
    return parsed.select(
        "doc_id",
        "file_path",
        "sha256",
        F.col("doc.product_code").alias("product_code"),
        F.col("doc.doc_rev").alias("doc_rev"),
        F.col("doc.revision_date").alias("revision_date"),
        F.col("parsed_at").alias("ingested_at"),
        F.explode("doc.sections").alias("s"),
    ).select("doc_id", "file_path", "sha256", "product_code", "doc_rev", "revision_date", "ingested_at", "s.*")
