"""Render BRD-Masareb-v1.0.md to a branded, print-ready Arabic PDF.

Uses the برمجان المنورة identity from ../../deck/style.css: a dark cover page,
then a light body that prints and annotates well. Fonts are the same local
IBM Plex Sans Arabic webfonts the deck embeds, so the PDF needs no network.

    python build_brd.py
"""
import re
import shutil
import subprocess
import sys
from pathlib import Path

import markdown

HERE = Path(__file__).parent.resolve()
DECK_FONTS = HERE.parent.parent / "deck" / "assets" / "fonts"
SRC = HERE / "BRD-Masareb-v1.0.md"
HTML = HERE / "BRD-Masareb-v1.0.html"
PDF = HERE / "BRD-Masareb-v1.0.pdf"
FONTS = HERE / "assets" / "fonts"

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]

CSS = """
@import url("assets/fonts/plex-local.css");

:root{
  --neon:#50FF4A; --cyan:#00C4D5; --grass:#2A9759; --forest:#06653D;
  --ink:#010628; --ink-2:#020A2F; --ink-4:#081F64;
  --sand:#E5CDB0; --sand-mid:#B0865C; --sand-deep:#76683C;
  --danger:#C0392B; --warn:#B7791F;
  --text:#15203A; --text-soft:#4A5878; --rule:#DCE3F0; --bg-soft:#F5F8FD;
  --font:"IBM Plex Sans Arabic","Segoe UI",Tahoma,sans-serif;
}

*{margin:0;padding:0;box-sizing:border-box}
html{direction:rtl}
body{font-family:var(--font);color:var(--text);font-size:10.5pt;line-height:1.75;
     background:#fff;-webkit-font-smoothing:antialiased}

@page{size:A4;margin:18mm 16mm}
@page:first{margin:0}

.num{font-variant-numeric:tabular-nums;direction:ltr;unicode-bidi:isolate;display:inline-block}

/* ─── cover ─── */
.cover{
  position:relative;width:210mm;height:297mm;margin:0 0 0 0;
  page-break-after:always;break-after:page;overflow:hidden;
  background:
    radial-gradient(760px 560px at 88% -8%,rgba(80,255,74,.16),transparent 62%),
    radial-gradient(680px 520px at 4% 106%,rgba(0,196,213,.17),transparent 60%),
    linear-gradient(160deg,var(--ink) 0%,var(--ink-2) 55%,#01041c 100%);
  color:#fff;padding:36mm 22mm;display:flex;flex-direction:column;
  -webkit-print-color-adjust:exact;print-color-adjust:exact;
}
.cover .eyebrow{font-size:12pt;font-weight:600;color:var(--neon);margin-bottom:10mm;
  display:flex;align-items:center;gap:5mm}
.cover .eyebrow::before{content:"";width:16mm;height:1.2mm;border-radius:1mm;
  background:linear-gradient(90deg,var(--neon),transparent)}
/* must come after the generic h1 rule wins nothing: cover text is on dark */
.cover h1{font-size:46pt;font-weight:700;line-height:1.06;letter-spacing:-.02em;
  color:#fff;border:none;padding:0;margin:0}
.cover .sub{font-size:15pt;color:#A9B6D4;margin-top:7mm;line-height:1.5}
.cover .rule{width:38mm;height:1.6mm;border-radius:1mm;margin:12mm 0;
  background:linear-gradient(90deg,var(--neon),var(--cyan))}
.cover .meta{margin-top:auto;font-size:10.5pt;color:#8FA0C4;line-height:2}
.cover .meta b{color:#fff;font-weight:600}
.cover .foot{position:absolute;bottom:20mm;left:22mm;right:22mm;
  display:flex;justify-content:space-between;font-size:10pt;color:#6B7A9E;
  border-top:.3mm solid rgba(169,182,212,.22);padding-top:5mm}

/* ─── headings ─── */
h1,h2,h3,h4{line-height:1.3;font-weight:700;color:var(--ink)}
h1{font-size:20pt;margin:0 0 4mm;padding-bottom:3mm;border-bottom:.8mm solid var(--neon)}
h2{font-size:15pt;margin:9mm 0 3.5mm;padding-right:4mm;border-right:1.2mm solid var(--neon);
   page-break-after:avoid;break-after:avoid}
h3{font-size:12pt;margin:6mm 0 2.5mm;color:var(--forest);
   page-break-after:avoid;break-after:avoid}
h4{font-size:10.5pt;margin:4mm 0 2mm;color:var(--text-soft)}

p{margin:0 0 3mm}
strong,b{font-weight:700;color:var(--ink)}
a{color:var(--grass);text-decoration:none}

hr{border:none;border-top:.3mm solid var(--rule);margin:8mm 0}

ul,ol{margin:0 0 3.5mm;padding-right:6mm}
li{margin-bottom:1.6mm}
ul li::marker{color:var(--grass)}

blockquote{border-right:1mm solid var(--cyan);background:var(--bg-soft);
  padding:3.5mm 5mm;margin:0 0 4mm;color:var(--text-soft);border-radius:0 2mm 2mm 0}
blockquote strong{color:var(--ink)}

code{font-family:"IBM Plex Sans Arabic",Consolas,monospace;font-size:9.5pt;
  background:var(--bg-soft);border:.2mm solid var(--rule);border-radius:1mm;
  padding:.4mm 1.4mm;color:var(--forest);direction:ltr;unicode-bidi:isolate;
  display:inline-block}

/* ─── tables ─── */
table{width:100%;border-collapse:collapse;margin:0 0 5mm;font-size:9.5pt;
  page-break-inside:auto}
thead{display:table-header-group}
tr{page-break-inside:avoid;break-inside:avoid}
th{background:var(--ink);color:#fff;font-weight:600;text-align:right;
   padding:2.4mm 3mm;font-size:9.5pt;
   -webkit-print-color-adjust:exact;print-color-adjust:exact}
th:first-child{border-radius:0 1.5mm 0 0}
th:last-child{border-radius:1.5mm 0 0 0}
td{padding:2.2mm 3mm;border-bottom:.2mm solid var(--rule);vertical-align:top;
   line-height:1.6}
tbody tr:nth-child(even){background:var(--bg-soft)}
td:first-child{font-weight:600;color:var(--ink)}

/* requirement id chips: FR-01 / NFR-02 / BR-03 / BP-01 / R-04 ... */
.rid{display:inline-block;white-space:nowrap;font-weight:700;font-size:9pt;
  color:var(--forest);background:rgba(42,151,89,.10);
  border:.2mm solid rgba(42,151,89,.30);border-radius:1.2mm;padding:.2mm 1.3mm;
  direction:ltr;unicode-bidi:isolate;font-variant-numeric:tabular-nums;
  -webkit-print-color-adjust:exact;print-color-adjust:exact}
/* the id column must never be the one that wraps */
td:first-child{white-space:nowrap}

/* MoSCoW priority words */
.pr-must{color:var(--danger);font-weight:700}
.pr-should{color:var(--warn);font-weight:700}
.pr-could{color:var(--text-soft);font-weight:600}

section.doc{page-break-before:auto}
"""

COVER = """
<div class="cover">
  <div class="eyebrow">وثيقة متطلبات الأعمال · Business Requirements Document</div>
  <h1>مَـسـارب</h1>
  <div class="sub">
    منصّة رصد المياه الحضرية<br>بالأقمار الصناعية والذكاء الاصطناعي
  </div>
  <div class="rule"></div>
  <div class="meta">
    الإصدار <b>v1.0</b> &nbsp;·&nbsp; <b>26 أغسطس 2026</b><br>
    الجهة المستفيدة: <b>أمانة منطقة المدينة المنورة</b><br>
    السياق: <b>برمجان المنورة 2026</b> — مسار المتابعة الذكية للخدمات
  </div>
  <div class="foot">
    <div>صفر عتاد &nbsp;·&nbsp; تغطية المدينة كاملة &nbsp;·&nbsp; كل <span class="num">5</span> أيام</div>
    <div>مُعتمدة للتنفيذ</div>
  </div>
</div>
"""

RID = re.compile(r"\b((?:FR|NFR|BR|BP|BO|MO|UJ|INT|R)-\d{2})\b")
PRIORITY = {"Must": "pr-must", "Should": "pr-should", "Could": "pr-could", "Won't": "pr-could"}


def find_chrome() -> str:
    for c in CHROME_CANDIDATES:
        if Path(c).exists():
            return c
    sys.exit("Chrome/Edge not found")


def decorate(html: str) -> str:
    """Wrap requirement ids and MoSCoW words in styled chips, but never inside a tag."""
    parts = re.split(r"(<[^>]+>)", html)
    for i, chunk in enumerate(parts):
        if chunk.startswith("<"):
            continue
        chunk = RID.sub(r'<span class="rid">\1</span>', chunk)
        for word, cls in PRIORITY.items():
            chunk = re.sub(rf"\b{re.escape(word)}\b", f'<span class="{cls}">{word}</span>', chunk)
        parts[i] = chunk
    return "".join(parts)


def main() -> None:
    # local fonts, so the PDF renders with no network
    FONTS.parent.mkdir(exist_ok=True)
    if not FONTS.exists():
        shutil.copytree(DECK_FONTS, FONTS)
    print(f"fonts   : {len(list(FONTS.glob('*.woff2')))} woff2 files")

    md_text = SRC.read_text(encoding="utf-8")
    # the H1 title block lives on the cover, not in the body
    md_text = re.sub(r"\A# .*?\n## .*?\n", "", md_text, count=1, flags=re.S)

    body = markdown.markdown(
        md_text,
        extensions=["tables", "attr_list", "sane_lists", "md_in_html"],
        output_format="html5",
    )
    # A heading like "9.3 الوحدة أ" starts with a European-number run, which the
    # bidi algorithm parks on the LEFT of an RTL line. An RLM before it pins the
    # section number to the right, which is what Arabic numbered headings expect.
    body = re.sub(r"(<h[1-4][^>]*>)(?=\s*[0-9])", r"\1&#x200F;", body)
    body = decorate(body)

    html = (
        '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">'
        "<title>BRD — مَسارب v1.0</title>"
        f"<style>{CSS}</style></head><body>"
        f'{COVER}<section class="doc">{body}</section>'
        "</body></html>"
    )
    HTML.write_text(html, encoding="utf-8")
    print(f"html    : {HTML.name} ({len(html):,} chars)")

    if PDF.exists():
        PDF.unlink()
    subprocess.run(
        [
            find_chrome(), "--headless=new", "--disable-gpu", "--no-sandbox",
            "--no-pdf-header-footer", "--run-all-compositor-stages-before-draw",
            "--virtual-time-budget=15000",
            f"--print-to-pdf={PDF}", HTML.as_uri(),
        ],
        capture_output=True, text=True, timeout=180,
    )
    if not PDF.exists():
        sys.exit("PDF was not produced")
    print(f"pdf     : {PDF.name} ({PDF.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
