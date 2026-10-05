"""Section builder for Japanese Interview Forms (IF) parsed by ai_parse_document (v2.0).

Pure Python, no Spark/Databricks imports, so it is unit-testable and also used from a pipeline UDF.

Input : the ordered `elements` of ai_parse_document output, reduced to
        {id, type, content, page_id}  (page_id is the 0-based PDF page).
Output: document metadata (product_code, doc_rev, revision_date) and a list of sections.

Design choices
--------------
* Heading hierarchy of an IF:  L1 "Ⅴ."   L2 "3."   L3 "（4）"   L4 "1）".
  Section paths look like  Ⅴ  /  Ⅴ.5  /  Ⅴ.5.(4)  /  Ⅴ.5.(4).1)   (no trailing dot).
* ai_parse_document tags many non-headings as section_header (＜解説＞, 〈切除不能な肝細胞癌〉, H鎖, and quoted
  package-insert numbering such as "7. 用法及び用量に関連する注意" inside Ⅴ.4 or "7.1 ..."). A numbered heading is
  accepted only if its number continues the sequence of its parent (previous number + 1, or 1 right after the
  parent heading). Anything else is kept as body text (section_header -> markdown sub-heading).
* The parser also glues headings into text elements (e.g. "（1）臨床データパッケージ\\n〈...〉" or
  "（2）...\\n...\\n\\n（3）..." in one element). Lines that start a paragraph and pass the same sequence check are
  therefore treated as headings too, provided they look like a title (<= 70 chars, no "。") and pass the same
  sequence check. The sequence check is what keeps this safe.
* Sections are emitted at EVERY level. A parent's `markdown` contains its children (so "the full section 4.2" works);
  `own_markdown` holds only the text before the first child and is used for chunking so that no text is embedded
  twice and every chunk belongs to exactly one section.
* Everything before "Ⅰ." is the section 'FRONT' (cover, guide to the IF, table of contents, abbreviations).
* page_number / page_header / page_footer elements are dropped. Pages are 1-based.
* approved_flag is False for everything under Ⅴ.5 (clinical results), ⅩⅡ (references) and ⅩⅢ (notes): the IF itself
  states these parts may contain unapproved information.
* Document metadata comes from regex on the cover page and the products master data, never from an LLM.
* Roman chapter labels are canonicalised (Ⅺ -> ⅩⅠ, Ⅻ -> ⅩⅡ) and the approved rule compares NFKC-normalised paths, so the
  variant the parser happens to emit cannot flip approved_flag.
* Pseudo-sections (CONTRACTS section 8): a section whose own body is longer than SPLIT_CHARS is split at sub-heading
  blocks, in rank order  〈…〉 > 【…】/◆ > ＜…＞ (not ＜解説＞) > package-insert numbering > "…試験における…" lines, and as a
  last resort by packing whole blocks. Tables are atomic. Children are  parent + "#k"  at level parent + 1; the parent
  keeps only its introduction, so  parent.markdown == "\n\n".join(intro, *children)  and an answer is always an exact
  contiguous slice of the IF.
* Section-level study_ids come from the heading (study name / code, or an indication heading that maps to exactly one
  study of the product) and are inherited by child sections.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import date
from typing import Any, Optional

ROMAN = {"Ⅰ": 1, "Ⅱ": 2, "Ⅲ": 3, "Ⅳ": 4, "Ⅴ": 5, "Ⅵ": 6, "Ⅶ": 7, "Ⅷ": 8, "Ⅸ": 9, "Ⅹ": 10, "Ⅺ": 11, "Ⅻ": 12}
_R = "".join(ROMAN)
_ROMAN_UNITS = ["", "Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ", "Ⅷ", "Ⅸ", "Ⅹ"]
_ROMAN_LATIN = {"I": 1, "V": 5, "X": 10}
L1_RE = re.compile(rf"^([{_R}]+)[.．]")
L2_RE = re.compile(r"^([0-9０-９]+)[.．](?![0-9０-９])")
L3_RE = re.compile(r"^[（(]([0-9０-９]+)[)）]")
L4_RE = re.compile(r"^([0-9０-９]+)[)）]")

SKIP_TYPES = {"page_number", "page_header", "page_footer"}
UNAPPROVED_PREFIXES = ("Ⅴ.5", "ⅩⅡ", "ⅩⅢ")
_UNAPPROVED_NFKC = tuple(unicodedata.normalize("NFKC", p) for p in UNAPPROVED_PREFIXES)
SPLIT_CHARS = 6000  # a section whose own body is longer than this is split into pseudo-sections
MAX_HEADING_LINE = 120
# lines found inside text elements must look like a title, not like a numbered sentence
MAX_TEXT_HEADING_LINE = 70

DOC_REV_RE = re.compile(r"(\d{4})年\s*(\d{1,2})月\s*(改訂|作成)\s*[（(]第\s*(\d+)\s*版[）)]")


def _num(s: str) -> int:
    return int(unicodedata.normalize("NFKC", s))


def _roman(s: str) -> int:
    """Value of a Roman label in any Unicode spelling: NFKC turns Ⅻ, ⅩⅡ and XII alike into Latin letters."""
    v = unicodedata.normalize("NFKC", s)
    total = 0
    for i, c in enumerate(v):
        x = _ROMAN_LATIN[c]
        nxt = _ROMAN_LATIN.get(v[i + 1], 0) if i + 1 < len(v) else 0
        total += -x if x < nxt else x
    return total


def roman_label(n: int) -> str:
    """Canonical label: single glyphs up to Ⅹ, then Ⅹ + unit glyph (ⅩⅠ, ⅩⅡ, ⅩⅢ), whatever the parser emitted."""
    return _ROMAN_UNITS[n] if n <= 10 else "Ⅹ" + _ROMAN_UNITS[n - 10]


def _heading_candidate(line: str) -> Optional[tuple[int, int, str]]:
    """(level, number, label) if the line starts like an IF heading, else None."""
    line = line.strip()
    if not line or len(line) > MAX_HEADING_LINE:
        return None
    m = L1_RE.match(line)
    if m:
        n = _roman(m.group(1))
        return 1, n, roman_label(n)
    m = L2_RE.match(line)
    if m:
        return 2, _num(m.group(1)), str(_num(m.group(1)))
    m = L3_RE.match(line)
    if m:
        return 3, _num(m.group(1)), f"({_num(m.group(1))})"
    m = L4_RE.match(line)
    if m:
        return 4, _num(m.group(1)), f"{_num(m.group(1))})"
    return None


def _title(line: str) -> str:
    line = line.replace("\n", "").strip()
    for rx in (L1_RE, L2_RE, L3_RE, L4_RE):
        m = rx.match(line)
        if m:
            return line[m.end():].strip()
    return line


class _Section:
    def __init__(
        self, path: str, level: int, heading: str, page: Optional[int], parent: Optional["_Section"], pseudo: bool = False
    ):
        self.path, self.level, self.heading, self.parent = path, level, heading, parent
        self.pseudo = pseudo
        self.blocks: list[str] = []
        self.block_pages: list[int] = []
        self.heading_page = page
        self.pages: set[int] = set() if page is None else {page}
        self.children: list[_Section] = []
        self.pseudo_children: list[_Section] = []  # filled by the splitter, merged into children by _attach_pseudo
        self.detect_text = ""  # text searched for study names (pseudo-sections: heading paragraph)
        self.study_ids: list[str] = []

    def add_block(self, text: str, page: int) -> None:
        self.blocks.append(text)
        self.block_pages.append(page)
        self.pages.add(page)

    def md_heading(self) -> str:
        if self.level == 0 or self.pseudo:  # a pseudo-section starts with the original sub-heading block itself
            return ""
        return "#" * self.level + " " + self.heading.replace("\n", "")

    def own_markdown(self) -> str:
        parts = ([self.md_heading()] if self.md_heading() else []) + self.blocks
        return "\n\n".join(parts)

    def own_body_len(self) -> int:
        return len("\n\n".join(self.blocks))

    def markdown(self) -> str:
        parts = [self.own_markdown()] + [c.markdown() for c in self.children]
        return "\n\n".join(p for p in parts if p)

    def all_pages(self) -> list[int]:
        pages = set(self.pages)
        for c in self.children:
            pages.update(c.all_pages())
        return sorted(pages)

    def walk(self):
        yield self
        for c in self.children:
            yield from c.walk()


def is_approved(section_path: str) -> bool:
    """False under Ⅴ.5, ⅩⅡ, ⅩⅢ. Compared NFKC-normalised, so Ⅻ and ⅩⅡ are the same chapter; a pseudo-section
    ("...#k") takes the decision of the real section it was cut from."""
    path = unicodedata.normalize("NFKC", section_path.split("#", 1)[0])
    for p in _UNAPPROVED_NFKC:
        if path == p or path.startswith(p + "."):
            return False
    return True


# ---- pseudo-sections -------------------------------------------------------------------------------------------------

_SHORT_HEAD = 70  # a sub-heading line is short and is not a sentence


def _is_table(block: str) -> bool:
    return block.lstrip().startswith("<table")


def _head_line(block: str) -> str:
    """First line of a block without markdown '#' marks, NFKC-free (original characters)."""
    return re.sub(r"^#+\s*", "", block.split("\n", 1)[0]).strip()


def _is_short_line(line: str) -> bool:
    return 0 < len(line) <= _SHORT_HEAD and "。" not in line


_ANGLE_SUB = re.compile(r"^〈[^〉]{1,60}〉$")
_PKG_NUM = re.compile(r"^\d+\.\d+(?:\.\d+)?\s*\S")


def _rank_match(block: str, rank: int) -> bool:
    if _is_table(block):
        return False
    h = _head_line(block)
    if rank == 0:  # 〈…〉 on its own line
        return bool(_ANGLE_SUB.match(h))
    if rank == 1:  # 【…】 or ◆…
        return _is_short_line(h) and h[0] in "【◆"
    if rank == 2:  # ＜…＞ except ＜解説＞, which belongs to the item before it
        return _is_short_line(h) and h[0] == "＜" and not h.startswith("＜解説＞")
    if rank == 3:  # quoted package-insert numbering 11.2 / 8.1.3
        return _is_short_line(h) and bool(_PKG_NUM.match(unicodedata.normalize("NFKC", h)))
    if rank == 4:  # "POSEIDON試験における..." result headings
        return len(h) <= 120 and "。" not in h and "試験における" in h
    return False


_RANKS = 5
_PACK = _RANKS  # last resort: pack whole blocks


def _heading_like(block: str) -> bool:
    return block.startswith("#") and len(block) <= 120 and not block.startswith("#### ＜解説＞") and "＜解説＞" not in block[:12]


def _pack_cuts(blocks: list[str]) -> list[int]:
    cuts: list[int] = []
    start, size = 0, 0
    for i, b in enumerate(blocks):
        add = len(b) + (2 if i > start else 0)
        if i > start and size + add > SPLIT_CHARS:
            cut = i
            if _heading_like(blocks[i - 1]) and i - 1 > start:
                cut = i - 1  # keep a sub-heading with the block that follows it
            cuts.append(cut)
            start = cut
            size = len("\n\n".join(blocks[cut : i + 1]))
        else:
            size += add
    return cuts


def _cuts(blocks: list[str], rank: int) -> list[int]:
    if rank == _PACK:
        return _pack_cuts(blocks)
    return [i for i, b in enumerate(blocks) if _rank_match(b, rank)]


def _title_of(block: str) -> str:
    h = _head_line(block)
    return h if len(h) <= 80 else h[:80] + "…"


def _detect_text(blocks: list[str]) -> str:
    """Heading of a pseudo-section: the first two lines of its first block ("〈切除不能な肝細胞癌〉" is followed by
    "国際共同第Ⅲ相試験（HIMALAYA試験）" in the same block), plus the short line after a bare heading block."""
    first = blocks[0].split("\n\n", 1)[0]
    text = "\n".join(first.split("\n")[:2])[:200]
    if len(blocks[0]) <= 120 and len(blocks) > 1 and not _is_table(blocks[1]) and len(blocks[1]) <= 120:
        text += "\n" + blocks[1].split("\n", 1)[0]
    return text


def _split_section(sec: _Section, rank: int = 0) -> None:
    """Cut sec.blocks at sub-heading blocks into sec.pseudo_children, recursing while a part is still too long."""
    if sec.own_body_len() <= SPLIT_CHARS:
        return
    for r in range(rank, _PACK + 1):
        cuts = _cuts(sec.blocks, r)
        if not cuts:
            continue
        intro_n = cuts[0]  # 0: the section starts with the sub-heading, nothing is left as introduction
        if (1 if intro_n else 0) + len(cuts) < 2:
            continue
        blocks, pages = sec.blocks, sec.block_pages
        sec.blocks, sec.block_pages = blocks[:intro_n], pages[:intro_n]
        sec.pages = set(sec.block_pages) | ({sec.heading_page} if sec.heading_page is not None else set())
        _split_section(sec, r + 1)  # an introduction that is still too long yields its own leading children
        for a, b in zip(cuts, cuts[1:] + [len(blocks)]):
            kid = _Section("", 0, _title_of(blocks[a]), None, sec, pseudo=True)
            for blk, pg in zip(blocks[a:b], pages[a:b]):
                kid.add_block(blk, pg)
            if r == _PACK and _is_table(blocks[a]):
                kid.heading = f"{sec.heading}（続き）"
            kid.detect_text = _detect_text(kid.blocks)
            sec.pseudo_children.append(kid)
            _split_section(kid, r + 1)
        return


def _attach_pseudo(sec: _Section) -> None:
    """Name and attach the pseudo children (parent#k, level + 1) before the real children, which come later in the text."""
    for k, kid in enumerate(sec.pseudo_children, 1):
        kid.path, kid.level, kid.parent = f"{sec.path}#{k}", sec.level + 1, sec
    sec.children = sec.pseudo_children + sec.children
    for c in sec.children:
        _attach_pseudo(c)


# ---- study ids -------------------------------------------------------------------------------------------------------


def _norm(text: str) -> str:
    return unicodedata.normalize("NFKC", text).lower()


def _term_rx(term: str) -> "re.Pattern[str]":
    t = re.escape(_norm(term))
    return re.compile(rf"(?<![a-z0-9]){t}(?![a-z0-9])" if term.isascii() else t)


class StudyIndex:
    """Study ids named in a heading: explicit study id / code / study synonyms, or an indication term that maps to exactly
    one study of the product (CONTRACTS section 6 rule 9)."""

    def __init__(self, studies: list[dict[str, Any]], synonyms: list[dict[str, Any]]):
        self.products: dict[str, set[str]] = {}
        self.explicit: list[tuple[Any, str]] = []
        for st in studies or []:
            pcs = st.get("product_codes") or []
            if isinstance(pcs, str):
                pcs = [x for x in pcs.split("|") if x]
            self.products[st["study_id"]] = set(pcs)
            for t in (st.get("study_id"), st.get("study_code")):
                if t:
                    self.explicit.append((_term_rx(t), st["study_id"]))
        self.indication: list[tuple[str, Any, str]] = []
        for sy in synonyms or []:
            term, kind, target = sy.get("term"), sy.get("kind"), sy.get("target_id")
            if not term or not target:
                continue
            if kind == "study":
                self.explicit.append((_term_rx(term), target))
            elif kind == "indication":
                self.indication.append((_norm(term), _term_rx(term), target))

    def detect(self, text: str, product_code: Optional[str]) -> list[str]:
        if not text:
            return []
        norm = _norm(text)
        found = {sid for rx, sid in self.explicit if rx.search(norm)}
        if found:  # a named study beats the indication heading above it
            return sorted(found)
        hits = [(t, sid) for t, rx, sid in self.indication if rx.search(norm)]
        # "非小細胞肺癌" inside "切除不能な進行・再発の非小細胞肺癌" is not a second indication
        hits = [(t, sid) for t, sid in hits if not any(t != u and t in u for u, _ in hits)]
        cands = {sid for _, sid in hits if product_code is None or product_code in self.products.get(sid, set())}
        return sorted(cands) if len(cands) == 1 else []


def _assign_studies(sec: _Section, index: Optional[StudyIndex], product_code: Optional[str], inherited: list[str]) -> None:
    own = index.detect(sec.detect_text, product_code) if index else []
    sec.study_ids = own or inherited
    for c in sec.children:
        _assign_studies(c, index, product_code, sec.study_ids)


class _Builder:
    def __init__(self) -> None:
        self.front = _Section("FRONT", 0, "", None, None)
        self.cur: _Section = self.front
        self.l1 = self.l2 = self.l3 = self.l4 = 0  # last accepted number at each level
        self.l1_sec: Optional[_Section] = None
        self.l2_sec: Optional[_Section] = None
        self.l3_sec: Optional[_Section] = None
        self.roots: list[_Section] = [self.front]

    def _try_heading(self, line: str, page: int) -> bool:
        cand = _heading_candidate(line)
        if cand is None:
            return False
        level, n, label = cand
        if level == 1:
            if n != self.l1 + 1:
                return False
            sec = _Section(label, 1, line.strip(), page, None)
            self.roots.append(sec)
            self.l1, self.l2, self.l3, self.l4 = n, 0, 0, 0
            self.l1_sec, self.l2_sec, self.l3_sec = sec, None, None
        elif level == 2:
            if self.l1_sec is None or n != self.l2 + 1:
                return False
            sec = _Section(f"{self.l1_sec.path}.{label}", 2, line.strip(), page, self.l1_sec)
            self.l1_sec.children.append(sec)
            self.l2, self.l3, self.l4 = n, 0, 0
            self.l2_sec, self.l3_sec = sec, None
        elif level == 3:
            if self.l2_sec is None or n != self.l3 + 1:
                return False
            sec = _Section(f"{self.l2_sec.path}.{label}", 3, line.strip(), page, self.l2_sec)
            self.l2_sec.children.append(sec)
            self.l3, self.l4 = n, 0
            self.l3_sec = sec
        else:
            if self.l3_sec is None or n != self.l4 + 1:
                return False
            sec = _Section(f"{self.l3_sec.path}.{label}", 4, line.strip(), page, self.l3_sec)
            self.l3_sec.children.append(sec)
            self.l4 = n
        self.cur = sec
        return True

    def add_header(self, content: str, page: int) -> None:
        content = content.strip()
        if not content:
            return
        first = content.split("\n", 1)[0]
        # multi-line headings wrap inside one element: the whole content is the heading text
        if self._try_heading(first, page):
            self.cur.heading = content.replace("\n", "")
            return
        sub = "#" * min(self.cur.level + 1, 6) if self.cur.level else "#"
        self.cur.add_block(f"{sub} {content}", page)

    def add_text(self, content: str, page: int) -> None:
        content = content.strip("\n")
        if not content.strip():
            return
        lines = content.split("\n")
        buf: list[str] = []

        def flush() -> None:
            text = "\n".join(buf).strip("\n")
            buf.clear()
            if text.strip():
                self.cur.add_block(text, page)

        for i, line in enumerate(lines):
            paragraph_start = i == 0 or not lines[i - 1].strip()
            if paragraph_start and self._looks_like_title(line) and self._heading_ok(line):
                flush()
                self._try_heading(line, page)
                self.cur.pages.add(page)
                # the heading line itself is in the section heading, not in the body
                continue
            buf.append(line)
        flush()

    @staticmethod
    def _looks_like_title(line: str) -> bool:
        return len(line.strip()) <= MAX_TEXT_HEADING_LINE and "。" not in line

    def _heading_ok(self, line: str) -> bool:
        """Dry run of the sequence check (no state change)."""
        cand = _heading_candidate(line)
        if cand is None:
            return False
        level, n, _ = cand
        if level == 1:
            return n == self.l1 + 1
        if level == 2:
            return self.l1_sec is not None and n == self.l2 + 1
        if level == 3:
            return self.l2_sec is not None and n == self.l3 + 1
        return self.l3_sec is not None and n == self.l4 + 1


def doc_metadata(elements: list[dict[str, Any]], products: list[dict[str, Any]]) -> dict[str, Any]:
    """product_code / doc_rev / revision_date from the cover page by regex and products master data."""
    cover = "\n".join((e.get("content") or "") for e in elements if (e.get("page_id") or 0) == 0)
    cover_n = unicodedata.normalize("NFKC", cover)
    product_code = product_name = None
    best = None
    for p in products:
        for key in ("brand_ja", "generic_ja", "brand_en", "generic_en"):
            term = (p.get(key) or "").strip()
            if not term:
                continue
            pos = cover_n.lower().find(unicodedata.normalize("NFKC", term).lower())
            if pos >= 0 and (best is None or pos < best):
                best, product_code = pos, p["product_code"]
                product_name = f'{p.get("brand_ja") or ""}（{p.get("generic_ja") or ""}）'
                break
    doc_rev = revision_date = None
    m = DOC_REV_RE.search(cover_n) or DOC_REV_RE.search(
        unicodedata.normalize("NFKC", "\n".join((e.get("content") or "") for e in elements[:40]))
    )
    if m:
        doc_rev = f"{m.group(1)}年{int(m.group(2))}月{m.group(3)}（第{m.group(4)}版）"
        revision_date = date(int(m.group(1)), int(m.group(2)), 1)
    return {"product_code": product_code, "product_name": product_name, "doc_rev": doc_rev, "revision_date": revision_date}


def build_sections(
    elements: list[dict[str, Any]],
    doc_id: str,
    product_code: Optional[str] = None,
    doc_rev: Optional[str] = None,
    studies: Optional[list[dict[str, Any]]] = None,
    synonyms: Optional[list[dict[str, Any]]] = None,
) -> list[dict[str, Any]]:
    """Walk the elements in order and return every section (all levels, pseudo-sections included), parents before children."""
    b = _Builder()
    for e in elements:
        t = e.get("type")
        content = e.get("content")
        if t in SKIP_TYPES or not content or not content.strip():
            continue
        page = int(e.get("page_id") or 0) + 1
        if t == "section_header":
            b.add_header(content, page)
        elif t in ("text", "footnote", "caption"):
            b.add_text(content, page)
        else:  # table, figure, title, ...: verbatim block
            b.cur.add_block(content.strip(), page)

    index = StudyIndex(studies or [], synonyms or []) if (studies or synonyms) else None
    for root in b.roots:
        for s in list(root.walk()):
            if s.level >= 1:
                s.detect_text = _title(s.heading)
                _split_section(s)
        _attach_pseudo(root)
        _assign_studies(root, index, product_code, [])

    out: list[dict[str, Any]] = []
    for root in b.roots:
        for s in root.walk():
            path = s.path
            md = s.markdown()
            out.append(
                {
                    "section_id": f"{doc_id}::{path}",
                    "doc_id": doc_id,
                    "product_code": product_code,
                    "doc_rev": doc_rev,
                    "section_path": path,
                    "level": s.level,
                    "title": "FRONT" if s.level == 0 else (s.heading if s.pseudo else _title(s.heading)),
                    "parent_section_id": f"{doc_id}::{s.parent.path}" if s.parent is not None else None,
                    "markdown": md,
                    "own_markdown": s.own_markdown(),
                    "own_body_len": s.own_body_len(),
                    "pages": s.all_pages(),
                    "approved_flag": is_approved(path),
                    "audience": "HCP",
                    "qa_status": "AUTO",
                    "char_len": len(md),
                    "is_pseudo": s.pseudo,
                    "study_ids": list(s.study_ids),
                }
            )
    return out


def build_document(
    elements: list[dict[str, Any]],
    doc_id: str,
    products: list[dict[str, Any]],
    studies: Optional[list[dict[str, Any]]] = None,
    synonyms: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    meta = doc_metadata(elements, products)
    sections = build_sections(elements, doc_id, meta["product_code"], meta["doc_rev"], studies, synonyms)
    for sec in sections:
        # context line put in front of every chunk so that the embedding knows product, revision and section
        sec["header_line"] = " ".join(
            x for x in (meta["product_name"], "インタビューフォーム", meta["doc_rev"], sec["section_path"], sec["title"]) if x
        )
    return {"doc_id": doc_id, **meta, "sections": sections}
