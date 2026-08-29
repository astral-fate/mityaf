# -*- coding: utf-8 -*-
"""Look at what the 47 «tunnel» ways actually are, on the ground.

The tunnel rule is the one classification that does not come from the terrain:
it is read from a map tag, because the DEM measures the roof and not the road.
That makes it the rule most worth auditing by eye -- nothing in the elevation
data can contradict a wrong tag.

Three things this establishes, none of which are visible in the count alone:

  structure   `tunnel=yes` means roofed; `cutting=yes` means an open trench with
              no roof at all. Both sit below grade and both pond, but they are
              different build types and the deck should not call them the same
              thing.
  double count OSM splits a dual carriageway into one way per direction, so two
              ways can be one structure. Endpoints are clustered to find out how
              many structures there really are, rather than trusting the name.
  the reason  the DEM profile is sampled along each centreline. Where the road
              dips and the DEM stays flat, that gap IS the argument for the rule.

Writes tunnels-inspect.json for the inspection page.

    .venv/Scripts/python.exe inspect_tunnels.py
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).parent
CACHE = HERE / "cache" / "madinah"
OUT = HERE / "tunnels-inspect.json"

CLUSTER_M = 150.0          # endpoints closer than this belong to one structure


def load_dem():
    meta = json.loads((CACHE / "meta.json").read_text(encoding="utf-8"))
    a, _, x0, _, e, y0 = meta["transform"]
    terrain = np.load(CACHE / "terrain.npy")
    # terrain holds the derived layers, not raw elevation; read the DEM itself
    try:
        import rasterio
        with rasterio.open(CACHE / "Copernicus_DSM_COG_10_N24_00_E039_00_DEM.tif") as ds:
            band = ds.read(1)
            T = ds.transform
            return band, (T.a, T.c, T.e, T.f), meta, terrain
    except Exception as exc:                                     # noqa: BLE001
        print(f"  rasterio unavailable ({type(exc).__name__}); "
              f"falling back to the cached grid")
        return None, (a, x0, e, y0), meta, terrain


def sample(band, tf, lon, lat):
    a, x0, e, y0 = tf
    col = int((lon - x0) / a)
    row = int((lat - y0) / e)
    if 0 <= row < band.shape[0] and 0 <= col < band.shape[1]:
        v = float(band[row, col])
        return None if v < -1000 else v
    return None


def haversine(p, q):
    R = 6371000.0
    dlat = math.radians(q[1] - p[1])
    dlon = math.radians(q[0] - p[0])
    la = math.radians(p[1])
    return 2 * R * math.asin(math.sqrt(
        math.sin(dlat / 2) ** 2 + math.cos(la) ** 2 * math.sin(dlon / 2) ** 2))


def densify(g, step_m=15.0):
    """Walk a polyline at a fixed ground spacing, yielding (lon, lat)."""
    if len(g) < 2:
        return list(g)
    out, carry = [g[0]], 0.0
    for i in range(len(g) - 1):
        p, q = g[i], g[i + 1]
        seg = haversine(p, q)
        if seg == 0:
            continue
        t = (step_m - carry) / seg
        while t <= 1.0:
            out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
            t += step_m / seg
        carry = (carry + seg) % step_m
    out.append(g[-1])
    return out


def main() -> None:
    els = json.loads((CACHE / "roads.json").read_text(encoding="utf-8"))["elements"]
    ways = [w for w in els
            if w.get("tags", {}).get("tunnel") == "yes"
            or str(w.get("tags", {}).get("layer", "0")).startswith("-")]
    print(f"{len(ways)} ways match the tunnel rule")

    band, tf, meta, _terrain = load_dem()
    shortlist = pd.read_csv(HERE / "out" / "shortlist" / "type3_tunnels.csv")
    by_id = {int(r.osm_id): r for r in shortlist.itertuples()}

    recs = []
    for w in ways:
        g = [(p["lon"], p["lat"]) for p in w.get("geometry", [])]
        tags = w["tags"]
        length = sum(haversine(g[i], g[i + 1]) for i in range(len(g) - 1))
        # OSM stores 2-11 nodes per way, which is far too coarse to show a dip
        # against a 30 m DEM. Walk the centreline at a fixed step instead, so
        # the profile has the same resolution as the raster underneath it.
        prof = [p for p in (sample(band, tf, lo, la)
                            for lo, la in densify(g, step_m=15.0))
                if p is not None] if band is not None else []
        row = by_id.get(w["id"])
        recs.append({
            "id": w["id"],
            "name": tags.get("name") or tags.get("name:en") or None,
            "name_en": tags.get("name:en"),
            "highway": tags.get("highway"),
            "lanes": tags.get("lanes"),
            "oneway": tags.get("oneway") == "yes",
            "layer": int(tags.get("layer", 0) or 0),
            # the structural distinction the count hides
            "roofed": tags.get("tunnel") == "yes",
            "cutting": tags.get("cutting") == "yes",
            "ref": tags.get("ref"),
            "length_m": round(length, 1),
            "geometry": [[round(x, 6), round(y, 6)] for x, y in g],
            "district": getattr(row, "district_ar", None),
            "rank_hydrology": (round(float(row.rank_hydrology), 4)
                               if row is not None else None),
            "sink": round(float(row.sink), 3) if row is not None else None,
            "hand": round(float(row.hand), 2) if row is not None else None,
            "slope": round(float(row.slope), 2) if row is not None else None,
            "dem_profile": [round(p, 1) for p in prof],
            "dem_range_m": (round(max(prof) - min(prof), 1) if len(prof) > 1
                            else None),
        })

    # ── cluster endpoints into physical structures ──────────────────────────
    parent = list(range(len(recs)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i, j):
        a, b = find(i), find(j)
        if a != b:
            parent[b] = a

    for i in range(len(recs)):
        for j in range(i + 1, len(recs)):
            gi, gj = recs[i]["geometry"], recs[j]["geometry"]
            if not gi or not gj:
                continue
            near = min(haversine(p, q)
                       for p in (gi[0], gi[-1]) for q in (gj[0], gj[-1]))
            if near <= CLUSTER_M:
                union(i, j)

    groups = {}
    for i, r in enumerate(recs):
        groups.setdefault(find(i), []).append(r)
    structures = []
    for members in groups.values():
        names = [m["name"] for m in members if m["name"]]
        structures.append({
            "name": max(set(names), key=names.count) if names else None,
            "district": members[0]["district"],
            "ways": len(members),
            "roofed": sum(m["roofed"] for m in members),
            "cutting": sum(m["cutting"] for m in members),
            "max_length_m": max(m["length_m"] for m in members),
            "highway": members[0]["highway"],
            "way_ids": [m["id"] for m in members],
        })
    structures.sort(key=lambda s: -s["max_length_m"])

    # ── would the terrain rules have found these on their own? ──────────────
    # Rule 1 is sink > 0.05 AND hand < 0; rule 2 is logacc >= p90 AND slope < 1.
    # The tunnel rule exists because the DEM describes the roof, so this is the
    # number that justifies it: how many underpasses the terrain never sees.
    r1 = [r for r in recs
          if r["sink"] is not None and r["sink"] > 0.05 and r["hand"] < 0]
    seen_hand = [r for r in recs if r["hand"] is not None and r["hand"] >= 0]
    print(f"\nwhat the terrain rules see:")
    print(f"  rule 1 (منخفض مغلق) would have flagged  {len(r1)} of {len(recs)}")
    print(f"  DEM puts ABOVE the drainage line (hand >= 0)  {len(seen_hand)}")
    print(f"  -> {len(recs) - len(r1)} are invisible to the elevation model")

    print(f"\n{len(recs)} ways cluster into {len(structures)} structures "
          f"(endpoints within {CLUSTER_M:.0f} m)")
    print(f"  roofed (tunnel=yes)   {sum(r['roofed'] for r in recs)}")
    print(f"  open cutting          {sum(r['cutting'] for r in recs)}")
    print(f"  neither tag, layer<0  "
          f"{sum(1 for r in recs if not r['roofed'] and not r['cutting'])}")
    print()
    for s in structures[:12]:
        kind = ("مغطّى" if s["roofed"] and not s["cutting"]
                else "حفر مكشوف" if s["cutting"] and not s["roofed"] else "مختلط")
        print(f"  {s['max_length_m']:6.0f} m  {s['ways']}w  {kind:10} "
              f"{(s['name'] or '—')[:44]}")

    OUT.write_text(json.dumps(
        {"ways": recs, "structures": structures,
         "cluster_m": CLUSTER_M, "bbox": meta["bbox"]},
        ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nwrote {OUT.name}  ({OUT.stat().st_size/1024:.0f} KB)")


if __name__ == "__main__":
    main()
