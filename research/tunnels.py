"""Type 3 -- underpasses and tunnels, the mechanism the terrain filters cannot see.

A Saudi source (SPA, 5 May 2015) records an engineering project at
نفق الملك عبدالله to drain "تجمع مائي حاد داخل النفق" -- severe water
accumulation inside the main tunnel -- explicitly to stop vehicles being
submerged. OSM has that tunnel tagged at 24.49611, 39.60850 and the pipeline
was ignoring the tag.

An underpass is the lowest point on its road *by construction*, not by
topography. The DEM cannot see it: a 30 m surface model reads the ground
above the tunnel, not the carriageway beneath, so `sink` and `hand` are
computed for the wrong surface entirely. Types 1 and 2 will therefore never
flag one, however severe.

It is also the mechanism with the worst consequences. Ponding in a residential
street damages cars and wastes time; a flooded underpass on a motorway drowns
people, which is why the only Saudi flood fatalities this project cites
happened on roads rather than in neighbourhoods.

Severity here is not terrain. It is road class and the drainage area feeding
the approach: a tunnel on a motorway taking runoff from a large upslope area
is worse than a short underpass on a residential street.

    .venv/Scripts/python.exe tunnels.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).parent
OUT = HERE / "out" / "shortlist"
ROADS = HERE / "cache" / "madinah" / "roads.json"

# a flooded motorway underpass is a different problem from a flooded lane
CLASS_WEIGHT = {"motorway": 1.00, "trunk": 0.90, "primary": 0.75,
                "secondary": 0.55, "tertiary": 0.40, "residential": 0.25,
                "unclassified": 0.25, "service": 0.15}


def underground(tags: dict) -> bool:
    if tags.get("tunnel") in ("yes", "building_passage", "culvert"):
        return True
    layer = str(tags.get("layer", "0"))
    return layer.lstrip("-").isdigit() and int(layer) < 0


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    els = json.loads(ROADS.read_text(encoding="utf-8")).get("elements", [])

    rows = []
    for e in els:
        tg = e.get("tags") or {}
        g = e.get("geometry") or []
        if e.get("type") != "way" or not g or not underground(tg):
            continue
        lat = float(np.mean([p["lat"] for p in g]))
        lon = float(np.mean([p["lon"] for p in g]))
        # length in metres, for how much carriageway sits below grade
        d = 0.0
        for a, b in zip(g[:-1], g[1:]):
            d += np.hypot((b["lat"] - a["lat"]) * 111320,
                          (b["lon"] - a["lon"]) * 111320
                          * np.cos(np.radians(a["lat"])))
        rows.append({"osm_id": e.get("id"), "name_ar": tg.get("name", ""),
                     "highway": tg.get("highway", ""),
                     "tunnel": tg.get("tunnel", ""), "layer": tg.get("layer", ""),
                     "lat": lat, "lon": lon, "length_m": round(d, 1)})

    t = pd.DataFrame(rows)
    if t.empty:
        print("no underground ways found"); return

    # attach the nearest scored segment so a tunnel inherits the local terrain
    seg = pd.read_csv(HERE / "out" / "madinah_segments_features.csv")
    seg.columns = [c.lstrip("﻿") for c in seg.columns]
    risk = pd.read_csv(HERE / "out" / "madinah_native_risk.csv")
    # district_ar already exists in the features file; taking it from both
    # sides of the merge produces district_ar_x / district_ar_y
    seg = seg.merge(risk[["unit_id", "rank_hydrology", "rank_model"]],
                    on="unit_id", how="left")

    near = []
    for _, r in t.iterrows():
        dy = (seg.lat - r.lat) * 111320
        dx = (seg.lon - r.lon) * 111320 * np.cos(np.radians(r.lat))
        s = seg.assign(d=np.hypot(dx, dy)).nsmallest(1, "d").iloc[0]
        near.append({"district_ar": s.district_ar, "dist_m": round(float(s.d), 1),
                     "logacc": float(s.logacc), "slope": float(s.slope),
                     "sink": float(s.sink), "hand": float(s.hand),
                     "rank_hydrology": float(s.rank_hydrology),
                     "rank_model": float(s.rank_model)})
    t = pd.concat([t.reset_index(drop=True), pd.DataFrame(near)], axis=1)

    t["class_weight"] = t["highway"].map(CLASS_WEIGHT).fillna(0.3)
    t["mechanism"] = "tunnel"
    # how bad: road class, water arriving, and how much of it is below grade
    t["severity"] = (t["class_weight"] * 0.5
                     + t["logacc"].rank(pct=True) * 0.3
                     + t["length_m"].rank(pct=True) * 0.2)
    t["priority"] = t["severity"].rank(pct=True)
    t = t.sort_values("priority", ascending=False)
    t.to_csv(OUT / "type3_tunnels.csv", index=False, encoding="utf-8")

    print(f"\n  underground ways: {len(t)}   total length "
          f"{t.length_m.sum()/1000:.2f} km")
    print(f"  by road class: " + "  ".join(
        f"{k} {v}" for k, v in t.highway.value_counts().items()))
    print(f"\n  how the existing rankings score them (median percentile):")
    print(f"    hydrology     {t.rank_hydrology.median():.3f}")
    print(f"    trained model {t.rank_model.median():.3f}")
    print(f"\n  top underpasses by priority:\n")
    print(f"    {'lat':>9}{'lon':>10}{'len':>7}  {'class':<11}{'logacc':>7}  name")
    for _, s in t.head(12).iterrows():
        print(f"    {s.lat:9.5f}{s.lon:10.5f}{s.length_m:7.0f}  {s.highway:<11}"
              f"{s.logacc:7.2f}  {str(s.name_ar)[:38]}")

    named = t[t.name_ar.astype(str).str.contains("الملك عبدالله", na=False)]
    if len(named):
        s = named.iloc[0]
        print(f"\n  the tunnel named in the 2015 SPA report:")
        print(f"    {s.name_ar} at {s.lat:.5f}, {s.lon:.5f} "
              f"-- priority {s.priority:.3f}, hydrology rank {s.rank_hydrology:.3f}")
    print(f"\n  wrote {OUT / 'type3_tunnels.csv'}")


if __name__ == "__main__":
    main()
