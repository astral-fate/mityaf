# -*- coding: utf-8 -*-
"""Geocode report locations against our OWN OSM dump, in both languages.

geocode_reports.py queried Nominatim in Arabic and reported eight of thirteen
streets "absent from OSM". That was wrong, and the error was mine: many Madinah
ways carry only an English or transliterated name. «شارع صلاح الدين الأيوبي» is
in the dump as "Salahedin Al Ayubi Road"; «طريق سلطانة» as "Sultana Road". An
Arabic-only search finds neither.

This searches every name-bearing tag -- name, name:en, name:ar, alt_name and the
Turkish/Turkmen variants that appear on pilgrimage routes -- against Arabic
needles AND their common transliterations, then returns the centroid of the
matched ways.

The real coverage number, now measured rather than assumed: only 791 of 18,320
ways (4%) carry any name at all. That is the honest limit, and it is a much
harder constraint than "these particular streets are missing".

Quality stays `geocoded`: the centroid of a 2 km road is not the spot that
flooded. But it comes from our own geometry rather than a remote search, and it
is reproducible offline.

    .venv/Scripts/python.exe geocode_local.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
OUT = HERE / "out" / "incidents" / "geocoded_local.json"

# date, district, label, [needles in any language]
TARGETS = [
    ("2019-03-16", "قباء", "شارع صلاح الدين الأيوبي",
     ["صلاح الدين", "salahedin", "salah al", "ayubi", "ayyubi"]),
    ("2018-02-25", "العزيزية", "طريق الهجرة / سلطانة",
     ["سلطانة", "sultana"]),
    ("2024-08-29", "السلام", "شارع السلام / قربان",
     ["شارع السلام", "assalam", "as salam"]),
    ("2025-12-03", "السلام", "حي السلام",
     ["شارع السلام", "assalam", "as salam"]),
    ("2022-08-20", "قباء", "شارع الإمام مسلم",
     ["الإمام مسلم", "imam muslim"]),
    ("2015-11-19", "الغربية", "حي الغربية",
     ["الغربية", "gharbiy", "gharbia"]),
    ("2019-06-09", "طيبة", "حي طيبة",
     ["طيبة", "taybah", "taibah", "tayba"]),
    ("2026-08-25", "السلام", "طريق الجامعات",
     ["الجامعات", "universit", "jamiat"]),
    ("2025-12-09", "التلعة", "الطريق الدائري الثاني",
     ["الدائري الثاني", "second ring", "2nd ring"]),
]


def main() -> None:
    ways = json.loads((HERE / "cache" / "madinah" / "roads.json")
                      .read_text(encoding="utf-8"))["elements"]
    named = [w for w in ways
             if any("name" in k for k in w.get("tags", {})) and w.get("geometry")]
    print(f"{len(ways):,} ways in the dump, {len(named):,} named with geometry "
          f"({len(named)/len(ways):.0%})\n")

    rows = []
    for date, district, label, needles in TARGETS:
        hits = []
        for w in named:
            t = w["tags"]
            blob = " | ".join(v for k, v in t.items() if "name" in k).lower()
            if any(n.lower() in blob for n in needles):
                hits.append(w)
        if not hits:
            print(f"  {label:26} NOT IN THE DUMP (checked both languages)")
            rows.append({"date": date, "district": district, "label": label,
                         "lat": None, "lon": None, "quality": "absent_from_osm"})
            continue
        pts = np.array([[p["lat"], p["lon"]] for w in hits for p in w["geometry"]])
        lat, lon = pts.mean(axis=0)
        name = " | ".join(v for k, v in hits[0]["tags"].items() if "name" in k)[:58]
        rows.append({"date": date, "district": district, "label": label,
                     "lat": float(lat), "lon": float(lon), "quality": "geocoded",
                     "n_ways": len(hits), "n_nodes": int(len(pts)),
                     "matched_as": name,
                     "span_km": float(np.ptp(pts, axis=0).max() * 111)})
        print(f"  {label:26} {lat:.5f}, {lon:.5f}   {len(hits):3} ways, "
              f"span {np.ptp(pts, axis=0).max()*111:.1f} km")
        print(f"  {'':26} matched as: {name}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8")
    ok = [r for r in rows if r.get("lat")]
    print(f"\n{len(ok)} of {len(rows)} located from our own dump -> {OUT.name}")
    absent = [r["label"] for r in rows if not r.get("lat")]
    if absent:
        print(f"genuinely absent from OSM: {', '.join(absent)}")
    print("\nNote the span column. A centroid of a road several km long is a")
    print("district-scale point, not a street-scale one -- which is why these")
    print("stay 'geocoded' and never become 'precise'.")


if __name__ == "__main__":
    main()
