"""Download the IBM Plex Sans Arabic webfont files referenced by the Google Fonts
CSS and rewrite the CSS to point at local copies, so the deck exports to PDF
without any network access."""
import re
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
CSS_IN = HERE / "plex.css"
CSS_OUT = HERE / "plex-local.css"

css = CSS_IN.read_text(encoding="utf-8")
urls = sorted(set(re.findall(r"https://fonts\.gstatic\.com/[^)]*\.woff2", css)))
print(f"{len(urls)} font files referenced")

for url in urls:
    name = url.rsplit("/", 1)[-1]
    dest = HERE / name
    if not dest.exists():
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            dest.write_bytes(r.read())
    print(f"  {name}  {dest.stat().st_size:>7,} bytes")
    css = css.replace(url, name)

CSS_OUT.write_text(css, encoding="utf-8")
print(f"\nwrote {CSS_OUT.name} ({len(css):,} chars) with local font refs")
