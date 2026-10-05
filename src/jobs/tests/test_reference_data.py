"""Consistency of data/reference/*.csv (what seed_reference.py loads)."""
import csv
import os
import re
import sys
import unicodedata

HERE = os.path.dirname(__file__)
REF = os.path.abspath(os.path.join(HERE, "..", "..", "..", "data", "reference"))
ROUTES = ["0a", "0b", "0c_greeting", "0c_closing", "0c_about", "1", "2", "3.1", "3.2", "4.1", "4.2", "5.1", "5.2", "6.1", "6.2", "7.1", "8.1", "8.2"]


def rows(name):
    with open(os.path.join(REF, name), encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def test_templates_cover_every_route_and_language():
    have = {(r["route_id"], r["lang"]) for r in rows("templates.csv")}
    assert {(r, l) for r in ROUTES for l in ("ja", "en")} <= have
    assert {r["route_id"] for r in rows("templates.csv")} <= set(ROUTES)


def test_templates_unique_keys_final_text_and_status():
    keys = [(r["template_id"], r["route_id"], r["lang"], r["version"]) for r in rows("templates.csv")]
    assert len(keys) == len(set(keys))
    for r in rows("templates.csv"):
        assert r["status"] == "PLACEHOLDER"
        assert r["text"].strip() and not re.search(r"\{[^}]*\}|<[^>]+>|\[[A-Z_]+\]", r["text"]), r["text"]  # nothing to substitute


def test_ae_route_has_reporting_contacts():
    for r in rows("templates.csv"):
        if r["route_id"] == "1":
            assert "0120-189-115" in r["text"] and "https://med.astrazeneca.co.jp/" in r["text"]


def test_template_ids_match_the_app():
    ids = {r["template_id"] for r in rows("templates.csv")}
    assert {"T_4X_HEADER", "T_5_1_HEADER", "T_0C_ABOUT", "T_1", "T_8_2"} <= ids


def test_studies_point_to_known_products_and_codes_are_unique():
    products = {r["product_code"] for r in rows("products.csv")}
    studies = rows("studies.csv")
    assert len({s["study_id"] for s in studies}) == len(studies)
    assert len({s["study_code"] for s in studies}) == len(studies)
    for s in studies:
        codes = s["product_codes"].split("|")
        assert codes and set(codes) <= products, s


def test_synonyms_reference_existing_targets_and_are_normalised():
    products = {r["product_code"] for r in rows("products.csv")}
    studies = {r["study_id"] for r in rows("studies.csv")}
    ids = set()
    for r in rows("synonyms.csv"):
        assert r["synonym_id"] not in ids
        ids.add(r["synonym_id"])
        assert r["term"] == unicodedata.normalize("NFKC", r["term"]).lower()
        assert r["kind"] in ("product", "study", "indication")
        assert r["target_id"] in (products if r["kind"] == "product" else studies)
        assert r["lang"] in ("ja", "en")


def test_every_product_and_study_has_a_synonym():
    syn = rows("synonyms.csv")
    for p in rows("products.csv"):
        assert any(s["kind"] == "product" and s["target_id"] == p["product_code"] for s in syn)
        for term in (p["brand_ja"], p["brand_en"], p["generic_ja"], p["generic_en"]):
            assert any(s["kind"] == "product" and s["term"] == unicodedata.normalize("NFKC", term).lower() for s in syn), term
    for st in rows("studies.csv"):
        assert any(s["kind"] == "study" and s["target_id"] == st["study_id"] for s in syn)
        assert any(s["kind"] == "study" and s["term"] == st["study_code"].lower() for s in syn) or st["study_id"] == st["study_code"]


def test_indication_rows_exist_for_each_imjudo_indication():
    ind = {(s["term"], s["target_id"]) for s in rows("synonyms.csv") if s["kind"] == "indication"}
    assert ("肝細胞癌", "HIMALAYA") in ind and ("hcc", "HIMALAYA") in ind
    assert ("非小細胞肺癌", "POSEIDON") in ind and ("nsclc", "POSEIDON") in ind
