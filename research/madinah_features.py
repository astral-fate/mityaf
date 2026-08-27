"""Produce the nine-feature table for Al Madinah.

Same nine columns as the NYC and Chicago training matrices, computed the same
way from the same two global sources — so a model fitted on those cities can
be applied here directly, and so anyone can inspect or re-fit on the numbers
themselves.

Run build_city.py madinah first.

Outputs, into research/out/:
  madinah_segments_features.csv    one row per street segment, 9 features
  madinah_grid_features.csv        one row per 200 m cell, 9 features
                                   (the grid version matches the training
                                    matrices exactly, for direct model transfer)

    python research/madinah_features.py
"""
from __future__ import annotations

import csv
import json
import math
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
CACHE = HERE / "cache" / "madinah"
WEB = HERE.parent / "apps" / "web" / "public" / "data"
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)

CELL_DEG = 200.0 / 111_320.0
FEATURES = ["slope", "twi", "sink", "hand", "logacc", "relelev",
            "road_density", "major_frac", "load_per_road"]


def densify(coords, step_deg=CELL_DEG / 3):
    out = []
    for (x0, y0), (x1, y1) in zip(coords[:-1], coords[1:]):
        d = math.hypot(x1 - x0, y1 - y0)
        n = max(1, int(d / step_deg))
        for i in range(n):
            t = i / n
            out.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, d / n))
    return out


def main() -> None:
    meta = json.loads((CACHE / "meta.json").read_text())
    terrain = np.load(CACHE / "terrain.npy")
    roads = json.loads((CACHE / "roads.json").read_text(encoding="utf-8"))
    keys = meta["keys"]
    bbox = meta["bbox"]
    a, b, c, d, e, f = meta["transform"]
    ny, nx = meta["shape"]

    nxg = int((bbox[2] - bbox[0]) / CELL_DEG) + 1
    nyg = int((bbox[3] - bbox[1]) / CELL_DEG) + 1
    print(f"grid {nxg} x {nyg} cells @ 200 m over {meta['name']}")

    # ── road density per cell, from the same OSM extract ──
    road_len = np.zeros((nyg, nxg), dtype="float32")
    major_len = np.zeros((nyg, nxg), dtype="float32")
    MAJOR = {"motorway", "trunk", "primary", "secondary"}
    for el in roads.get("elements", []):
        if el.get("type") != "way" or not el.get("geometry"):
            continue
        cs = [(g["lon"], g["lat"]) for g in el["geometry"]]
        if len(cs) < 2:
            continue
        is_major = el.get("tags", {}).get("highway") in MAJOR
        for lon, lat, seg in densify(cs):
            gx = int((lon - bbox[0]) / CELL_DEG)
            gy = int((lat - bbox[1]) / CELL_DEG)
            if 0 <= gx < nxg and 0 <= gy < nyg:
                m = seg * 111_320 * math.cos(math.radians(lat))
                road_len[gy, gx] += m
                if is_major:
                    major_len[gy, gx] += m

    band = {k: terrain[i] for i, k in enumerate(keys)}
    cell_area_km2 = 0.04
    dens = (road_len / 1000.0) / cell_area_km2
    majf = np.divide(major_len, np.maximum(road_len, 1e-6))

    def sample(lon, lat):
        """Nine features at one coordinate."""
        col = int(np.clip((lon - c) / a, 0, nx - 1))
        row = int(np.clip((lat - f) / e, 0, ny - 1))
        gx = int(np.clip((lon - bbox[0]) / CELL_DEG, 0, nxg - 1))
        gy = int(np.clip((lat - bbox[1]) / CELL_DEG, 0, nyg - 1))
        acc = math.expm1(float(band["logacc"][row, col]))
        return {
            "slope": float(band["slope"][row, col]),
            "twi": float(band["twi"][row, col]),
            "sink": float(band["sink"][row, col]),
            "hand": float(band["hand"][row, col]),
            "logacc": float(band["logacc"][row, col]),
            "relelev": float(band["relelev"][row, col]),
            "road_density": float(dens[gy, gx]),
            "major_frac": float(majf[gy, gx]),
            "load_per_road": float(math.log1p(acc / max(float(road_len[gy, gx]), 25.0))),
        }

    # ── per street segment ──
    segs = json.loads((WEB / "segments.geojson").read_text(encoding="utf-8"))
    rows = []
    for feat in segs["features"]:
        cs = feat["geometry"]["coordinates"]
        if len(cs) < 2:
            continue
        # midpoint of the segment: one representative sample per unit
        mid = cs[len(cs) // 2]
        p = feat["properties"]
        rows.append({
            "unit_id": p.get("id"),
            "name_ar": p.get("name") or "",
            "district_ar": p.get("d") or "",
            "lon": round(mid[0], 6),
            "lat": round(mid[1], 6),
            **{k: round(v, 5) for k, v in sample(mid[0], mid[1]).items()},
        })

    seg_path = OUT / "madinah_segments_features.csv"
    with seg_path.open("w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    print(f"  {seg_path.name}  {len(rows):,} segments  "
          f"{seg_path.stat().st_size // 1024} KB")

    # ── per 200 m cell, matching the training matrices exactly ──
    grid_rows = []
    for gy in range(nyg):
        for gx in range(nxg):
            if road_len[gy, gx] <= 50.0:
                continue          # same road-bearing rule as the training set
            lon = bbox[0] + (gx + 0.5) * CELL_DEG
            lat = bbox[1] + (gy + 0.5) * CELL_DEG
            grid_rows.append({
                "cell_x": gx, "cell_y": gy,
                "lon": round(lon, 6), "lat": round(lat, 6),
                "road_len_m": round(float(road_len[gy, gx]), 1),
                **{k: round(v, 5) for k, v in sample(lon, lat).items()},
            })

    grid_path = OUT / "madinah_grid_features.csv"
    with grid_path.open("w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=list(grid_rows[0]))
        w.writeheader()
        w.writerows(grid_rows)
    print(f"  {grid_path.name}  {len(grid_rows):,} cells  "
          f"{grid_path.stat().st_size // 1024} KB")

    # ── a short readout, so the numbers are sanity-checked on the way out ──
    print("\n  feature ranges over road-bearing cells:")
    arr = {k: np.array([r[k] for r in grid_rows]) for k in FEATURES}
    for k in FEATURES:
        v = arr[k]
        print(f"    {k:15} min {v.min():9.3f}  median {np.median(v):9.3f}  max {v.max():9.3f}")


if __name__ == "__main__":
    main()
