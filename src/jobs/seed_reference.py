"""Load data/reference/*.csv into Delta tables (master data for routing and the response templates).

products / studies / synonyms are replaced from the CSV (git is the source of truth).
templates are merged: new (template_id, route_id, lang, version) rows are inserted and PLACEHOLDER rows are refreshed,
but rows marked APPROVED are never overwritten, so wording approved by Medical / Legal is not lost on redeploy.
All tables have Change Data Feed on because the Lakebase synced tables use TRIGGERED mode.
"""
import argparse
import csv
import os

from pyspark.sql import SparkSession
from pyspark.sql import types as T

S = T.StringType()


def read_csv(path):
    with open(path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", required=True)
    ap.add_argument("--schema", required=True)
    ap.add_argument("--ref-dir", required=True, help="folder with the reference CSV files")
    a = ap.parse_args()
    spark = SparkSession.builder.getOrCreate()
    fq = lambda t: f"`{a.catalog}`.`{a.schema}`.`{t}`"  # noqa: E731
    p = lambda f: os.path.join(a.ref_dir, f)  # noqa: E731

    def replace(table, rows, schema):
        df = spark.createDataFrame(rows, schema)
        df.write.mode("overwrite").option("overwriteSchema", "true").option("delta.enableChangeDataFeed", "true").saveAsTable(fq(table))
        spark.sql(f"ALTER TABLE {fq(table)} SET TBLPROPERTIES (delta.enableChangeDataFeed = true)")
        print(f"{table}: {len(rows)} rows")

    products = read_csv(p("products.csv"))
    replace(
        "products",
        [tuple(r[c] for c in ["product_code", "brand_ja", "brand_en", "generic_ja", "generic_en", "indications_ja", "patient_materials_url", "product_info_url"]) for r in products],
        T.StructType([T.StructField(c, S) for c in ["product_code", "brand_ja", "brand_en", "generic_ja", "generic_en", "indications_ja", "patient_materials_url", "product_info_url"]]),
    )

    studies = read_csv(p("studies.csv"))
    replace(
        "studies",
        [(r["study_id"], r["study_code"], [x for x in r["product_codes"].split("|") if x], r["indication_ja"], r["phase"]) for r in studies],
        T.StructType(
            [
                T.StructField("study_id", S),
                T.StructField("study_code", S),
                T.StructField("product_codes", T.ArrayType(S)),
                T.StructField("indication_ja", S),
                T.StructField("phase", S),
            ]
        ),
    )

    syn_cols = ["synonym_id", "term", "kind", "target_id", "lang"]
    replace("synonyms", [tuple(r[c] for c in syn_cols) for r in read_csv(p("synonyms.csv"))], T.StructType([T.StructField(c, S) for c in syn_cols]))

    tpl = read_csv(p("templates.csv"))
    tpl_schema = T.StructType(
        [T.StructField(c, S) for c in ["template_key", "template_id", "route_id", "lang", "text"]]
        + [T.StructField("version", T.IntegerType()), T.StructField("status", S)]
    )
    rows = [
        (f'{r["template_id"]}:{r["route_id"]}:{r["lang"]}:{r["version"]}', r["template_id"], r["route_id"], r["lang"], r["text"], int(r["version"]), r["status"])
        for r in tpl
    ]
    spark.createDataFrame(rows, tpl_schema).createOrReplaceTempView("templates_src")
    spark.sql(
        f"""CREATE TABLE IF NOT EXISTS {fq('templates')} (template_key STRING, template_id STRING, route_id STRING, lang STRING,
            text STRING, version INT, status STRING) TBLPROPERTIES (delta.enableChangeDataFeed = true)"""
    )
    spark.sql(
        f"""MERGE INTO {fq('templates')} t USING templates_src s ON t.template_key = s.template_key
            WHEN MATCHED AND t.status = 'PLACEHOLDER' AND (t.text <> s.text OR t.status <> s.status) THEN
              UPDATE SET t.template_id = s.template_id, t.route_id = s.route_id, t.lang = s.lang, t.text = s.text, t.version = s.version, t.status = s.status
            WHEN NOT MATCHED THEN INSERT *"""
    )
    print(f"templates: {len(rows)} rows in file")


if __name__ == "__main__":
    main()
