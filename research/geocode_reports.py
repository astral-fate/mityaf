# -*- coding: utf-8 -*-
"""Geocode the reports that name a street or landmark but carry no coordinates.

Of 46 reports: 12 already have coordinates, 17 carry no location at all (a date
and «شوارع المدينة»), 4 name only a district, and 13 name a real street or
landmark and were never geocoded. This closes that last gap.

What comes back is honestly labelled `geocoded`, NOT `precise`. Nominatim
returns a point on a named road, and «طريق السلام» is kilometres long -- the
point it gives is the road's representative node, not the spot that flooded.
test_madinah.py already showed the three inferred pins carry no signal (p=0.74)
while the three resident-dropped pins do (p=0.003), so these new points test the
geocoding as much as the ranking. They are worth having because they make the
inferred stratum big enough to tell those two apart, not because they add
ground truth.

One exception is genuinely exact: نفق الملك عبدالله is in our own tunnel table
with a real OSM geometry, so it is taken from there rather than searched.

Nominatim's usage policy allows one request per second with an identifying
User-Agent; both are honoured below.

    .venv/Scripts/python.exe geocode_reports.py
"""
from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

HERE = Path(__file__).parent
OUT = HERE / "out" / "incidents" / "geocoded_reports.json"
UA = "mityaf-research/1.0 (flood-risk study, Al Madinah)"
BBOX = (39.50, 24.36, 39.72, 24.58)          # W, S, E, N -- our AOI

# query text -> the report(s) it belongs to. Written out rather than derived so
# each search string is deliberate: "طريق السلام" alone returns the whole road,
# while "طريق السلام قربان" pins the junction the report actually names.
QUERIES = [
    ("2022-08-20", "قباء", "شارع الإمام مسلم، المدينة المنورة"),
    ("2015-11-19", "الغربية", "حي الغربية، المدينة المنورة"),
    ("2018-02-25", "العزيزية", "طريق الهجرة، سلطانة، المدينة المنورة"),
    ("2024-04-30", "السلام", "طريق السلام، المدينة المنورة"),
    ("2024-08-31", "المركزية", "البقيع، المدينة المنورة"),
    ("2025-01-06", "السلام", "طريق السلام تقاطع طريق الجامعات، المدينة المنورة"),
    ("2025-12-09", "التلعة", "الطريق الدائري الثاني، المدينة المنورة"),
    ("2019-03-16", "قباء", "شارع صلاح الدين الأيوبي، المدينة المنورة"),
    ("2019-06-09", "طيبة", "حي طيبة، المدينة المنورة"),
    ("2024-08-29", "السلام", "قربان، المدينة المنورة"),
    ("2025-12-03", "السلام", "حي السلام، المدينة المنورة"),
    ("2026-08-25", "السلام", "طريق الجامعات، المدينة المنورة"),
]


def nominatim(q: str) -> dict | None:
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({
        "q": q, "format": "json", "limit": 1, "countrycodes": "sa",
        "viewbox": ",".join(map(str, (BBOX[0], BBOX[3], BBOX[2], BBOX[1]))),
        "bounded": 1})
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=30))
    except Exception as e:                                       # noqa: BLE001
        print(f"      request failed: {type(e).__name__}: {e}")
        return None
    return r[0] if r else None


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    rows = []

    # the tunnel is exact -- take it from our own table, do not search for it
    tun = pd.read_csv(HERE / "out" / "shortlist" / "type3_tunnels.csv")
    kaa = tun[tun.name_ar.fillna("").str.contains("عبدالله", na=False)]
    if len(kaa):
        t = kaa.iloc[0]
        rows.append({"date": "2015-05-05", "district": t.district_ar,
                     "query": "نفق الملك عبدالله (from our own OSM tunnel table)",
                     "lat": float(t.lat), "lon": float(t.lon),
                     "quality": "exact", "osm_type": "tunnel_table",
                     "display_name": str(t.name_ar)})
        print(f"  نفق الملك عبدالله        {t.lat:.5f}, {t.lon:.5f}   exact (our table)")

    print(f"\ngeocoding {len(QUERIES)} named locations via Nominatim "
          f"(1 req/s, bounded to the AOI)\n")
    for date, district, q in QUERIES:
        r = nominatim(q)
        time.sleep(1.1)                                   # usage policy
        if not r:
            print(f"  {q[:42]:44} NOT FOUND")
            rows.append({"date": date, "district": district, "query": q,
                         "lat": None, "lon": None, "quality": "not_found"})
            continue
        lat, lon = float(r["lat"]), float(r["lon"])
        rows.append({"date": date, "district": district, "query": q,
                     "lat": lat, "lon": lon, "quality": "geocoded",
                     "osm_type": r.get("osm_type"),
                     "display_name": r.get("display_name", "")[:90]})
        print(f"  {q[:42]:44} {lat:.5f}, {lon:.5f}  ({r.get('osm_type')})")

    ok = [r for r in rows if r.get("lat")]
    OUT.write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"\n{len(ok)} of {len(rows)} located -> {OUT.name}")
    print("\nQuality ladder now on record:")
    print("  exact     1  — from our own OSM geometry (the tunnel)")
    print(f"  precise   3  — a resident dropped the pin on the spot")
    print(f"  geocoded  {len([r for r in ok if r['quality']=='geocoded'])}  "
          f"— a point on a named road, NOT the spot that flooded")
    print("  approx    3  — inferred earlier from post text")
    print("\nOnly the first two can test the ranking. The rest test our geocoding.")


if __name__ == "__main__":
    main()
