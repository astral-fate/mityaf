"""ONE-TIME: build every unit of analysis from OpenStreetMap.

Produces four unit types:
  green    — parks / gardens / grass / pitches (closed OSM ways)
  ring     — the spill ring: 2-20 m of surface just outside each green polygon.
             This is where over-irrigation physically shows up, and it is the
             whole basis of Module A.
  segment  — street centrelines split to ~200 m
  (catchments come later, from the DEM)

    python -m masareb.jobs.build_units
"""
from __future__ import annotations

from shapely.geometry import Polygon

from masareb.config import settings
from masareb.osm import overpass, segments as seg_mod
from masareb.store.db import RunLogger, area_m2, buffer_m, get_conn, init_schema, write

BBOX = settings.aoi_bbox


def _insert(con, rows: list[dict], run: RunLogger) -> int:
    """Insert unit rows, computing geometry-derived columns in SQL so the metric
    CRS handling stays in one place."""
    if not rows:
        return 0
    con.execute("CREATE OR REPLACE TEMP TABLE _staging (unit_id VARCHAR, unit_type VARCHAR, "
                "parent_unit_id VARCHAR, name_ar VARCHAR, name_en VARCHAR, source VARCHAR, "
                "source_ref VARCHAR, wkt VARCHAR, highway_class VARCHAR)")
    con.executemany(
        "INSERT INTO _staging VALUES (?,?,?,?,?,?,?,?,?)",
        [(r["unit_id"], r["unit_type"], r.get("parent_unit_id"), r.get("name_ar"),
          r.get("name_en"), r["source"], r.get("source_ref"), r["wkt"],
          r.get("highway_class")) for r in rows],
    )
    con.execute(f"""
        INSERT OR REPLACE INTO units
          (unit_id, unit_type, parent_unit_id, name_ar, name_en, source, source_ref,
           geom, bbox_minx, bbox_miny, bbox_maxx, bbox_maxy,
           centroid_lon, centroid_lat, area_m2, length_m, highway_class,
           geometry_confidence)
        SELECT unit_id, unit_type, parent_unit_id, name_ar, name_en, source, source_ref,
               ST_GeomFromText(wkt) AS g,
               ST_XMin(ST_GeomFromText(wkt)), ST_YMin(ST_GeomFromText(wkt)),
               ST_XMax(ST_GeomFromText(wkt)), ST_YMax(ST_GeomFromText(wkt)),
               ST_X(ST_Centroid(ST_GeomFromText(wkt))),
               ST_Y(ST_Centroid(ST_GeomFromText(wkt))),
               CASE WHEN unit_type IN ('green','ring','catchment')
                    THEN {area_m2('ST_GeomFromText(wkt)')} END,
               CASE WHEN unit_type = 'segment'
                    THEN ST_Length({ 'ST_Transform(ST_GeomFromText(wkt), ' +
                                     f"'{settings.crs_geographic}','{settings.crs_metric}'," +
                                     ' always_xy := true)' }) END,
               highway_class,
               'high'
        FROM _staging
    """)
    n = con.execute("SELECT count(*) FROM _staging").fetchone()[0]
    run.add(rows_written=n)
    return n


def build_green(con, run: RunLogger) -> int:
    data = overpass.fetch("green")
    recs = overpass.ways_to_records(data)
    rows = []
    for r in recs:
        if not r["closed"] or len(r["coords"]) < 4:
            continue
        poly = Polygon(r["coords"])
        if not poly.is_valid:
            poly = poly.buffer(0)
        if poly.is_empty or poly.geom_type != "Polygon":
            continue
        rows.append({
            "unit_id": f"grn_{r['osm_id']}",
            "unit_type": "green",
            "name_ar": r.get("name_ar"),
            "name_en": r.get("name_en"),
            "source": "osm",
            "source_ref": str(r["osm_id"]),
            "wkt": poly.wkt,
        })
    n = _insert(con, rows, run)

    # drop implausible sizes: a 30 m2 "park" is a mapping artefact, and anything
    # over 20 ha is usually a land-use blob rather than an irrigated asset
    con.execute(
        "DELETE FROM units WHERE unit_type='green' AND (area_m2 < ? OR area_m2 > ?)",
        [settings.green_min_area_m2, settings.green_max_area_m2],
    )
    kept = con.execute("SELECT count(*) FROM units WHERE unit_type='green'").fetchone()[0]
    print(f"  green   : {n} candidates -> {kept} kept "
          f"({settings.green_min_area_m2:.0f}-{settings.green_max_area_m2:.0f} m2)")
    return kept


def build_rings(con, run: RunLogger) -> int:
    """The spill ring: a band just outside each green polygon.

    Inner edge starts 2 m out so we skip the mixed pixel that straddles the grass
    edge; outer edge at 20 m keeps us on the immediately adjacent surface rather
    than the far side of the street. Overlapping greens are subtracted so a ring
    never reports another park's irrigation as spill.
    """
    con.execute("DELETE FROM units WHERE unit_type='ring'")
    con.execute(f"""
        INSERT INTO units
          (unit_id, unit_type, parent_unit_id, name_ar, source, geom,
           bbox_minx, bbox_miny, bbox_maxx, bbox_maxy,
           centroid_lon, centroid_lat, area_m2, geometry_confidence)
        WITH g AS (SELECT unit_id, name_ar, geom FROM units WHERE unit_type='green'),
        band AS (
          SELECT unit_id, name_ar,
                 ST_Difference(
                   {buffer_m('geom', settings.ring_outer_m)},
                   {buffer_m('geom', settings.ring_inner_m)}
                 ) AS ring
          FROM g
        ),
        clean AS (
          SELECT b.unit_id, b.name_ar,
                 ST_Difference(b.ring, COALESCE(o.other, ST_GeomFromText('POLYGON EMPTY'))) AS ring
          FROM band b
          LEFT JOIN (
            SELECT b2.unit_id, ST_Union_Agg(g2.geom) AS other
            FROM band b2 JOIN g g2 ON g2.unit_id <> b2.unit_id
                                  AND ST_Intersects(b2.ring, g2.geom)
            GROUP BY b2.unit_id
          ) o ON o.unit_id = b.unit_id
        )
        SELECT 'rng_' || substr(unit_id, 5), 'ring', unit_id, name_ar,
               'derived_buffer', ring,
               ST_XMin(ring), ST_YMin(ring), ST_XMax(ring), ST_YMax(ring),
               ST_X(ST_Centroid(ring)), ST_Y(ST_Centroid(ring)),
               {area_m2('ring')}, 'high'
        FROM clean
        WHERE NOT ST_IsEmpty(ring)
    """)
    n = con.execute("SELECT count(*) FROM units WHERE unit_type='ring'").fetchone()[0]
    # a ring smaller than ~10 Sentinel-2 pixels cannot support a claim
    con.execute("UPDATE units SET qa_flags = '{\"ring_too_small\": true}' "
                "WHERE unit_type='ring' AND area_m2 < 1000")
    small = con.execute("SELECT count(*) FROM units WHERE unit_type='ring' "
                        "AND area_m2 < 1000").fetchone()[0]
    run.add(rows_written=n)
    print(f"  rings   : {n} built ({small} flagged ring_too_small, < 1000 m2)")
    return n


def build_segments(con, run: RunLogger) -> int:
    data = overpass.fetch("streets")
    recs = overpass.ways_to_records(data)
    rows = seg_mod.build_segments(recs)
    n = _insert(con, rows, run)

    # Overpass returns WHOLE ways that touch the bbox, so a highway heading for
    # Makkah arrives in full. Drop segments whose centroid falls outside the AOI,
    # otherwise we would be ranking streets in other cities.
    con.execute(
        """DELETE FROM units WHERE unit_type='segment'
           AND NOT (centroid_lon BETWEEN ? AND ? AND centroid_lat BETWEEN ? AND ?)""",
        [settings.aoi_min_lon, settings.aoi_max_lon,
         settings.aoi_min_lat, settings.aoi_max_lat],
    )
    kept = con.execute(
        "SELECT count(*) FROM units WHERE unit_type='segment'").fetchone()[0]
    print(f"  segments: {len(recs)} ways -> {n} split -> {kept} inside AOI")
    return kept


def main() -> None:
    init_schema()
    con = get_conn()
    with RunLogger("build_units", {"bbox": BBOX}) as run, write() as con:
        print(f"AOI: {BBOX}")
        build_green(con, run)
        build_rings(con, run)
        build_segments(con, run)

        print("\n  totals by unit_type:")
        for t, c, a in con.execute(
            "SELECT unit_type, count(*), round(avg(COALESCE(area_m2, length_m))) "
            "FROM units GROUP BY 1 ORDER BY 2 DESC"
        ).fetchall():
            print(f"    {t:10} {c:6,}   avg size {a:,.0f}")


if __name__ == "__main__":
    main()
