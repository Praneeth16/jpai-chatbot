import csv
import json
import os
import sys
from datetime import date

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import section_builder as sb  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "jd0300_elements.json")
REF = os.path.join(os.path.dirname(__file__), "..", "..", "..", "data", "reference")


def _csv(name):
    with open(os.path.join(REF, name), encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


STUDIES = [dict(r, product_codes=r["product_codes"].split("|")) for r in _csv("studies.csv")]
SYNONYMS = _csv("synonyms.csv")
PRODUCTS = [
    {"product_code": "IMFINZI", "brand_ja": "イミフィンジ", "generic_ja": "デュルバルマブ", "brand_en": "Imfinzi", "generic_en": "durvalumab"},
    {"product_code": "IMJUDO", "brand_ja": "イジュド", "generic_ja": "トレメリムマブ", "brand_en": "Imjudo", "generic_en": "tremelimumab"},
]


@pytest.fixture(scope="module")
def doc():
    with open(FIXTURE, encoding="utf-8") as f:
        elements = json.load(f)
    return sb.build_document(elements, "JD0300_IF", PRODUCTS, STUDIES, SYNONYMS)


@pytest.fixture(scope="module")
def by_path(doc):
    return {s["section_path"]: s for s in doc["sections"]}


def el(type_, content, page=0):
    return {"type": type_, "content": content, "page_id": page}


def test_metadata(doc):
    assert doc["product_code"] == "IMJUDO"
    assert doc["doc_rev"] == "2024年11月改訂（第3版）"
    assert doc["revision_date"] == date(2024, 11, 1)


def test_all_thirteen_chapters_in_order(doc):
    l1 = [s["section_path"] for s in doc["sections"] if s["level"] == 1]
    assert l1 == ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ", "Ⅷ", "Ⅸ", "Ⅹ", "ⅩⅠ", "ⅩⅡ", "ⅩⅢ"]


def test_front_matter(by_path):
    front = by_path["FRONT"]
    assert front["level"] == 0 and front["parent_section_id"] is None
    assert front["pages"][0] == 1  # 1-based
    assert "医薬品インタビューフォーム" in front["markdown"]
    assert front["section_id"] == "JD0300_IF::FRONT"


def test_header_line(by_path):
    assert by_path["Ⅴ.3"]["header_line"] == "イジュド（トレメリムマブ） インタビューフォーム 2024年11月改訂（第3版） Ⅴ.3 用法及び用量"


def test_dosage_section(by_path):
    s = by_path["Ⅴ.3"]
    assert s["title"] == "用法及び用量"
    assert s["level"] == 2 and s["parent_section_id"] == "JD0300_IF::Ⅴ"
    assert s["pages"] == [22]  # verified against the PDF: heading on PDF page 22
    assert "300mg" in s["markdown"]
    assert s["approved_flag"] is True
    assert s["section_id"] == "JD0300_IF::Ⅴ.3"


def test_parent_markdown_contains_children(by_path):
    parent, child = by_path["Ⅴ.3"], by_path["Ⅴ.3.(1)"]
    assert child["markdown"] in parent["markdown"]
    assert len(parent["markdown"]) > len(child["markdown"])
    assert by_path["Ⅴ"]["markdown"].count("# 3. 用法及び用量") == 1
    assert parent["own_markdown"] != parent["markdown"]


def test_quoted_package_insert_numbering_is_body_not_heading(by_path):
    # Ⅴ.4 quotes "7. 用法及び用量に関連する注意" and "7.1 ..." from the package insert
    assert not [p for p in by_path if p.startswith("Ⅴ.4.")]
    assert "Ⅴ.7" not in by_path
    assert "7. 用法及び用量に関連する注意" in by_path["Ⅴ.4"]["markdown"]
    assert "7.1 " in by_path["Ⅴ.4"]["markdown"]
    # Ⅷ.8 quotes "11.1.2 ..." etc; Ⅷ.5 quotes "8. 重要な基本的注意"
    assert not [p for p in by_path if p.startswith("Ⅷ.8.") and p.count(".") > 2 and ")" not in p]
    assert "Ⅷ.11" in by_path and by_path["Ⅷ.11"]["title"] == "適用上の注意"
    assert "Ⅷ.5.(1)" not in by_path


def test_sub_headings_stay_in_section(by_path):
    md = by_path["Ⅴ.1"]["markdown"]
    assert "＜解説＞" in md and "〈切除不能な肝細胞癌〉" in md
    assert not [p for p in by_path if p.startswith("Ⅴ.1.")]


def test_headings_glued_into_text_elements_are_found(by_path):
    # "（1）臨床データパッケージ\n〈...〉" and "（2）腎機能障害患者 ... （3）... （4）..." come inside text elements
    assert by_path["Ⅴ.5.(1)"]["title"] == "臨床データパッケージ"
    for p in ("Ⅷ.6.(2)", "Ⅷ.6.(3)", "Ⅷ.6.(4)", "Ⅷ.6.(5)"):
        assert p in by_path
    assert by_path["Ⅷ.6.(3)"]["title"] == "肝機能障害患者"


def test_deep_levels(by_path):
    s = by_path["Ⅴ.5.(4).1)"]
    assert s["level"] == 4 and s["title"] == "有効性検証試験"
    assert s["parent_section_id"] == "JD0300_IF::Ⅴ.5.(4)"
    assert s["pages"][0] == 40
    assert "POSEIDON" in s["markdown"] and "HIMALAYA" in s["markdown"]


def test_approved_flag(by_path):
    for p, s in by_path.items():
        unapproved = p.startswith(("Ⅴ.5", "ⅩⅡ", "ⅩⅢ"))
        assert s["approved_flag"] is (not unapproved), p
    assert by_path["Ⅴ"]["approved_flag"] is True  # the chapter itself is mixed; its leaves decide
    assert by_path["Ⅵ.2"]["approved_flag"] is True


def test_no_duplicate_paths_and_ids(doc):
    ids = [s["section_id"] for s in doc["sections"]]
    assert len(ids) == len(set(ids))
    parents = {s["section_id"] for s in doc["sections"]}
    assert all(s["parent_section_id"] in parents for s in doc["sections"] if s["parent_section_id"])


def test_page_furniture_removed(by_path):
    # page_number elements are bare numbers such as "16"; none may appear as a whole block
    for s in by_path.values():
        assert "\n\n16\n\n" not in s["markdown"]


def test_pages_cover_leaf_pages(by_path):
    for s in by_path.values():
        assert s["pages"] == sorted(set(s["pages"]))
        assert all(p >= 1 for p in s["pages"])


def test_char_len(by_path):
    for s in by_path.values():
        assert s["char_len"] == len(s["markdown"])


# ---- synthetic rules -------------------------------------------------------------------------------------------

def test_sequence_rules_l2_l3():
    els = [
        el("section_header", "Ⅰ. 概要"),
        el("section_header", "1. 一"),
        el("text", "body"),
        el("section_header", "3. 三 (skips 2)"),  # rejected
        el("section_header", "2. 二"),
        el("section_header", "（2）skip"),  # no (1) yet -> body
        el("section_header", "（1）子"),
        el("section_header", "（2）孫"),
        el("section_header", "1）四"),
        el("section_header", "9.4 生殖"),  # digit after the dot -> body
    ]
    paths = [s["section_path"] for s in sb.build_sections(els, "D")]
    assert paths == ["FRONT", "Ⅰ", "Ⅰ.1", "Ⅰ.2", "Ⅰ.2.(1)", "Ⅰ.2.(2)", "Ⅰ.2.(2).1)"]


def test_fullwidth_numbers_and_new_l1_resets():
    els = [
        el("section_header", "Ⅰ. a"),
        el("section_header", "１. 一"),
        el("section_header", "２. 二"),
        el("section_header", "Ⅱ. b"),
        el("section_header", "2. still rejected after new chapter"),
        el("section_header", "１. 新一"),
    ]
    paths = [s["section_path"] for s in sb.build_sections(els, "D")]
    assert paths == ["FRONT", "Ⅰ", "Ⅰ.1", "Ⅰ.2", "Ⅱ", "Ⅱ.1"]


def test_front_matter_numbers_are_not_sections():
    els = [el("section_header", "１. 医薬品インタビューフォーム作成の経緯"), el("text", "x"), el("section_header", "Ⅰ. 概要")]
    assert [s["section_path"] for s in sb.build_sections(els, "D")] == ["FRONT", "Ⅰ"]


def test_split_text_element_at_paragraph_headings():
    els = [
        el("section_header", "Ⅰ. 安全性"),
        el("section_header", "1. 特定の背景"),
        el("section_header", "（1）合併症"),
        el("text", "（2）腎\n設定されていない\n\n（3）肝\n設定されていない\n\n本文の続き（4）ではない"),
    ]
    secs = {s["section_path"]: s for s in sb.build_sections(els, "D")}
    assert list(secs) == ["FRONT", "Ⅰ", "Ⅰ.1", "Ⅰ.1.(1)", "Ⅰ.1.(2)", "Ⅰ.1.(3)"]
    assert "設定されていない" in secs["Ⅰ.1.(2)"]["markdown"]
    assert "本文の続き" in secs["Ⅰ.1.(3)"]["markdown"]


def test_sentence_lines_do_not_become_headings_when_not_in_sequence():
    els = [el("section_header", "Ⅰ. a"), el("section_header", "1. b"), el("text", "（3）文章です。\n続き")]
    assert [s["section_path"] for s in sb.build_sections(els, "D")] == ["FRONT", "Ⅰ", "Ⅰ.1"]


def test_doc_metadata_variants():
    els = [el("page_header", "2026年9月改訂（第17版）"), el("text", "イミフィンジ®点滴静注 120mg")]
    m = sb.doc_metadata(els, PRODUCTS)
    assert m == {
        "product_code": "IMFINZI",
        "product_name": "イミフィンジ（デュルバルマブ）",
        "doc_rev": "2026年9月改訂（第17版）",
        "revision_date": date(2026, 9, 1),
    }
    none = sb.doc_metadata([el("text", "unknown")], PRODUCTS)
    assert none["product_code"] is None and none["doc_rev"] is None and none["revision_date"] is None


# ---- pseudo-sections (CONTRACTS section 8) ----------------------------------------------------------------------

def pad(n, tag="table"):
    """An atomic block of about n characters."""
    return f"<{tag}><tr><td>" + "表" * (n - 2 * len(tag) - 15) + f"</td></tr></{tag}>"


def big(*elements):
    return [el("section_header", "Ⅰ. 概要"), el("section_header", "1. 大きい節"), *elements]


def pseudo_tree(elements, **kw):
    secs = sb.build_sections(elements, "D", **kw)
    return secs, {s["section_path"]: s for s in secs}


def children_of(secs, s):
    return [c for c in secs if c["parent_section_id"] == s["section_id"]]


def test_fixture_counts_and_largest_section(doc):
    real = [s for s in doc["sections"] if not s["is_pseudo"]]
    assert len(real) == 209  # unchanged by the splitter
    assert len(doc["sections"]) == 231 and sum(s["is_pseudo"] for s in doc["sections"]) == 22
    assert max(s["own_body_len"] for s in doc["sections"] if s["section_path"] != "FRONT") <= sb.SPLIT_CHARS


def test_invariant_parent_markdown_is_intro_plus_children_in_order(doc):
    secs = doc["sections"]
    split = [s for s in secs if any(c["is_pseudo"] for c in children_of(secs, s))]
    assert {s["section_path"] for s in split} >= {"Ⅴ.5.(1)", "Ⅴ.5.(3)", "Ⅴ.5.(4).1)", "Ⅷ.8.(2)"}
    for s in split:
        kids = children_of(secs, s)
        assert s["markdown"] == "\n\n".join(x for x in [s["own_markdown"]] + [k["markdown"] for k in kids] if x), s["section_path"]
        assert kids[0]["is_pseudo"]  # pseudo children come first, real children (later in the text) after them


def test_splitting_never_changes_the_text_of_real_sections(doc):
    with open(FIXTURE, encoding="utf-8") as f:
        elements = json.load(f)
    old = sb.SPLIT_CHARS
    sb.SPLIT_CHARS = 10**9
    try:
        unsplit = {s["section_path"]: s["markdown"] for s in sb.build_document(elements, "JD0300_IF", PRODUCTS)["sections"]}
    finally:
        sb.SPLIT_CHARS = old
    for s in doc["sections"]:
        if not s["is_pseudo"]:
            assert s["markdown"] == unsplit[s["section_path"]], s["section_path"]


def test_no_section_exceeds_split_chars_in_fixture(doc):
    for s in doc["sections"]:
        if s["section_path"] != "FRONT":
            assert s["own_body_len"] <= sb.SPLIT_CHARS, (s["section_path"], s["own_body_len"])


def test_pseudo_section_attributes(doc):
    by = {s["section_path"]: s for s in doc["sections"]}
    kid = by["Ⅴ.5.(4).1)#1"]
    assert kid["is_pseudo"] and kid["level"] == 5 and kid["parent_section_id"] == "JD0300_IF::Ⅴ.5.(4).1)"
    assert kid["section_id"] == "JD0300_IF::Ⅴ.5.(4).1)#1" and kid["title"] == "〈切除不能な進行・再発の非小細胞肺癌〉"
    assert kid["approved_flag"] is False  # rule of the parent path (Ⅴ.5)
    assert set(kid["pages"]) <= set(by["Ⅴ.5.(4).1)"]["pages"]) and kid["pages"][0] == 40
    nested = by["Ⅴ.5.(4).1)#1#2"]
    assert nested["level"] == 6 and nested["parent_section_id"].endswith("#1") and nested["title"].startswith("【安全性】")
    # the pseudo-section text starts with the original sub-heading block, unchanged
    assert by["Ⅴ.5.(4).1)#2"]["markdown"].startswith("##### 〈切除不能な肝細胞癌〉")
    assert by["Ⅷ.8.(2)#1#2"]["approved_flag"] is True  # Ⅷ is approved
    assert by["Ⅴ.5.(4).1)"]["own_body_len"] == 0  # the parent keeps only its heading; chunks come from the children


def test_v5_5_4_1_has_himalaya_and_poseidon_pseudo_sections(doc):
    kids = [s for s in doc["sections"] if s["parent_section_id"] == "JD0300_IF::Ⅴ.5.(4).1)"]
    assert [k["study_ids"] for k in kids] == [["POSEIDON"], ["HIMALAYA"]]
    poseidon, himalaya = kids
    assert "POSEIDON" in poseidon["markdown"] and "HIMALAYA" not in poseidon["markdown"].split("〈切除不能な肝細胞癌〉")[0]
    assert "HIMALAYA" in himalaya["markdown"] and "POSEIDON" not in himalaya["title"]
    # inherited down to deeper pseudo-sections
    deeper = [s for s in doc["sections"] if s["section_path"].startswith("Ⅴ.5.(4).1)#1#")]
    assert deeper and all(s["study_ids"] == ["POSEIDON"] for s in deeper)
    assert all(s["study_ids"] == ["HIMALAYA"] for s in doc["sections"] if s["section_path"].startswith("Ⅴ.5.(4).1)#2#"))


def test_explicit_study_code_beats_indication_heading(doc):
    by = {s["section_path"]: s for s in doc["sections"]}
    assert by["Ⅴ.5.(3)#1"]["study_ids"] == ["D4190C00006"]  # 〈NSCLC〉 + "(D4190C00006試験)", not POSEIDON
    assert by["Ⅴ.5.(3)#3"]["study_ids"] == ["D4190C00022"]  # 〈HCC〉 + "(D4190C00022試験)", not HIMALAYA


def test_split_rank_order_angle_before_bracket_and_explanation_stays():
    body = [
        el("text", "導入文。"),
        el("section_header", "〈切除不能な肝細胞癌〉"),
        el("section_header", "【有効性】"),
        el("table", pad(2500)),
        el("section_header", "＜解説＞"),
        el("text", "解説本文。"),
        el("section_header", "〈切除不能な進行・再発の非小細胞肺癌〉"),
        el("section_header", "【有効性】"),
        el("table", pad(2500)),
        el("table", pad(2500)),
    ]
    secs, by = pseudo_tree(big(*body))
    sec = by["Ⅰ.1"]
    kids = children_of(secs, sec)
    assert [k["section_path"] for k in kids] == ["Ⅰ.1#1", "Ⅰ.1#2"]
    assert [k["title"] for k in kids] == ["〈切除不能な肝細胞癌〉", "〈切除不能な進行・再発の非小細胞肺癌〉"]
    assert sec["own_markdown"].endswith("導入文。") and "〈" not in sec["own_markdown"]
    assert "＜解説＞" in kids[0]["markdown"] and "解説本文。" in kids[0]["markdown"]  # stays with the preceding item
    assert all(k["is_pseudo"] and k["level"] == sec["level"] + 1 for k in kids)
    assert sec["markdown"] == "\n\n".join([sec["own_markdown"]] + [k["markdown"] for k in kids])


def test_recursion_uses_next_rank_only_while_a_part_is_too_long():
    body = [
        el("section_header", "〈大きな項目〉"),
        el("section_header", "【前半】"),
        el("table", pad(3000)),
        el("table", pad(2500)),
        el("section_header", "【後半】"),
        el("table", pad(3000)),
        el("section_header", "〈小さな項目〉"),
        el("table", pad(500)),
        el("section_header", "【小さい】"),
        el("table", pad(500)),
    ]
    secs, by = pseudo_tree(big(*body))
    assert sorted(p for p in by if "#" in p) == ["Ⅰ.1#1", "Ⅰ.1#1#1", "Ⅰ.1#1#2", "Ⅰ.1#2"]
    assert by["Ⅰ.1#1#1"]["title"] == "【前半】" and by["Ⅰ.1#1#2"]["title"] == "【後半】"
    assert "#" not in "".join(p for p in by if p.startswith("Ⅰ.1#2") and p != "Ⅰ.1#2")  # small part not split further
    assert by["Ⅰ.1#1#1"]["level"] == by["Ⅰ.1"]["level"] + 2


def test_text_block_starting_with_short_angle_line_is_a_split_point():
    body = [
        el("text", "〈切除不能な肝細胞癌〉\n国際共同第Ⅲ相試験（HIMALAYA試験）"),
        el("table", pad(3500)),
        el("text", "〈切除不能な進行・再発の非小細胞肺癌〉\n国際共同第Ⅲ相試験（POSEIDON試験）"),
        el("table", pad(3500)),
    ]
    secs, by = pseudo_tree(big(*body), product_code="IMJUDO", studies=STUDIES, synonyms=SYNONYMS)
    kids = children_of(secs, by["Ⅰ.1"])
    assert [k["study_ids"] for k in kids] == [["HIMALAYA"], ["POSEIDON"]]
    assert by["Ⅰ.1"]["own_body_len"] == 0


def test_package_insert_numbering_and_trial_result_lines_split():
    body = [el("text", "導入。")] + [
        x for n in (1, 2) for x in (el("section_header", f"11.{n} その他"), el("table", pad(3500)))
    ]
    secs, by = pseudo_tree(big(*body))
    assert [k["title"] for k in children_of(secs, by["Ⅰ.1"])] == ["11.1 その他", "11.2 その他"]
    body = [
        x for n in ("A", "B") for x in (el("section_header", f"{n}試験における副作用一覧"), el("table", pad(3500)))
    ]
    secs, by = pseudo_tree(big(*body))
    assert [k["title"] for k in children_of(secs, by["Ⅰ.1"])] == ["A試験における副作用一覧", "B試験における副作用一覧"]


def test_tables_are_atomic_and_blocks_are_packed_as_last_resort():
    secs, by = pseudo_tree(big(el("table", pad(9000))))
    assert not [p for p in by if "#" in p]  # a single huge table is never cut
    assert by["Ⅰ.1"]["own_body_len"] > sb.SPLIT_CHARS
    secs, by = pseudo_tree(big(*[el("table", pad(2500)) for _ in range(8)]))
    kids = [s for s in secs if s["is_pseudo"]]
    assert len(kids) >= 2 and all(k["own_body_len"] <= sb.SPLIT_CHARS for k in kids + [by["Ⅰ.1"]])
    sec = by["Ⅰ.1"]
    assert sec["markdown"] == "\n\n".join([sec["own_markdown"]] + [k["markdown"] for k in children_of(secs, sec)])


def test_heading_block_is_not_stranded_at_the_end_of_a_pack():
    els = [el("table", pad(2500)), el("table", pad(2500)), el("section_header", "小見出し"), el("table", pad(2500))]
    secs, by = pseudo_tree(big(*els))
    kids = children_of(secs, by["Ⅰ.1"])
    assert kids and kids[0]["markdown"].startswith("#")  # the heading moved to the next part
    assert not by["Ⅰ.1"]["own_markdown"].rstrip().endswith("小見出し")


def test_pseudo_children_inherit_the_parent_unapproved_rule_and_pages():
    els = [el("section_header", f"{c}. 章") for c in "ⅠⅡⅢⅣ"] + [
        el("section_header", "Ⅴ. 治療に関する項目"),
        *[el("section_header", f"{n}. 節") for n in (1, 2, 3, 4)],
        el("section_header", "5. 臨床成績"),
        el("section_header", "〈A〉", 3),
        el("table", pad(4000), 3),
        el("section_header", "〈B〉", 4),
        el("table", pad(4000), 4),
    ]
    secs, by = pseudo_tree(els)
    assert by["Ⅴ.5#1"]["approved_flag"] is False and by["Ⅴ.5#1"]["pages"] == [4]
    assert by["Ⅴ.5#2"]["pages"] == [5]


def test_roman_labels_are_nfkc_normalised_before_the_approved_rule():
    labels = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ", "Ⅷ", "Ⅸ", "Ⅹ", "Ⅺ", "Ⅻ", "ⅩⅢ"]  # the parser may emit single glyphs
    els = []
    for l in labels:
        els += [el("section_header", f"{l}. 章"), el("section_header", "1. 節"), el("text", "本文")]
    secs = sb.build_sections(els, "D")
    paths = [s["section_path"] for s in secs if s["level"] == 1]
    assert paths == ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ", "Ⅷ", "Ⅸ", "Ⅹ", "ⅩⅠ", "ⅩⅡ", "ⅩⅢ"]
    appr = {s["section_path"]: s["approved_flag"] for s in secs}
    assert appr["ⅩⅠ"] is True and appr["ⅩⅠ.1"] is True
    assert appr["ⅩⅡ"] is False and appr["ⅩⅡ.1"] is False and appr["ⅩⅢ.1"] is False


def test_is_approved_accepts_any_spelling_of_the_unapproved_chapters():
    for p in ("Ⅻ", "Ⅻ.2", "ⅩⅡ", "ⅩⅡ.2.(1)", "ⅩⅢ.1", "Ⅴ.5", "Ⅴ.5.(4).1)", "Ⅴ.5.(4).1)#2#1", "ⅩⅡ.1#1"):
        assert sb.is_approved(p) is False, p
    for p in ("ⅩⅠ", "ⅩⅠ.1", "Ⅴ.4", "Ⅴ.50", "Ⅴ", "FRONT", "Ⅷ.8.(2)#1"):
        assert sb.is_approved(p) is True, p


def test_study_index_indication_rule():
    idx = sb.StudyIndex(STUDIES, SYNONYMS)
    assert idx.detect("〈切除不能な肝細胞癌〉", "IMJUDO") == ["HIMALAYA"]
    assert idx.detect("〈切除不能な進行・再発の非小細胞肺癌〉", "IMJUDO") == ["POSEIDON"]
    assert idx.detect("非小細胞肺癌", "IMJUDO") == ["POSEIDON"]  # PACIFIC and AEGEAN are IMFINZI-only studies
    assert idx.detect("非小細胞肺癌", "IMFINZI") == []  # three IMFINZI studies: ambiguous, so no study
    assert idx.detect("進展型小細胞肺癌", "IMFINZI") == ["CASPIAN"]
    assert idx.detect("ヒマラヤ試験", "IMJUDO") == ["HIMALAYA"] and idx.detect("D419MC00004", None) == ["POSEIDON"]
    assert idx.detect("CHIMALAYAN", None) == []  # ASCII names match whole words only
    assert idx.detect("", "IMJUDO") == []


def test_study_ids_inherit_from_real_parent_headings():
    els = [el("section_header", "Ⅰ. x"), el("section_header", "1. HIMALAYA試験の概要"), el("section_header", "（1）背景"), el("text", "t")]
    secs = {s["section_path"]: s for s in sb.build_sections(els, "D", "IMJUDO", None, STUDIES, SYNONYMS)}
    assert secs["Ⅰ.1"]["study_ids"] == ["HIMALAYA"] and secs["Ⅰ.1.(1)"]["study_ids"] == ["HIMALAYA"]
    assert secs["Ⅰ"]["study_ids"] == [] and secs["FRONT"]["study_ids"] == []
