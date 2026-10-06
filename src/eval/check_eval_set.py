"""Sanity-check eval_set.jsonl: schema, route ids, and that every expected section path is a real IF heading.

Usage: python3 check_eval_set.py [--text /tmp/jd0300.txt] [--pdf data/docs/JD0300_IF.pdf]
If --text does not exist the text is produced with `pdftotext -layout` from --pdf.
"""
import argparse
import csv
import json
import re
import subprocess
import sys
from pathlib import Path

PRODUCTS = {r["product_code"] for r in csv.DictReader(open(Path(__file__).resolve().parents[2] / "data" / "reference" / "products.csv", encoding="utf-8"))}
ROUTES = {"0a", "0b", "0c_greeting", "0c_closing", "0c_about", "1", "2", "3.1", "3.2", "4.1", "4.2",
          "5.1", "5.2", "6.1", "6.2", "7.1", "8.1", "8.2"}
SEARCH_ROUTES = {"4.1", "4.2", "5.1"}
ROMAN = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ", "Ⅷ", "Ⅸ", "Ⅹ", "ⅩⅠ", "ⅩⅡ", "ⅩⅢ"]
PATH_RE = re.compile(r"^(" + "|".join(ROMAN[::-1]) + r")\.(\d+)(?:\.\((\d+)\)(?:\.(\d+)\))?)?$")
HERE = Path(__file__).resolve().parent


def load_lines(text_path, pdf_path):
    p = Path(text_path)
    if not p.exists():
        subprocess.run(["pdftotext", "-layout", str(pdf_path), str(p)], check=True)
    return p.read_text(encoding="utf-8").splitlines()


def find(lines, pattern, start, end):
    rx = re.compile(pattern)
    for i in range(start, end):
        if "....." not in lines[i] and rx.match(lines[i]):
            return i
    return None


def heading_exists(lines, path):
    m = PATH_RE.match(path)
    if not m:
        return False
    roman, num, sub, subsub = m.group(1), int(m.group(2)), m.group(3), m.group(4)
    # chapter headings, in document order (TOC lines carry dot leaders and are skipped)
    starts, pos = [], 0
    for r in ROMAN:
        i = find(lines, rf"^\s*{r}\.\s", pos, len(lines))
        if i is None:
            return False
        starts.append(i)
        pos = i + 1
    ci = ROMAN.index(roman)
    c_start = starts[ci]
    c_end = starts[ci + 1] if ci + 1 < len(starts) else len(lines)
    # numbered sections must appear in sequence (quoted package-insert numbers inside sections are skipped this way)
    pos, n_line, nxt_line = c_start + 1, None, c_end
    for n in range(1, num + 2):
        i = find(lines, rf"^\s{{0,3}}{n}\.\s", pos, c_end)
        if n == num:
            n_line = i
        if n == num + 1:
            nxt_line = i if i is not None else c_end
        if i is None:
            break
        pos = i + 1
    if n_line is None:
        return False
    if sub is None:
        return True
    k = int(sub)
    k_line, k_next = None, nxt_line
    pos = n_line + 1
    for kk in range(1, k + 2):
        i = find(lines, rf"^\s*[（(]{kk}[）)]", pos, nxt_line)
        if kk == k:
            k_line = i
        if kk == k + 1:
            k_next = i if i is not None else nxt_line
        if i is None:
            break
        pos = i + 1
    if k_line is None:
        return False
    if subsub is None:
        return True
    return find(lines, rf"^\s*{int(subsub)}[）)]", k_line + 1, k_next) is not None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--eval-set", default=str(HERE / "eval_set.jsonl"))
    ap.add_argument("--text", default="/tmp/jd0300.txt")
    ap.add_argument("--pdf", default=str(HERE.parents[1] / "data/docs/JD0300_IF.pdf"))
    a = ap.parse_args()
    lines = load_lines(a.text, a.pdf)
    errors, ids, by_route = [], set(), {}
    for n, raw in enumerate(Path(a.eval_set).read_text(encoding="utf-8").splitlines(), 1):
        if not raw.strip():
            continue
        try:
            c = json.loads(raw)
        except json.JSONDecodeError as e:
            errors.append(f"line {n}: invalid JSON ({e})")
            continue
        cid = c.get("id", f"line{n}")
        if cid in ids:
            errors.append(f"{cid}: duplicate id")
        ids.add(cid)
        for k in ("id", "turns", "expected_route", "expected_product", "expected_ae", "category"):
            if k not in c:
                errors.append(f"{cid}: missing {k}")
        if not isinstance(c.get("turns"), list) or not c.get("turns") or not all(isinstance(t, str) for t in c["turns"]):
            errors.append(f"{cid}: turns must be a non-empty list of strings")
        if c.get("expected_route") not in ROUTES:
            errors.append(f"{cid}: bad expected_route {c.get('expected_route')!r}")
        by_route[c.get("expected_route")] = by_route.get(c.get("expected_route"), 0) + 1
        er = c.get("expected_routes")
        if er is not None:
            if len(er) != len(c["turns"]) or er[-1] != c["expected_route"] or not set(er) <= ROUTES:
                errors.append(f"{cid}: expected_routes inconsistent with turns/expected_route")
        if c.get("expected_product") not in (None, *PRODUCTS):
            errors.append(f"{cid}: bad expected_product")
        sec = c.get("expected_section_path")
        if sec is not None and c["expected_route"] not in SEARCH_ROUTES:
            errors.append(f"{cid}: section path on non-search route")
        if sec is None and c.get("expected_route") in SEARCH_ROUTES:
            errors.append(f"{cid}: search route without expected_section_path")
        for p in ([sec] if sec else []) + list(c.get("alt_section_paths", [])):
            if not heading_exists(lines, p):
                errors.append(f"{cid}: section path {p!r} not found as heading")
    print(f"{len(ids)} cases; per expected_route: {dict(sorted(by_route.items(), key=lambda kv: str(kv[0])))}")
    for e in errors:
        print("ERROR", e)
    print("OK" if not errors else f"{len(errors)} error(s)")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
