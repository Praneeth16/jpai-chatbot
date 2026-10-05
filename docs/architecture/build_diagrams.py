from xml.sax.saxutils import escape

DEC = "rhombus;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontSize=11;"
DEC_NEW = "rhombus;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#b85450;strokeWidth=2;dashed=1;fontSize=11;"
PROC = "rounded=0;whiteSpace=wrap;html=1;fontSize=11;"
OUT = "rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontSize=11;arcSize=8;"
VERB = "rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;fontSize=11;arcSize=8;"
RISK = "rounded=1;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;fontSize=11;arcSize=8;"
SEARCH = "rounded=0;whiteSpace=wrap;html=1;fillColor=#1ba1a8;strokeColor=#0e8088;fontColor=#ffffff;fontSize=11;"
MODEL = "rounded=0;whiteSpace=wrap;html=1;fillColor=#e1d5e7;strokeColor=#9673a6;fontSize=11;"
TERM = "rounded=1;whiteSpace=wrap;html=1;arcSize=50;fillColor=#f5f5f5;strokeColor=#666666;fontSize=12;fontStyle=1;"
EDGE = "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;endFill=1;fontSize=11;fontColor=#1ba1a8;fontStyle=1;"
EDGE_DASH = EDGE + "dashed=1;"
NEW = '<font color="#b85450"><b>[NEW] </b></font>'
FIX = '<font color="#b85450"><b>[FIXED] </b></font>'


class Diagram:
    def __init__(self):
        self.cells = []
        self.n = 2

    def _id(self):
        self.n += 1
        return f"c{self.n}"

    def v(self, label, x, y, w, h, style, parent="1"):
        i = self._id()
        self.cells.append(
            f'<mxCell id="{i}" value="{escape(label, {chr(34): "&quot;"})}" style="{style}" vertex="1" parent="{parent}">'
            f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>'
        )
        return i

    def e(self, s, t, label="", style=EDGE, parent="1"):
        i = self._id()
        self.cells.append(
            f'<mxCell id="{i}" value="{escape(label, {chr(34): "&quot;"})}" style="{style}" edge="1" parent="{parent}" source="{s}" target="{t}">'
            f'<mxGeometry relative="1" as="geometry"/></mxCell>'
        )
        return i

    def xml(self):
        return ('<mxGraphModel adaptiveColors="auto" grid="0" page="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
                + "".join(self.cells) + "</root></mxGraphModel>")


def routing_flow():
    d = Diagram()
    AX, AW, AH = 40, 400, 72
    CX, CW = 520, 300
    DX, DW = 870, 270
    EX, EW, EH = 1230, 440, 58
    FX = 1730
    PX, PW = 1830, 560
    BADGE = "ellipse;whiteSpace=wrap;html=1;aspect=fixed;fillColor=#b85450;strokeColor=#ffffff;strokeWidth=2;fontColor=#ffffff;fontStyle=1;fontSize=13;"

    def ry(r):
        return 90 + 96 * r

    def out(r, label, style=OUT):
        return d.v(label, EX, ry(r) + (AH - EH) / 2, EW, EH, style)

    def badge(letter, x, y):
        d.v(letter, x, y, 28, 28, BADGE)

    d.v("<b>JPAI chatbot: Q&amp;A routing flow (fixed)</b><br><font style=\"font-size:11px\">Same steps and numbering as the team's flow. Red dashed outline + letter = what we added or fixed (reasons in the panel on the right).</font>",
        AX, 10, 1300, 50, "text;html=1;align=left;verticalAlign=top;fontSize=16;")

    start = d.v("User query + conversation state<br><font style=\"font-size:10px\">if pending_clarification: merge reply with the previous question</font>",
                AX + 30, ry(0) + 6, AW - 60, 60, TERM + "strokeColor=#b85450;strokeWidth=2;dashed=1;")
    badge("J", AX + 18, ry(0) - 2)

    pre = d.v(NEW + "0-a. Empty or gibberish?<br>(code check, no model call)", AX, ry(1), AW, AH, DEC_NEW)
    badge("A", AX + 60, ry(1) - 4)
    r0a = out(1, NEW + "0-a. Ask user to rephrase (template)")

    cls = d.v(NEW + "<b>Classify once per turn</b><br>System One API (OpenJev): AE, injection, has_request, intent + confidence, has_conditions<br>Master data (code): product, study, synonyms",
              AX - 10, ry(2) + 2, AW + 20, AH - 4, MODEL + "strokeColor=#b85450;strokeWidth=2;dashed=1;")
    badge("B", AX - 22, ry(2) - 8)

    ae = d.v(FIX + "1. Adverse event mentioned<br>anywhere? (AE prob ≥ τ_AE, low)", AX, ry(3), AW, AH, DEC_NEW)
    badge("C", AX + 60, ry(3) - 4)
    pv = d.v(NEW + "Log to PV queue<br>(always, any route)", DX, ry(3) + 7, DW, EH, RISK + "strokeWidth=2;dashed=1;")
    r1 = out(3, "<b>1. Adverse Event Report</b><br>Provide AE reporting link + MI contact", RISK)

    inj = d.v(NEW + "0-b. Prompt injection /<br>abuse? (prob ≥ τ_inj)", AX, ry(4), AW, AH, DEC_NEW)
    badge("D", AX + 60, ry(4) - 4)
    r0b = out(4, NEW + "0-b. Refusal template + security log")

    small = d.v(NEW + "0-c. Only greeting / thanks /<br>small talk? (has_request &lt; τ)", AX, ry(5), AW, AH, DEC_NEW)
    badge("E", AX + 60, ry(5) - 4)
    r0c = out(5, NEW + "0-c. Greeting / closing / about-bot template<br>(scope, example questions, AE link)")

    q2 = d.v("2. Question that cannot be answered?<br>(advice, off-label, pricing, competitor)", AX, ry(6), AW, AH, DEC)
    r2 = out(6, "<b>2. Unanswerable Question</b><br>Unable-to-answer + MR contact + ask to rephrase")

    q31 = d.v("3-1. Patient materials?", AX, ry(7), AW, AH, DEC)
    r31 = out(7, "<b>3.1 Material Location (Patient)</b><br>Link to Patient Education Materials + how to request")

    q32 = d.v("3-2. Where to find<br>product-related materials?", AX, ry(8), AW, AH, DEC)
    r32 = out(8, "<b>3.2 Material Location (HCP)</b><br>Link to Product Information + how to request")

    q41 = d.v("4-1. Basic drug info / usage<br>" + FIX + "AND product identified?", AX, ry(9), AW, AH, DEC_NEW)
    badge("F", AX + 60, ry(9) - 4)
    q42 = d.v("4-2. Individual conditions or<br>patient population?", CX, ry(9), CW, AH, DEC)
    s41 = d.v("<b>Search Materials</b> (AI Search)<br>filter: product + conditions<br><font style=\"font-size:10px\">score &lt; τ_ret → route 2</font>", DX, ry(9) + 7, DW, EH, SEARCH)
    badge("G", DX - 14, ry(9) - 4)
    r41 = out(9, "<b>4.1 Drug Info (Specific Conditions)</b><br>Return matching subsection verbatim + citation", VERB)
    s42 = d.v("<b>Search Materials</b> (AI Search)<br>filter: product<br><font style=\"font-size:10px\">score &lt; τ_ret → route 2</font>", DX, ry(10) + 7, DW, EH, SEARCH)
    r42 = out(10, "<b>4.2 Drug Info / Usage</b><br>Return full section verbatim + citation", VERB)
    badge("K", EX - 14, ry(9) - 4)

    q51 = d.v("5-1. Efficacy or safety<br>" + FIX + "AND product identified?", AX, ry(11), AW, AH, DEC_NEW)
    badge("F", AX + 60, ry(11) - 4)
    q52 = d.v("5-2. Target study specified?<br>(master data)", CX, ry(11), CW, AH, DEC)
    s51 = d.v("<b>Search Materials</b> (AI Search)<br>filter: product + study<br><font style=\"font-size:10px\">score &lt; τ_ret → route 2</font>", DX, ry(11) + 7, DW, EH, SEARCH)
    r51 = out(11, "<b>5.1 Efficacy / Safety</b><br>Return section for the study verbatim + citation", VERB)
    r52 = out(12, "<b>5.2 Target Study Not Specified</b><br>Ask which study (sets pending_clarification)")

    q61 = d.v("6-1. Website-related inquiry?", AX, ry(13), AW, AH, DEC)
    r61 = out(13, "<b>6.1 Website-Related Inquiry</b><br>Provide website inquiry guidance")

    q62 = d.v("6-2. Intention to make a request<br>to or contact AZ?", AX, ry(14), AW, AH, DEC)
    r62 = out(14, "<b>6.2 Other Inquiry</b><br>How to contact an MR")

    q7 = d.v(FIX + "7. About an AZ product / disease area,<br>but product, study or focus unclear?", AX, ry(15), AW, AH, DEC_NEW)
    badge("H", AX + 60, ry(15) - 4)
    r71 = out(15, "<b>7.1 Ambiguous Question</b><br>Ask for product / study and focus (sets pending_clarification)")

    q8 = d.v(NEW + "8. Off-topic 3+ times in a row?", AX, ry(16), AW, AH, DEC_NEW)
    badge("I", AX + 60, ry(16) - 4)
    r82 = out(16, NEW + "8.2 Stop rephrase loop: MR / MI contact")
    r81 = out(17, "<b>8.1 Out-of-Scope Question</b><br>Cannot answer + MR contact + ask to rephrase")

    bar = d.v("<b>Log MLflow trace</b> (route, probabilities, section_ids, model ids, template id) → <b>Response to user</b> (only MLR-approved templates or verbatim sections)",
              FX, ry(1), 56, ry(17) + AH - ry(1),
              "rounded=0;whiteSpace=wrap;html=1;horizontal=0;fillColor=#f5f5f5;strokeColor=#b85450;strokeWidth=2;dashed=1;fontSize=11;")
    badge("J", FX + 14, ry(1) - 14)

    for a, b in [(start, pre), (cls, ae)]:
        d.e(a, b)
    d.e(pre, cls, "No")
    d.e(pre, r0a, "Yes")
    d.e(ae, pv, "Yes")
    d.e(pv, r1)
    chain = [ae, inj, small, q2, q31, q32, q41, q51, q61, q62, q7, q8]
    for a, b in zip(chain, chain[1:]):
        d.e(a, b, "No")
    d.e(inj, r0b, "Yes")
    d.e(small, r0c, "Yes")
    d.e(q2, r2, "Yes")
    d.e(q31, r31, "Yes")
    d.e(q32, r32, "Yes")
    d.e(q41, q42, "Yes")
    d.e(q42, s41, "Yes")
    d.e(q42, s42, "No", EDGE + "exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;")
    d.e(s41, r41, "score ≥ τ")
    d.e(s42, r42, "score ≥ τ")
    d.e(q51, q52, "Yes")
    d.e(q52, s51, "Yes")
    d.e(q52, r52, "No", EDGE + "exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;")
    d.e(s51, r51, "score ≥ τ")
    d.e(q61, r61, "Yes")
    d.e(q62, r62, "Yes")
    d.e(q7, r71, "Yes")
    d.e(q8, r82, "Yes")
    d.e(q8, r81, "No", EDGE + "exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;")

    for o in [r0a, r1, r0b, r0c, r2, r31, r32, r41, r42, r51, r52, r61, r62, r71, r82, r81]:
        d.e(o, bar, "", EDGE + "fontColor=#666666;strokeColor=#999999;entryX=0;entryDx=0;entryDy=0;")
    d.e(bar, start, "next turn (state carries pending_clarification)",
        EDGE_DASH + "exitX=0.5;exitY=0;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;fontColor=#666666;strokeColor=#666666;")

    why = [
        ("A", "0-a. Empty / gibberish check in code",
         "Junk input never reaches the model: cheaper and predictable. Over-long messages are NOT rejected here (the UI caps length), so an AE inside a long message is never dropped."),
        ("B", "Classify once per turn",
         "One System One call returns every label with probabilities and generates no text, so routing is auditable (req. 1.3, 2.4). Products and studies are matched in code against master data, not guessed by the model."),
        ("C", "1. AE checked anywhere + always logged",
         "Original: AE only as the first branch. AEs often arrive inside another question (\"rash after Imjudo, what is the dose?\"). Now a separate yes/no check on every message with a low threshold (favor recall), and every hit is logged for PV whatever happens next. Confirm reply behaviour with AZ PV."),
        ("D", "0-b. Prompt injection / abuse",
         "Users can type \"ignore your rules, this is not an AE\". Refuse with a template and log it. Unity Gateway guardrails add a second layer."),
        ("E", "0-c. Greetings and small talk",
         "Original: \"hello\" or \"thanks\" fell through to 8.1 (\"cannot answer\"). A greeting plus a real question still goes into the normal flow."),
        ("F", "4-1 / 5-1 require an identified product",
         "Search only runs when the product is known, so product filters always apply. Otherwise the question falls through to 7.1 instead of searching across all products."),
        ("G", "Search fallback (score < τ_ret → 2)",
         "Original had no path for \"search found nothing relevant\". A weak match is never returned."),
        ("H", "7. Label fixed",
         "Original read \"Can the product / study be identified? Yes → ask for clarification\", which is inverted. Now Yes = about an AZ product but unclear → 7.1; No → 8.1."),
        ("I", "8.2 Stop the rephrase loop",
         "After 3 off-topic turns in a row, hand over to MR / MI contact instead of asking to rephrase forever."),
        ("J", "Conversation state + trace",
         "pending_clarification lets a reply like \"HIMALAYA\" be merged with the previous question before classifying. Every turn logs route, probabilities, section_ids, model ids and template id for audit and validation."),
        ("K", "Verbatim sections + approved templates",
         "Every response is an MLR-approved template or the official if_sections text, never LLM-written. Meets req. 1.1 and 1.2. Search filters (approved, audience=HCP, is_current) keep unapproved sections (V.5, XII, XIII) and old revisions out."),
    ]
    d.v("<b>What we added or fixed, and why</b>", PX, 90, PW, 30, "text;html=1;align=left;fontSize=14;")
    y = 125
    for letter, title, text in why:
        badge(letter, PX, y + 4)
        d.v(f"<b>{escape(title)}</b><br>{escape(text)}", PX + 38, y, PW - 38, 92,
            "rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=8;spacingTop=4;fontSize=11;fillColor=#fff5f5;strokeColor=#b85450;arcSize=6;")
        y += 102
    d.v("Every intent diamond (2 to 6-2) = intent label matches AND confidence ≥ τ_intent. Low confidence falls through to 7. All thresholds τ are tuned on the labelled Japanese eval set.",
        PX, y + 4, PW, 50, "text;html=1;align=left;fontSize=11;fontStyle=2;whiteSpace=wrap;fontColor=#555555;")

    ly = ry(18) + 10
    d.v("<b>Legend</b>", AX, ly, 80, 24, "text;html=1;fontSize=12;")
    items = [
        ("Decision in code", DEC, 170), ("Added / fixed step", DEC_NEW, 170),
        ("Model call (classify only)", MODEL, 190), ("AI Search", SEARCH, 120),
        ("Fixed template (MLR-approved)", OUT, 210), ("Verbatim section from if_sections", VERB, 240),
        ("AE / PV path", RISK, 120),
    ]
    x = AX + 80
    for label, st, w in items:
        d.v(label, x, ly, w, 30, st.replace("rhombus;", "rounded=0;"))
        x += w + 12
    d.v("Search Materials = hybrid query + filters (approved=true, audience=HCP, is_current) → section_id → if_sections lookup.",
        AX, ly + 40, 1500, 30, "text;html=1;align=left;fontSize=11;fontColor=#555555;")
    return d.xml()


def architecture():
    d = Diagram()
    CONT = "rounded=1;whiteSpace=wrap;html=1;arcSize=2;verticalAlign=top;align=left;spacingLeft=10;spacingTop=6;fontSize=13;fontStyle=1;"
    SUB = "rounded=1;whiteSpace=wrap;html=1;arcSize=2;verticalAlign=top;align=left;spacingLeft=8;spacingTop=4;fontSize=12;fontStyle=1;fillColor=#ffffff;strokeColor=#ff3621;"
    BOX = "rounded=1;whiteSpace=wrap;html=1;arcSize=8;fontSize=11;"
    DB = BOX + "fillColor=#fbe5dc;strokeColor=#ff3621;"
    DELTA = "shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;size=8;fontSize=11;fillColor=#fbe5dc;strokeColor=#ff3621;"
    AWS = BOX + "fillColor=#fff2cc;strokeColor=#d79b00;"
    AZ = BOX + "fillColor=#e1d5e7;strokeColor=#9673a6;"
    ON = "edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;endFill=1;strokeWidth=2;strokeColor=#1b3139;fontSize=11;fontStyle=1;labelBackgroundColor=#ffffff;"
    AE = ON + "strokeColor=#b85450;"
    OFF = "edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;endFill=1;dashed=1;strokeWidth=1.5;strokeColor=#ff3621;fontSize=10;labelBackgroundColor=#ffffff;"
    GOV = "edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;endFill=1;dashed=1;dashPattern=1 3;strokeColor=#666666;fontSize=10;labelBackgroundColor=#ffffff;"

    C1, C2, C3, CW = 640, 980, 1320, 290
    R = {1: 200, 2: 290, 3: 380, 4: 470, 5: 560}
    RH = 70

    d.v("<b>JPAI chatbot: proposed Databricks architecture (Oct 2026)</b><br><font style=\"font-size:11px\">Solid numbered arrows = one HCP turn (online). Dashed red = content preparation per IF revision (offline). Dotted grey = people and controls.</font>",
        20, 0, 570, 65, "text;html=1;align=left;verticalAlign=top;fontSize=16;whiteSpace=wrap;")

    d.v("HCP (external)", 20, 70, 190, 160, CONT + "fillColor=#f5f5f5;strokeColor=#666666;")
    hcp = d.v("<b>HCP</b> on MediChannel<br>med.astrazeneca.co.jp", 35, 100, 160, 60, BOX + "fillColor=#ffffff;")

    d.v("AWS · Deloitte-managed app tier", 240, 70, 330, 670, CONT + "fillColor=#fffbf0;strokeColor=#d79b00;")
    ui = d.v("<b>Chat UI</b> (embedded in website)", 260, 100, 290, 60, AWS)
    ctl = d.v("<b>Conversation controller</b><br>AWS ECS<br><br>Deterministic router = fixed flow (steps 0 to 8)<br>thresholds τ, templates, state machine<br><br><i>Alternative: same code as a custom agent<br>on Databricks Apps</i>",
              260, 190, 290, 450, AWS)
    sec = d.v("<b>AWS Secrets Manager</b><br>Databricks service principal (OAuth M2M)<br><i>network path AWS → workspace: pending approval</i>", 260, 655, 290, 75, AWS)

    d.v("AstraZeneca content &amp; QA", 240, 770, 330, 480, CONT + "fillColor=#f7f0fa;strokeColor=#9673a6;")
    own = d.v("<b>Content owners</b><br>publish IF revisions, website content", 260, 800, 290, 70, AZ)
    rev = d.v("<b>Eval reviewers</b> (Medical Info)<br>label Japanese test set, sign off results", 260, 1100, 290, 70, AZ)

    d.v("Azure Databricks · Japan East (APAC Tokyo workspace) · governed by Unity Catalog", 600, 40, 1130, 1240, CONT + "fillColor=#fdf3ef;strokeColor=#ff3621;")
    d.v("Online serving (per HCP turn)", 620, 80, 1090, 620, SUB)
    d.v("<b>Unity Gateway</b>: one governed entry for models · guardrails · rate limits · usage tracking", C1, 110, C2 + CW - C1, 60,
        BOX + "fillColor=#ffffff;strokeColor=#ff3621;dashed=1;")
    sys1 = d.v("<b>System One API</b> · openjev-qwen35-4b<br>classify only (no text generated)<br><i>Japan East: cross-geo + ADI Services</i>", C1, R[1], CW, RH, DB)
    emb = d.v("<b>Embedding</b> · qwen3-embedding-0-6b<br>in-region Japan East (Public Preview)", C2, R[1], CW, RH, DB)
    srch = d.v("<b>AI Search</b> · hybrid index if_chunks_idx<br>filters: product, study, approved,<br>audience, is_current", C2, R[2], CW, RH, DB)
    lb = d.v("<b>Lakebase</b> (synced tables + OLTP)<br>if_sections · master data · templates<br>conversation state · AE queue", C1, R[3], CW, RH, DB)
    trace = d.v("<b>MLflow 3 tracing</b> → UC trace tables<br>MLflow SDK from ECS (tracking URI = workspace)<br>route, probabilities, section_ids, model ids", C1, R[4], CW, RH, DB)
    pvq = d.v("<b>AE / PV queue</b> (Lakebase table)<br>Lakeflow Job notifies PV", C1, R[5], CW, RH, DB + "fillColor=#f8cecc;strokeColor=#b85450;")
    d.v("Response text is always an MLR-approved template or the verbatim if_sections text. The LLM never writes the answer.",
        1290, R[4] - 10, 270, 90, "text;html=1;fontSize=11;fontStyle=3;fontColor=#b85450;align=left;whiteSpace=wrap;")

    d.v("Offline ingestion · Lakeflow Spark Declarative Pipeline (per content release)", 620, 730, 1090, 280, SUB)
    vol = d.v("<b>UC Volume</b><br>IF PDFs, PPTX,<br>website HTML", 640, 790, 140, 90, DELTA)
    parse = d.v("<b>ai_parse_document</b><br>version pinned<br>+ page images", 805, 795, 150, 80, DB)
    split = d.v("<b>Section builder</b> (Python)<br>IF headings Ⅰ～ⅩⅢ → section_id<br>approved / audience by code<br>+ human QA gate", 980, 790, 170, 90, DB)
    secs = d.v("<b>if_sections</b><br>source of truth<br>doc_rev · is_current<br>approved · audience", 1175, 785, 150, 100, DELTA)
    prep = d.v("<b>ai_prep_search</b> (Beta)<br>chunks per section<br>version pinned · enum schema", 1350, 795, 150, 80, DB)
    chunks = d.v("<b>if_chunks</b> (CDF)<br>chunk_to_embed<br>+ section_id", 1525, 790, 165, 90, DELTA)
    d.v("<b>Master data</b> (Delta) · product, study IDs, synonyms → synced to Lakebase", 640, 910, 300, 70, DELTA)
    d.v("<b>Lakeflow Jobs</b><br>new IF revision → re-parse that product → swap is_current", 970, 910, 400, 70, DB)
    tpl = d.v("<b>Response templates</b> (Delta)<br>MLR-approved, versioned → synced to Lakebase", 1400, 910, 290, 70, DELTA)

    d.v("Governance, quality &amp; delivery", 620, 1040, 1090, 220, SUB)
    gov = []
    gx = 640
    for label in ["<b>MLflow evaluation</b><br>reads trace tables · Japanese eval set<br>route accuracy, verbatim match, AE recall",
                  "<b>Unity Catalog</b><br>ACLs, lineage, audit<br>for every table and model",
                  "<b>AI/BI dashboard</b><br>routes, fallbacks, latency,<br>AE volume, drift",
                  "<b>DABs (bundles)</b><br>CI/CD for pipelines, jobs,<br>indexes, app config",
                  "<b>Pinned versions</b><br>model / function change<br>triggers re-validation"]:
        gov.append(d.v(label, gx, 1090, 200, 90, DB + "fillColor=#ffffff;"))
        gx += 212
    d.v("Validated-system controls: pinned function and model versions, regression eval on every prompt, threshold or model change, full trace retention.",
        640, 1195, 1050, 40, "text;html=1;fontSize=11;fontStyle=2;align=left;")

    d.v("AstraZeneca teams", 1760, 70, 230, 940, CONT + "fillColor=#f7f0fa;strokeColor=#9673a6;")
    pvt = d.v("<b>Pharmacovigilance</b><br>receives AE cases", 1780, R[5], 190, RH, AZ)
    mlr = d.v("<b>Medical Info / MLR</b><br>approve templates", 1780, 910, 190, 70, AZ)

    def port(r):
        return f"exitX=1;exitY={(R[r] + RH / 2 - 190) / 450:.3f};exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;"

    d.e(hcp, ui, "1", ON)
    d.e(ui, ctl, "2", ON)
    d.e(ctl, sys1, "3 classify", ON + port(1))
    d.e(ctl, srch, "4 search (routes 4 / 5)", ON + port(2))
    d.e(ctl, lb, "5 section text · template · state", ON + port(3))
    d.e(ctl, trace, "6 trace", ON + port(4))
    d.e(ctl, pvq, "7 AE detected", AE + port(5))
    d.e(pvq, pvt, "notify", AE)
    d.e(srch, emb, "embed query", ON + "strokeWidth=1;exitX=0.5;exitY=0;entryX=0.5;entryY=1;")
    d.e(sec, ctl, "token", GOV)

    d.e(own, vol, "upload", OFF)
    for a, b in [(vol, parse), (parse, split), (split, secs), (secs, prep), (prep, chunks)]:
        d.e(a, b, "", OFF)
    d.e(chunks, srch, "Delta Sync (embeds with Qwen3)", OFF + "exitX=0.5;exitY=0;exitDx=0;exitDy=0;entryX=1;entryY=0.5;entryDx=0;entryDy=0;")
    d.e(secs, lb, "synced table", OFF + "exitX=0.5;exitY=0;exitDx=0;exitDy=0;entryX=1;entryY=0.5;entryDx=0;entryDy=0;")
    d.e(mlr, tpl, "approve", GOV)
    d.e(rev, gov[0], "labels · sign-off", GOV)
    return d.xml()


if __name__ == "__main__":
    for name, fn in [("01-qa-routing-flow", routing_flow), ("02-databricks-architecture", architecture)]:
        with open(f"{name}.drawio", "w") as f:
            f.write(fn())
