# -*- coding: utf-8 -*-
"""Does Overture know more Madinah street names than OpenStreetMap does?

OSM names only 4.3% of the city's ways, and 1.1% of its residential ones, which
is why 26,727 of 30,337 ranked segments have no name. Google's terms rule it out
as a source — you may not store geocoding results or show them on a non-Google
basemap, and this dashboard is MapLibre. Overture is open data (Meta, Microsoft,
AWS, TomTom) under a permissive licence, and its transportation theme carries
road names, so it is the one alternative testable today without an account.

Queried straight off S3 with DuckDB rather than downloaded: the release is
hundreds of GB, but the parquet carries a bbox column, so a spatial predicate
prunes to the few files covering Madinah.

The honest catch, stated up front: much of Overture's road layer is itself
derived from OSM. If the coverage comes back near-identical, that is the answer
— the names do not exist in open data at all, and the only real sources are the
national address register or the Amanah's own file.

    .venv/Scripts/python.exe probe_overture.py
"""
from __future__ import annotations

import json
from pathlib import Path

import duckdb

HERE = Path(__file__).parent
RELEASE = "2026-08-19.0"
BBOX = (39.50, 24.36, 39.72, 24.58)          # the AOI, from cache/madinah/meta.json
SRC = (f"s3://overturemaps-us-west-2/release/{RELEASE}"
       "/theme=transportation/type=segment/*")


def main() -> None:
    con = duckdb.connect()
    con.sql("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
    lo_x, lo_y, hi_x, hi_y = BBOX

    where = (f"bbox.xmin BETWEEN {lo_x} AND {hi_x} "
             f"AND bbox.ymin BETWEEN {lo_y} AND {hi_y} "
             "AND subtype = 'road'")

    print(f"querying Overture {RELEASE} over the Madinah bbox…")
    total = con.sql(
        f"SELECT count(*) FROM read_parquet('{SRC}', filename=false, "
        f"hive_partitioning=1) WHERE {where}").fetchone()[0]
    print(f"  road segments in bbox: {total:,}")

    rows = con.sql(f"""
        SELECT class,
               count(*)                                            AS n,
               count(names.primary)                                AS named,
               -- A literal Arabic range: DuckDB's regex engine rejects \\u
               -- escapes, and the point is to separate «طريق قباء» from
               -- «Quba Road», which a character class does directly.
               count(*) FILTER (
                 WHERE names.primary IS NOT NULL
                   AND regexp_matches(names.primary, '[ء-ي]')
               )                                                   AS arabic
          FROM read_parquet('{SRC}', filename=false, hive_partitioning=1)
         WHERE {where}
         GROUP BY class
         ORDER BY n DESC
    """).fetchall()

    print(f"\n{'class':16}{'segments':>10}{'named':>9}{'%':>7}{'arabic':>9}")
    tn = tk = ta = 0
    for cls, n, named, arabic in rows:
        tn += n; tk += named; ta += arabic
        print(f"{str(cls):16}{n:10,}{named:9,}{100*named/n:6.1f}%{arabic:9,}")
    print(f"{'TOTAL':16}{tn:10,}{tk:9,}{100*tk/max(tn,1):6.1f}%{ta:9,}")

    distinct = con.sql(f"""
        SELECT count(DISTINCT names.primary)
          FROM read_parquet('{SRC}', filename=false, hive_partitioning=1)
         WHERE {where} AND names.primary IS NOT NULL
    """).fetchone()[0]
    print(f"\n  distinct road names: {distinct:,}   (OSM gives us 148 usable)")

    sample = con.sql(f"""
        SELECT DISTINCT names.primary AS nm, class
          FROM read_parquet('{SRC}', filename=false, hive_partitioning=1)
         WHERE {where} AND names.primary IS NOT NULL AND class = 'residential'
         LIMIT 12
    """).fetchall()
    print("\n  sample residential names:")
    for nm, cls in sample:
        print(f"    {nm}")

    (HERE / "results_overture_probe.json").write_text(json.dumps({
        "release": RELEASE, "bbox": BBOX, "total": tn, "named": tk,
        "arabic": ta, "distinctNames": distinct,
        "byClass": [{"class": c, "n": n, "named": k, "arabic": a}
                    for c, n, k, a in rows],
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print("\nwrote results_overture_probe.json")


if __name__ == "__main__":
    main()
