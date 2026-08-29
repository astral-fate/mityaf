"""Fetch the MDPI open-access articles that the generic fetcher cannot reach.

MDPI journals (Land, Remote Sensing, Water, IJGI) are fully open access, but
their /pdf endpoint returns 403 to a scripted request. Navigating the article
page first in a real browser session clears that, so this script drives an
actual page visit and then follows the PDF link the page itself exposes.

    python fetch_mdpi.py
"""
from __future__ import annotations

from pathlib import Path

from works import WORKS

HERE = Path(__file__).parent
OUT = HERE / "references"

TARGETS = [(k, d) for k, _c, d, _a in WORKS
           if d and d.lower().startswith("10.3390/")]


def main() -> None:
    from playwright.sync_api import sync_playwright

    OUT.mkdir(exist_ok=True)
    todo = [(k, d) for k, d in TARGETS if not (OUT / f"{k}.pdf").exists()]
    if not todo:
        print("nothing to do — all MDPI works already held")
        return

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                       "AppleWebKit/537.36 (KHTML, like Gecko) "
                       "Chrome/126.0 Safari/537.36",
            viewport={"width": 1400, "height": 900},
            locale="en-US")
        page = ctx.new_page()

        for key, doi in todo:
            dest = OUT / f"{key}.pdf"
            try:
                # doi.org redirects to the mdpi article page
                page.goto(f"https://doi.org/{doi}", wait_until="domcontentloaded",
                          timeout=90_000)
                page.wait_for_timeout(2500)
                art = page.url.split("?")[0].rstrip("/")

                # the page advertises its own PDF in a meta tag
                href = page.evaluate(
                    """() => {
                        const m = document.querySelector(
                            'meta[name="citation_pdf_url"]');
                        if (m) return m.content;
                        const a = document.querySelector('a[href*="/pdf"]');
                        return a ? a.href : null;
                    }""")
                url = href or f"{art}/pdf"

                r = ctx.request.get(url, timeout=90_000)
                body = r.body()
                if r.ok and body[:4] == b"%PDF":
                    dest.write_bytes(body)
                    print(f"  GOT     {key}  {len(body) / 1024:.0f} KB")
                    continue
                print(f"  FAILED  {key}  HTTP {r.status} at {url[:70]}")
            except Exception as e:                             # noqa: BLE001
                print(f"  FAILED  {key}  {str(e)[:60]}")

        browser.close()

    print(f"\n{len(list(OUT.glob('*.pdf')))} PDFs held")


if __name__ == "__main__":
    main()
