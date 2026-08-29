"""Write the site's static data from the analysis CSVs.

Every number the site renders originates here. The browser does no analysis,
which keeps API keys out of the client, makes a demo work offline, and means
one pipeline owns every figure shown.

Two files carry segments rather than one. `ponding-shortlist.json` holds the
2,617 flagged rows and serves the map, every table and every filter;
`ponding-segments.json` holds all 30,337 and is read only by the segment
detail page, as the fallback for an id that did not make the shortlist.
Loading 13.26 MB to render a 20-row table is the difference between a page
that opens and one that hangs.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).parent
WEB = HERE.parent / "apps" / "web" / "public" / "data"

PINS = [
    {"lat": 24.5040022, "lon": 39.7000415, "label": "DMPA4802"},
    {"lat": 24.504608, "lon": 39.700796, "label": "pin B"},
    {"lat": 24.503704, "lon": 39.702222, "label": "حديقة الجبل"},
]
BASIN_CORE = {"lat": 24.50337214, "lon": 39.70212429}
# The pin the headline claim is measured against: the resident's third
# coordinate, supplied after the DEM had already located the basin core.
PREDICTION_PIN = 2


def metres_between(a: dict, b: dict) -> float:
    """Great-circle distance in metres between two {lat, lon} points.

    Exported as a scalar so the evidence page never computes it, and so the
    coordinate and the distance printed beside it cannot drift apart.
    """
    r = 6371008.8
    p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
    dp = p2 - p1
    dl = math.radians(b["lon"] - a["lon"])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def clean(v):
    """JSON has no NaN. Anything non-finite becomes null."""
    if isinstance(v, (np.floating, float)):
        return None if not math.isfinite(float(v)) else round(float(v), 5)
    if isinstance(v, (np.integer, int)):
        return int(v)
    if isinstance(v, (np.bool_, bool)):
        return bool(v)
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    return str(v)


def write(name: str, payload: dict) -> int:
    WEB.mkdir(parents=True, exist_ok=True)
    (WEB / name).write_text(
        json.dumps(payload, ensure_ascii=False, allow_nan=False),
        encoding="utf-8")
    n = len(payload.get("items", payload.get("features", [])))
    print(f"  {name:32} {n:>7,} rows  "
          f"{(WEB / name).stat().st_size / 1024:>7,.0f} KB")
    return n


def load_frames():
    risk = pd.read_csv(HERE / "out" / "madinah_native_risk.csv")
    feat = pd.read_csv(HERE / "out" / "madinah_segments_features.csv")
    feat.columns = [c.lstrip("﻿") for c in feat.columns]
    d = risk.merge(
        feat[["unit_id", "sink", "slope", "hand", "twi", "logacc",
              "relelev", "road_density", "major_frac"]],
        on="unit_id", how="left")
    short = pd.read_csv(HERE / "out" / "shortlist" / "inspection_shortlist.csv")
    d = d.merge(short[["unit_id", "mechanism", "priority"]],
                on="unit_id", how="left")
    return d


def build() -> dict[str, int]:
    d = load_frames()
    counts = {}

    # city percentile for each terrain feature, computed once here so the
    # browser never has to rank 30,337 rows to draw one bar
    TERR = ["sink", "slope", "hand", "twi", "logacc"]
    for c in TERR:
        d[f"pct_{c}"] = d[c].rank(pct=True)

    def seg_row(s):
        return {
            "id": s.unit_id, "lat": clean(s.lat), "lon": clean(s.lon),
            "district": clean(s.district_ar), "name": clean(s.name_ar),
            "mechanism": None if pd.isna(s.mechanism) else s.mechanism,
            "priority": clean(s.priority),
            "ranks": {"hyd": clean(s.rank_hydrology), "model": clean(s.rank_model),
                      "road": clean(s.rank_roaddensity),
                      "consensus": clean(s.rank_consensus)},
            "terrain": {c: clean(getattr(s, c)) for c in TERR},
            "pct": {c: clean(getattr(s, f"pct_{c}")) for c in TERR},
            "ood": bool(s.ood_flag),
        }

    items = [seg_row(s) for s in d.itertuples(index=False)]
    counts["ponding-segments.json"] = write(
        "ponding-segments.json", {"count": len(items), "items": items})

    flagged = [i for i in items if i["mechanism"]]
    flagged.sort(key=lambda i: -(i["priority"] or 0))
    # City-wide per-mechanism totals, so the map legend can follow the
    # mechanism filter without counting features in the browser.
    by_mech = {m: sum(1 for i in flagged if i["mechanism"] == m)
               for m in ("depression", "convergence")}
    counts["ponding-shortlist.json"] = write(
        "ponding-shortlist.json",
        {"count": len(flagged), "byMechanism": by_mech, "items": flagged})

    t = pd.read_csv(HERE / "out" / "shortlist" / "type3_tunnels.csv")
    tun = [{"osmId": clean(r.osm_id), "name": clean(r.name_ar),
            "highway": clean(r.highway), "lat": clean(r.lat), "lon": clean(r.lon),
            "lengthM": clean(r.length_m), "district": clean(r.district_ar),
            "logacc": clean(r.logacc), "priority": clean(r.priority)}
           for r in t.itertuples(index=False)]
    counts["ponding-tunnels.json"] = write(
        "ponding-tunnels.json", {"count": len(tun), "items": tun})

    inc = pd.read_csv(HERE / "out" / "incidents" / "incident_register.csv")
    rows = [{k: clean(v) for k, v in r._asdict().items() if k != "Index"}
            for r in inc.itertuples()]
    for r in rows:
        r["corroborated"] = str(r.get("corroborated")).lower() in ("true", "1")
    n_corr = sum(1 for r in rows if r["corroborated"])
    counts["ponding-incidents.json"] = write("ponding-incidents.json", {
        "count": len(rows),
        "corroboratedCount": n_corr,
        "unconfirmedCount": len(rows) - n_corr,
        "items": rows,
    })

    # districts: existing geometry, new scores
    src = json.loads((HERE.parent / "apps" / "web" / "public" / "data"
                      / "districts.geojson").read_text(encoding="utf-8"))
    inc_by_dist = inc.groupby("district").size().to_dict()
    # Corroborated is a different number from reported, and the districts
    # table has a column for each. Deriving one from the other in the browser
    # is how a "corroborated" header came to sit above a total.
    is_corr = inc["corroborated"].astype(str).str.lower().isin(("true", "1"))
    inc_corr_by_dist = inc[is_corr].groupby("district").size().to_dict()
    # Not a field visit: a resident supplied three coordinates that fall
    # inside the basin the DEM had already found. The UI must say so.
    verified = {"الملك فهد"}
    for f in src["features"]:
        name = f["properties"].get("name")
        sub = d[d.district_ar == name]
        p = f["properties"]
        p["shortlistCount"] = int(sub.mechanism.notna().sum())
        p["depressionCount"] = int((sub.mechanism == "depression").sum())
        p["convergenceCount"] = int((sub.mechanism == "convergence").sum())
        p["tunnelCount"] = int((t.district_ar == name).sum())
        # `or 0` would collapse a genuine 0.0 into the missing case; only
        # None means missing here.
        top = clean(sub.priority.max())
        med = clean(sub.rank_hydrology.median())
        p["topPriority"] = 0 if top is None else top
        p["medianHydRank"] = 0 if med is None else med
        p["incidentCount"] = int(inc_by_dist.get(name, 0))
        p["corroboratedCount"] = int(inc_corr_by_dist.get(name, 0))
        p["verified"] = name in verified
    # Header figures as scalars. The districts page rendered these as five
    # reduce() passes over 91 rows; no number on this platform is computed in
    # the browser, and a client-side sum silently disagreeing with the
    # shortlist's own `count` is exactly the drift that rule exists to stop.
    props = [f["properties"] for f in src["features"]]
    src["totals"] = {
        "districtCount": len(props),
        "shortlistCount": sum(q["shortlistCount"] for q in props),
        "depressionCount": sum(q["depressionCount"] for q in props),
        "convergenceCount": sum(q["convergenceCount"] for q in props),
        "tunnelCount": sum(q["tunnelCount"] for q in props),
        "verifiedCount": sum(1 for q in props if q["verified"]),
        "incidentCount": sum(q["incidentCount"] for q in props),
        "corroboratedCount": sum(q["corroboratedCount"] for q in props),
    }
    counts["ponding-districts.geojson"] = write("ponding-districts.geojson", src)

    basin = pd.read_csv(HERE / "out" / "incidents" / "king_fahd_basin.csv")
    counts["ponding-basin.json"] = write("ponding-basin.json", {
        "pins": PINS, "core": BASIN_CORE,
        # The headline claim, as data: which pin the prediction is measured
        # against and how far it is. The page reads both rather than printing
        # a coordinate and a distance as literals that cannot move together.
        "prediction": {
            "pinIndex": PREDICTION_PIN,
            "distanceM": round(metres_between(BASIN_CORE, PINS[PREDICTION_PIN]), 1),
        },
        "segmentCount": int(len(basin)),
        "maxSinkM": clean(basin.sink.max()),
        "medianSlopeDeg": clean(basin.slope.median()),
        "medianHandM": clean(basin.hand.median()),
        "bbox": [clean(basin.lon.min()), clean(basin.lat.min()),
                 clean(basin.lon.max()), clean(basin.lat.max())],
        "items": [{"lat": clean(r.lat), "lon": clean(r.lon),
                   "sink": clean(r.sink), "slope": clean(r.slope)}
                  for r in basin.itertuples(index=False)],
    })

    # rainfall: two sources, because ERA5 records 0.00 days above 5 mm in
    # August across 11.7 years while NASA POWER measured 27.5 mm on
    # 2024-08-30, the day street flooding that day was filmed
    rain = pd.read_csv(HERE / "out" / "incidents" / "predicted_ponding_days.csv")
    counts["ponding-rain.json"] = write("ponding-rain.json", {
        "count": len(rain),
        "note": "days above 5 mm on either ERA5 or NASA POWER with no matching report",
        "items": [{"date": clean(r.date), "peakMm": clean(r.peak_mm)}
                  for r in rain.itertuples(index=False)],
    })
    return counts


if __name__ == "__main__":
    print("\nexporting site data\n")
    build()
    print("\ndone")
