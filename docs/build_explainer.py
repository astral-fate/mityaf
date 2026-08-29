# -*- coding: utf-8 -*-
"""Inline the rendered plates into the explainer page.

The source page carries `<!--FIG:name.png|alt text-->` placeholders so it stays
readable and editable; this replaces each with a base64 data URI. Artifacts are
a single self-contained file, so the images have to travel inside it.

    python build_explainer.py
"""
from __future__ import annotations

import base64
import html
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
SRC = HERE / "how-it-works.src.html"
DST = HERE / "how-it-works.html"
FIGS = HERE / "figs"
CAP = 16 * 1024 * 1024

PLACEHOLDER = re.compile(r"<!--FIG:([^|]+)\|([^>]*?)-->")


def main() -> int:
    page = SRC.read_text(encoding="utf-8")
    missing, used = [], []

    def sub(m: re.Match) -> str:
        name, alt = m.group(1).strip(), m.group(2).strip()
        p = FIGS / name
        if not p.exists():
            missing.append(name)
            return m.group(0)
        used.append((name, p.stat().st_size))
        b64 = base64.b64encode(p.read_bytes()).decode("ascii")
        return (f'<img src="data:image/png;base64,{b64}" '
                f'alt="{html.escape(alt)}" loading="lazy">')

    out = PLACEHOLDER.sub(sub, page)

    if missing:
        print("MISSING plates:", ", ".join(missing), file=sys.stderr)
        return 1
    if not used:
        print("no placeholders found -- did the source change?", file=sys.stderr)
        return 1

    DST.write_text(out, encoding="utf-8")
    size = DST.stat().st_size
    for name, raw in used:
        print(f"  inlined {name:26} {raw/1024:6.0f} KB")
    print(f"\n  {len(used)} plates -> {DST.name}  {size/1024/1024:.2f} MB "
          f"({size/CAP:.0%} of the 16 MB artifact cap)")
    return 0 if size < CAP else 1


if __name__ == "__main__":
    raise SystemExit(main())
