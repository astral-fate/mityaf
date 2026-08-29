"""Download open-access PDFs for every work cited or considered for the paper.

Nothing here circumvents a paywall. Closed works are reported in the manifest
with their DOI so they can be pulled through an institutional subscription.

Two things defeat a naive urllib fetch, and both are handled here:

*Bot blocking.* MDPI, Taylor & Francis and Wiley return 403 to a default
urllib User-Agent even for fully open articles. Requests therefore go through
Playwright's browser request context, which is already a project dependency
(the docs PDFs are built with it).

*Landing pages.* OpenAlex often reports the HTML article page rather than the
PDF. Publisher-specific URL patterns are tried first, since they are far more
reliable than following the landing page.

OpenAlex is used rather than Unpaywall because Unpaywall requires an email
address in the query string, and the user's address is not ours to hand to a
third-party service.

    python fetch_references.py            # download what is open
    python fetch_references.py --dry-run  # report availability only
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from works import WORKS

HERE = Path(__file__).parent
OUT = HERE / "references"
MANIFEST = HERE / "REFERENCES.md"
API_UA = {"User-Agent": "mityaf-reference-fetch/1.0 (academic use)"}


def pdf_candidates(doi: str | None, arx: str | None,
                   oa_urls: list[str]) -> list[str]:
    """Every URL worth trying, most reliable first."""
    urls: list[str] = []
    if arx:
        urls.append(f"https://arxiv.org/pdf/{arx}")
    if doi:
        urls += europepmc(doi)
        urls += semanticscholar(doi)
    urls += [u for u in oa_urls if "mdpi.com" not in u]
    if doi:
        d = doi.lower()
        if d.startswith("10.3390/"):                       # MDPI
            for u in oa_urls:
                if "mdpi.com" in u:
                    urls.append(u.rstrip("/") + "/pdf")
        elif d.startswith("10.1038/"):                     # Nature / Sci Rep
            urls.append(f"https://www.nature.com/articles/{d.split('/', 1)[1]}.pdf")
        elif d.startswith("10.1371/"):                     # PLOS
            urls.append("https://journals.plos.org/plosone/article/file"
                        f"?id={doi}&type=printable")
        elif d.startswith(("10.1080/", "10.1002/", "10.1111/")):  # T&F, Wiley
            urls.append(f"https://www.tandfonline.com/doi/pdf/{doi}")
        elif d.startswith("10.1007/") or d.startswith("10.1186/"):  # Springer
            urls.append(f"https://link.springer.com/content/pdf/{doi}.pdf")
        elif d.startswith("10.1088/"):                     # IOP
            urls.append(f"https://iopscience.iop.org/article/{doi}/pdf")
    # de-duplicate, keep order
    seen, out = set(), []
    for u in urls:
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def openalex(doi: str) -> tuple[list[str], bool]:
    """(every open-access URL OpenAlex knows, is_oa).

    Publisher sites are the most likely to block a script; repository and
    preprint copies of the same article usually are not. So we take every
    location, not just `best_oa_location`, and put non-publisher hosts first.
    """
    url = f"https://api.openalex.org/works/doi:{urllib.parse.quote(doi)}"
    try:
        req = urllib.request.Request(url, headers=API_UA)
        w = json.load(urllib.request.urlopen(req, timeout=45))
    except Exception:                                          # noqa: BLE001
        return [], False

    pub, repo = [], []
    for loc in (w.get("locations") or []):
        if not loc.get("is_oa"):
            continue
        u = loc.get("pdf_url") or loc.get("landing_page_url")
        if not u:
            continue
        (pub if loc.get("is_published_version") else repo).append(u)
    return repo + pub, bool(w.get("open_access", {}).get("is_oa"))


def semanticscholar(doi: str) -> list[str]:
    """Semantic Scholar's openAccessPdf link.

    Worth a separate call because it often points at a repository mirror of an
    article whose publisher site blocks scripts -- MDPI in particular.
    """
    q = (f"https://api.semanticscholar.org/graph/v1/paper/DOI:{doi}"
         "?fields=openAccessPdf,externalIds")
    try:
        req = urllib.request.Request(q, headers=API_UA)
        r = json.load(urllib.request.urlopen(req, timeout=45))
    except Exception:                                          # noqa: BLE001
        return []
    out = []
    if (oap := r.get("openAccessPdf")) and oap.get("url"):
        out.append(oap["url"])
    if (ax := (r.get("externalIds") or {}).get("ArXiv")):
        out.append(f"https://arxiv.org/pdf/{ax}")
    return out


def europepmc(doi: str) -> list[str]:
    """Free full-text PDF links from Europe PMC, which does not block scripts."""
    q = ("https://www.ebi.ac.uk/europepmc/webservices/rest/search?"
         + urllib.parse.urlencode({"query": f'DOI:"{doi}"', "resultType": "core",
                                   "format": "json", "pageSize": 1}))
    try:
        req = urllib.request.Request(q, headers=API_UA)
        res = json.load(urllib.request.urlopen(req, timeout=45))
    except Exception:                                          # noqa: BLE001
        return []
    out = []
    for r in res.get("resultList", {}).get("result", []):
        for g in r.get("fullTextUrlList", {}).get("fullTextUrl", []):
            if g.get("documentStyle") == "pdf" and g.get("availability") in (
                    "Free", "Open access"):
                out.append(g["url"])
        if r.get("pmcid"):
            out.append("https://www.ebi.ac.uk/europepmc/webservices/rest/"
                       f"{r['pmcid']}/fullTextPDF")
    return out


def main() -> None:
    from playwright.sync_api import sync_playwright

    dry = "--dry-run" in sys.argv
    OUT.mkdir(exist_ok=True)
    rows = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                       "AppleWebKit/537.36 (KHTML, like Gecko) "
                       "Chrome/126.0 Safari/537.36",
            accept_downloads=True)

        page = ctx.new_page()
        warmed: set[str] = set()

        def warm(url: str) -> None:
            """Visit a publisher's page once so its cookies are set.

            MDPI and several others return 403 to a bare request but serve the
            same PDF happily once a real navigation has established a session.
            """
            host = urllib.parse.urlparse(url).netloc
            if host in warmed:
                return
            warmed.add(host)
            try:
                page.goto(f"https://{host}/", wait_until="domcontentloaded",
                          timeout=45_000)
                page.wait_for_timeout(1200)
            except Exception:                                   # noqa: BLE001
                pass

        for key, cite, doi, arx in WORKS:
            dest = OUT / f"{key}.pdf"
            if dest.exists() and dest.stat().st_size > 20_000:
                rows.append((key, cite, doi, arx, "have",
                             f"{dest.stat().st_size / 1024:.0f} KB"))
                print(f"  have    {key}")
                continue

            oa_urls, is_oa = ([], True) if arx else openalex(doi) if doi else ([], False)
            if doi and not arx:
                time.sleep(0.25)
            if not is_oa and not arx:
                rows.append((key, cite, doi, arx, "closed", "not open access"))
                print(f"  CLOSED  {key}")
                continue

            got = False
            note = "no working PDF url"
            for url in pdf_candidates(doi, arx, oa_urls):
                if dry:
                    note = url
                    got = True
                    break
                warm(url)
                try:
                    r = ctx.request.get(url, timeout=90_000)
                    body = r.body()
                except Exception as e:                          # noqa: BLE001
                    note = str(e)[:45]
                    continue
                if r.status == 403:
                    # Some publishers only serve the PDF to a real navigation.
                    try:
                        resp = page.goto(url, wait_until="commit", timeout=90_000)
                        if resp and resp.ok:
                            body = resp.body()
                            if body[:4] == b"%PDF":
                                dest.write_bytes(body)
                                note = f"{len(body) / 1024:.0f} KB (navigated)"
                                got = True
                                break
                    except Exception:                           # noqa: BLE001
                        pass
                if r.ok and body[:4] == b"%PDF":
                    dest.write_bytes(body)
                    note = f"{len(body) / 1024:.0f} KB"
                    got = True
                    break
                # HTML came back — look for a citation_pdf_url meta tag
                if r.ok and b"citation_pdf_url" in body[:200_000]:
                    m = re.search(rb'citation_pdf_url"\s+content="([^"]+)"', body)
                    if m:
                        try:
                            r2 = ctx.request.get(m.group(1).decode(), timeout=90_000)
                            b2 = r2.body()
                            if r2.ok and b2[:4] == b"%PDF":
                                dest.write_bytes(b2)
                                note = f"{len(b2) / 1024:.0f} KB (via meta tag)"
                                got = True
                                break
                        except Exception:                       # noqa: BLE001
                            pass
                note = f"HTTP {r.status}" if not r.ok else "landing page only"

            rows.append((key, cite, doi, arx, "got" if got else "failed", note))
            print(f"  {'GOT   ' if got else 'FAILED'}  {key}  {note[:60]}")

        browser.close()

    held = [r for r in rows if r[4] in ("got", "have")]
    # Open access, but the publisher refuses scripted requests. MDPI is the
    # main offender; the article is free and downloads in one click by hand.
    blocked = [r for r in rows if r[4] == "failed"
               and (r[2] or "").lower().startswith("10.3390/")]
    closed = [r for r in rows
              if r[4] in ("closed", "failed") and r not in blocked]

    def ref(d, a):
        return f"[`{d}`](https://doi.org/{d})" if d else \
            f"[arXiv:{a}](https://arxiv.org/abs/{a})"

    lines = ["# Reference library", "",
             f"**{len(held)} of {len(rows)}** works are held locally as PDFs in "
             "`references/`, named by their BibTeX key.", "",
             "Resolved through OpenAlex, Semantic Scholar, Europe PMC and arXiv. "
             "Nothing here was obtained by circumventing a paywall.", "",
             "Regenerate with `python fetch_references.py` — files already "
             "present are skipped, so it is safe to re-run.", "",
             "## Held locally", "", "| key | citation | reference |", "|---|---|---|"]
    for k, c, d, a, _, _ in held:
        lines.append(f"| `{k}` | {c} | {ref(d, a)} |")

    if blocked:
        lines += ["", "## Free, but download by hand", "",
                  "These are fully open access. MDPI serves a 403 to any "
                  "scripted request, so the PDF has to be fetched in a browser "
                  "— follow the link and use the *Download PDF* button. No "
                  "subscription needed.", "",
                  "| key | citation | article |", "|---|---|---|"]
        for k, c, d, a, _, _ in blocked:
            lines.append(f"| `{k}` | {c} | {ref(d, a)} |")

    if closed:
        lines += ["", "## Needs institutional access", "",
                  "Closed access behind Elsevier, IEEE, Wiley or Springer. Use a "
                  "university subscription, or email the corresponding author — "
                  "most send a copy on request, and for several of these the "
                  "author's own page carries a free preprint.", "",
                  "| key | citation | reference |", "|---|---|---|"]
        for k, c, d, a, _st, _note in closed:
            lines.append(f"| `{k}` | {c} | {ref(d, a)} |")

    MANIFEST.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\n{len(held)} held · {len(blocked)} free but blocked · "
          f"{len(closed)} closed")
    print(f"manifest -> {MANIFEST.name}")


if __name__ == "__main__":
    main()
