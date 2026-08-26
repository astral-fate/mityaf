"""One-off bridge: DuckDB (validated Python prototype) -> apps/web/public/data.

The Node pipeline reproduces all of this from scratch, but this lets the repo
ship with REAL Al Madinah geometry immediately rather than an empty map.

Only what has actually been computed is exported. Risk scores and waste events
require the Earth Engine run, so segments go out with `s: null` and
`b: 'insufficient_data'` — the map greys them and the UI says so. That is the
honesty design working, not a placeholder.

    python prototype-python/scripts/export_to_web.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "prototype-python"))

import duckdb  # noqa: E402
from shapely.geometry import shape  # noqa: E402
from shapely.ops import transform as shp_transform  # noqa: E402

# ~3 m in degrees at this latitude. The analysis unit is a 10 m pixel, so
# vertices finer than this carry no information and only cost payload.
SIMPLIFY_DEG = 3.0 / 111_000

DB = ROOT / "data" / "masareb.duckdb"
OUT = ROOT / "apps" / "web" / "public" / "data"


def thin(geom: dict, dp: int = 5, simplify: bool = False) -> dict:
    """Drop vertices below the pixel scale, then round to ~1 m."""
    if simplify:
        try:
            g = shape(geom).simplify(SIMPLIFY_DEG, preserve_topology=True)
            if not g.is_empty:
                geom = g.__geo_interface__
        except Exception:
            pass  # keep the original rather than losing the unit

    def walk(c):
        if isinstance(c[0], (int, float)):
            return [round(c[0], dp), round(c[1], dp)]
        return [walk(x) for x in c]

    return {"type": geom["type"], "coordinates": walk(geom["coordinates"])}


def write(name: str, payload) -> float:
    OUT.mkdir(parents=True, exist_ok=True)
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    (OUT / name).write_text(body, encoding="utf-8")
    mb = len(body.encode("utf-8")) / 1048576
    print(f"  {name:24} {mb:7.2f} MB")
    return mb


def main() -> None:
    con = duckdb.connect(str(DB), read_only=True)
    con.execute("INSTALL spatial; LOAD spatial")
    total = 0.0

    # ── green assets + spill rings ──
    rows = con.execute("""
        SELECT unit_id, unit_type, parent_unit_id, name_ar, area_m2,
               ST_AsGeoJSON(geom) AS gj, qa_flags
        FROM units WHERE unit_type IN ('green','ring') AND active
    """).fetchall()
    feats = [{
        "type": "Feature",
        "geometry": thin(json.loads(gj), simplify=True),
        "properties": {
            "id": uid, "t": ut, "parent": parent, "name": name,
            "area": round(area) if area else None,
            "small": bool(qa and "ring_too_small" in str(qa)),
        },
    } for uid, ut, parent, name, area, gj, qa in rows]
    total += write("green.geojson", {"type": "FeatureCollection", "features": feats})

    # ── street segments ──
    rows = con.execute("""
        SELECT unit_id, name_ar, ST_AsGeoJSON(geom) AS gj
        FROM units WHERE unit_type='segment' AND active
    """).fetchall()
    feats = [{
        "type": "Feature",
        "geometry": thin(json.loads(gj), simplify=True),
        # id + score only; the detail payload carries everything else
        "properties": {"id": uid, "name": name, "s": None, "b": "insufficient_data"},
    } for uid, name, gj in rows]
    total += write("segments.geojson", {"type": "FeatureCollection", "features": feats})

    # ── rain ──
    events = [dict(zip([d[0] for d in con.description], r)) for r in con.execute("""
        SELECT rain_event_id, start_date, end_date, peak_date, total_mm, max_daily_mm
        FROM rain_events ORDER BY peak_date DESC
    """).fetchall()]
    recent = [dict(zip([d[0] for d in con.description], r)) for r in con.execute("""
        SELECT date, precipitation_sum_mm AS precipitationSumMm,
               rain_72h_mm AS rain72hMm, days_since_rain AS daysSinceRain
        FROM weather_daily ORDER BY date DESC LIMIT 120
    """).fetchall()]
    total += write("rain.json", {
        "events": json.loads(json.dumps(events, default=str)),
        "recent": json.loads(json.dumps(list(reversed(recent)), default=str)),
    })

    # ── empty-but-valid detection payloads ──
    total += write("segments-top.json", {"items": [], "count": 0})
    total += write("waste-events.json", {"items": [], "count": 0})

    # ── meta ──
    counts = dict(con.execute(
        "SELECT unit_type, count(*) FROM units WHERE active GROUP BY 1").fetchall())
    runs = [dict(zip([d[0] for d in con.description], r)) for r in con.execute("""
        SELECT run_id, job_name, status, duration_s, n_rows_written, started_at
        FROM pipeline_runs ORDER BY started_at DESC LIMIT 10
    """).fetchall()]
    total += write("meta.json", json.loads(json.dumps({
        "generatedAt": __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc).isoformat(),
        "aoi": {"minLon": 39.50, "minLat": 24.36, "maxLon": 39.72, "maxLat": 24.58},
        "units": counts,
        "observations": 0,
        "wasteEvents": 0,
        "pondingObservations": 0,
        "latestObservation": None,
        "pipelineRuns": runs,
        "dataMode": "precomputed",
        "note": (
            "Geometry and rainfall are real. Risk scores and waste events await "
            "the Earth Engine run, so segments carry b='insufficient_data'."
        ),
    }, default=str)))

    print(f"\n  total: {total:.2f} MB uncompressed")


if __name__ == "__main__":
    main()
