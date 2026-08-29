#!/usr/bin/env python
"""Compile the Arabic documentation to PDF.

Chromium renders the same file the artifact serves, so the PDF and the web
version can never drift. The `@media print` block in the HTML does the
pagination work; this script only drives the browser.

    pip install playwright && playwright install chromium
    python build-pdf.py
"""
from pathlib import Path

from playwright.sync_api import sync_playwright

import sys

HERE = Path(__file__).parent.resolve()
STEM = sys.argv[1] if len(sys.argv) > 1 else "mityaf-documentation-ar"
SRC = HERE / f"{STEM}.html"
OUT = HERE / f"{STEM}.pdf"

# Chromium's page.pdf() ignores <title>; the footer template is the only place
# to put running page numbers, and it needs inline styles.
FOOTER_TPL = """
<div style="width:100%;font-family:sans-serif;font-size:7.5pt;color:#8A929E;
            padding:0 15mm;display:flex;justify-content:space-between;
            direction:ltr;">
  <span>__FOOTER__</span>
  <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
</div>"""

HEADER = '<div style="display:none"></div>'


TITLES = {"mityaf-documentation-ar": "مِطياف — التوثيق الشامل",
          "mityaf-chapter-en": "Mityaf — Measuring Where Water Will Stand"}
TITLE = TITLES.get(STEM, STEM)


def main():
    if not SRC.exists():
        raise SystemExit(f"missing source: {SRC}")

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(
            viewport={"width": 1240, "height": 1754},
            # the document has a dark palette behind a media query; a PDF is
            # printed on white paper, so pin the light one
            color_scheme="light",
        )
        page.goto(SRC.as_uri(), wait_until="networkidle", timeout=90_000)
        # Google Fonts arrive over the network — do not print before they land,
        # or the Arabic falls back to a system face mid-render
        page.evaluate("document.fonts.ready")
        page.wait_for_timeout(2500)
        page.emulate_media(media="print")

        page.pdf(
            path=str(OUT),
            format="A4",
            print_background=True,
            prefer_css_page_size=True,
            display_header_footer=True,
            header_template=HEADER,
            footer_template=FOOTER_TPL.replace("__FOOTER__", TITLE),
            margin={"top": "17mm", "bottom": "18mm", "left": "15mm", "right": "15mm"},
        )
        browser.close()

    print(f"{OUT.name}  {OUT.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
