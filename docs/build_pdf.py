# -*- coding: utf-8 -*-
"""Render the explainer page to a print-quality PDF.

The artifact page is an HTML fragment with no document shell, and it is designed
for a scrolling screen in either theme. Printing needs three things it does not
have: a real document wrapper, the light palette pinned (a dark PDF is useless
on paper), and page-break rules so a plate never straddles two sheets.

Chrome headless does the rendering because it is the only engine here that
shapes Arabic correctly and honours the web fonts.

    python build_pdf.py
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).parent
SRC = HERE / "how-it-works.html"
TMP = HERE / "how-it-works.print.html"
PDF = HERE / "How Mityaf Works - From Satellite to Street.pdf"

CHROME = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
]

PRINT_CSS = """
<style>
  /* ── print shell ─────────────────────────────────────────────────────── */
  @page { size: A4; margin: 15mm 14mm 16mm; }

  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { padding: 0 !important; font-size: 10.2pt; line-height: 1.55; }
  .wrap { max-width: none !important; }

  /* Keep a heading with the text it introduces, and never strand a plate,
     a callout, or a mechanism card across a sheet boundary. */
  h1, h2, h3 { break-after: avoid-page; page-break-after: avoid; }
  figure, .box, .mcard { break-inside: avoid-page; page-break-inside: avoid; }
  figcaption { break-before: avoid-page; page-break-before: avoid; }
  p, li { orphans: 3; widows: 3; }

  /* On screen the wide tables scroll sideways; on paper they must wrap and
     repeat their header on every sheet they continue onto. Deliberately NOT
     break-inside:avoid -- the glossary tables are half a page each, and
     forcing them whole leaves a page two-thirds empty behind every one. */
  .scroll { overflow: visible !important; }
  table { min-width: 0 !important; font-size: 9pt; }
  thead { display: table-header-group; }
  tr { break-inside: avoid-page; page-break-inside: avoid; }

  /* Each numbered stage opens a fresh sheet -- the document is a sequence of
     stages, so the page break carries the same information the numbering does. */
  h2 { break-before: page; page-break-before: always; margin-top: 0 !important; }
  header + .box + h2, h1 + * h2:first-of-type { break-before: auto; }

  figure { margin: 1.1rem 0; }
  figure svg, figure.plate img { max-height: 172mm; object-fit: contain; }
  h2 { font-size: 17pt; } h3 { font-size: 11.5pt; }
  h1 { font-size: 30pt; }
  .foot { break-inside: avoid-page; }
</style>
"""


def wrap(fragment: str) -> str:
    # data-theme="light" pins the light palette: the page's dark rules are all
    # guarded on :root:not([data-theme="light"]) and :root[data-theme="dark"].
    return (
        '<!doctype html>\n<html lang="en" data-theme="light">\n<head>\n'
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
        '<style>body{margin:0;font:14px system-ui;background:#FBFAF8}'
        'img{max-width:100%}[hidden]{display:none!important}</style>\n'
        f"{fragment}\n{PRINT_CSS}\n</head>\n<body>\n"
        "</body>\n</html>\n"
    )


def main() -> int:
    if not SRC.exists():
        print(f"missing {SRC.name} -- run build_explainer.py first", file=sys.stderr)
        return 1

    chrome = next((p for p in CHROME if Path(p).exists()), None) or shutil.which("chrome")
    if not chrome:
        print("no Chrome or Edge found", file=sys.stderr)
        return 1

    TMP.write_text(wrap(SRC.read_text(encoding="utf-8")), encoding="utf-8")

    profile = HERE / ".chrome-print-profile"
    cmd = [
        chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
        f"--user-data-dir={profile}",
        "--no-pdf-header-footer",
        "--virtual-time-budget=25000",       # let fonts and 1.3 MB of plates settle
        f"--print-to-pdf={PDF}",
        TMP.resolve().as_uri(),
    ]
    t0 = time.time()
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if not PDF.exists():
        print("chrome produced no PDF\n", r.stdout, r.stderr, file=sys.stderr)
        return 1

    shutil.rmtree(profile, ignore_errors=True)
    TMP.unlink(missing_ok=True)
    print(f"  {PDF.name}")
    print(f"  {PDF.stat().st_size/1024/1024:.2f} MB  ({time.time()-t0:.1f}s)")
    print(f"  {PDF.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
