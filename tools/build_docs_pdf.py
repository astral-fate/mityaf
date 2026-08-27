"""Compile a Markdown document to a branded, RTL-correct PDF.

Chrome headless does the typesetting because it is the only renderer on this
machine that shapes Arabic correctly and honours `direction: rtl` on tables —
which matters here, since the model card is mostly tables and every one of
them has to read right to left with its numerals still left to right.

    python tools/build_docs_pdf.py docs/MODEL-CARD.md
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import markdown

HERE = Path(__file__).parent.parent
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
FONTS = HERE.parent / "deck" / "assets" / "fonts" / "plex-local.css"

SHELL = """<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<link rel="stylesheet" href="{fonts}">
<style>
@page {{ size: A4; margin: 18mm 16mm; }}
* {{ box-sizing: border-box; }}
body {{
  font-family: 'IBM Plex Sans Arabic', 'Segoe UI', sans-serif;
  font-size: 10.5pt; line-height: 1.85; color: #10162c; margin: 0;
}}
h1 {{ font-size: 20pt; font-weight: 700; color: #06653d; margin: 0 0 2pt;
     letter-spacing: -.01em; line-height: 1.3; }}
h1 + h1 {{ font-size: 13pt; color: #6b7a6e; font-weight: 500; margin-bottom: 14pt; }}
h2 {{ font-size: 14pt; font-weight: 700; color: #06653d; margin: 20pt 0 7pt;
     padding-bottom: 4pt; border-bottom: 1.5pt solid #d8e6dc; page-break-after: avoid; }}
h3 {{ font-size: 11.5pt; font-weight: 700; margin: 13pt 0 5pt; color: #1a3a2a;
     page-break-after: avoid; }}
p {{ margin: 0 0 7pt; }}
strong {{ color: #06210f; }}
hr {{ border: none; border-top: 1pt solid #e3e9e5; margin: 16pt 0; }}

table {{ width: 100%; border-collapse: collapse; margin: 8pt 0 12pt;
        font-size: 9.5pt; page-break-inside: avoid; }}
th {{ background: #f2f7f4; text-align: right; font-weight: 700; color: #06653d;
     padding: 5pt 8pt; border: 0.75pt solid #d8e6dc; }}
td {{ padding: 5pt 8pt; border: 0.75pt solid #e3e9e5; vertical-align: top; }}
tr:nth-child(even) td {{ background: #fafcfb; }}

/* Latin numerals inside Arabic table cells must not be reordered by the bidi
   algorithm, and columns of digits should line up. */
td, th {{ font-variant-numeric: tabular-nums; }}

code {{ font-family: 'Consolas', ui-monospace, monospace; font-size: 9pt;
       background: #f2f7f4; padding: 1pt 4pt; border-radius: 3pt;
       direction: ltr; unicode-bidi: isolate; display: inline-block; }}
pre {{ background: #0d1f18; color: #d7f0e2; padding: 9pt 12pt; border-radius: 6pt;
      direction: ltr; text-align: left; overflow-x: auto; font-size: 8.5pt;
      line-height: 1.6; page-break-inside: avoid; }}
pre code {{ background: none; color: inherit; padding: 0; display: block; }}

blockquote {{ margin: 9pt 0; padding: 8pt 12pt; background: #fdf6ec;
             border-inline-start: 3pt solid #c9932f; border-radius: 0 5pt 5pt 0; }}
blockquote p {{ margin: 0; }}
ul, ol {{ padding-inline-start: 18pt; margin: 0 0 8pt; }}
li {{ margin-bottom: 3pt; }}
em {{ color: #4a5a52; }}

/* Figures are rendered at 1300-2100 px for the deck; without this they run off
   the page and the right-hand columns are simply lost. */
img {{ display: block; max-width: 100%; height: auto; margin: 10pt auto 4pt;
      border-radius: 4pt; page-break-inside: avoid; }}
p > img + em, img + p em {{ font-size: 9pt; }}
</style></head><body>{body}</body></html>"""


def main() -> None:
    src = Path(sys.argv[1] if len(sys.argv) > 1 else "docs/MODEL-CARD.md")
    if not src.is_absolute():
        src = HERE / src
    out_pdf = src.with_suffix(".pdf")
    tmp_html = src.with_suffix(".tmp.html")

    body = markdown.markdown(
        src.read_text(encoding="utf-8"),
        extensions=["tables", "fenced_code", "attr_list"],
    )
    tmp_html.write_text(
        SHELL.format(body=body, fonts=FONTS.resolve().as_uri()),
        encoding="utf-8",
    )

    subprocess.run(
        [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
         "--no-pdf-header-footer", f"--print-to-pdf={out_pdf}",
         "--virtual-time-budget=12000", tmp_html.as_uri()],
        capture_output=True, timeout=180,
    )
    tmp_html.unlink(missing_ok=True)

    if out_pdf.exists():
        print(f"  {out_pdf.name}  {out_pdf.stat().st_size // 1024} KB")
    else:
        sys.exit("PDF was not produced")


if __name__ == "__main__":
    main()
