"""Build the terrain + label + road cache for one city.

Generalised from nyc_model.py. Every feature comes from a global source —
Copernicus DEM and OpenStreetMap — so this runs unchanged on any city in
cities.py, which is the same property that lets the feature set reach
Al Madinah.

    python research/build_city.py chicago
"""
from __future__ import annotations

import json
import math
import re
import sys
import urllib.request
from pathlib import Path

import numpy as np

from cities import CITIES
from nyc_model import d8_flow_accumulation, fill_sinks  # the corrected versions

HERE = Path(__file__).parent
UA = {"User-Agent": "Mityaf-research/1.0 (urban flood feature validation)"}
DEM_URL = "https://copernicus-dem-30m.s3.amazonaws.com/{t}/{t}.tif"
OVERPASS = "https://overpass-api.de/api/interpreter"


_POINT = re.compile(r"\(\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*\)")


def coords(row: dict):
    """(lon, lat) from one complaint row, or None if it is not geocoded.

    Portals do not agree on how to publish a location. NYC and Chicago give
    separate `latitude`/`longitude` fields; San Francisco names them `lat`/
    `long`, which the SoQL query aliases away; Dallas publishes a single
    location column serialised as the string "(lat,lon)", which nothing in
    SoQL will split for us. Handling all three here keeps cities.py declarative
    -- a new city stays three lines of config.
    """
    lat, lon = row.get("latitude"), row.get("longitude")
    if lat and lon:
        try:
            return [float(lon), float(lat)]
        except (TypeError, ValueError):
            return None
    for v in row.values():
        if isinstance(v, str) and (m := _POINT.match(v.strip())):
            return [float(m.group(2)), float(m.group(1))]   # stored lat first
        if isinstance(v, dict) and "coordinates" in v:      # GeoJSON point
            c = v["coordinates"]
            return [float(c[0]), float(c[1])]
    return None


def cache_dir(city: str) -> Path:
    d = HERE / "cache" / city
    d.mkdir(parents=True, exist_ok=True)
    return d


def fetch(url, dest: Path, data=None) -> Path:
    if dest.exists() and dest.stat().st_size > 0:
        print(f"    [cache] {dest.name}")
        return dest
    print(f"    [fetch] {dest.name} ...")
    req = urllib.request.Request(url, data=data, headers=UA)
    with urllib.request.urlopen(req, timeout=900) as r, open(dest, "wb") as f:
        f.write(r.read())
    print(f"            {dest.stat().st_size // 1024} KB")
    return dest


def load_dem(city: str, cfg: dict):
    """Elevation for the AOI — bare earth if we have it, surface otherwise.

    FABDEM.tif is preferred when present. Copernicus GLO-30 is a SURFACE model
    including buildings and vegetation, and water does not flow over rooftops:
    over Al Madinah the surface sits 2.44 m above bare earth across the
    built-up tenth of the city and 5.44 m across the densest 1%, which is
    precisely where street flooding occurs. FABDEM removes buildings and trees
    with a learned correction, cutting mean absolute vertical error in built-up
    areas from 1.61 m to 1.12 m.

    Fetch it with `node research/fetch_fabdem.js <city>`.
    LICENCE: FABDEM is CC BY-NC-SA 4.0 — non-commercial.
    """
    import rasterio
    from rasterio.merge import merge

    fab = cache_dir(city) / "FABDEM.tif"
    if fab.exists():
        with rasterio.open(fab) as s:
            dem = s.read(1).astype("float32")
            transform = s.transform
        dem[dem < -1000] = np.nan
        print(f"    FABDEM (bare earth) {dem.shape[1]}x{dem.shape[0]} px")
        return dem, transform

    srcs = []
    for t in cfg["dem_tiles"]:
        pth = fetch(DEM_URL.format(t=t), cache_dir(city) / f"{t}.tif")
        srcs.append(rasterio.open(pth))
    arr, transform = merge(srcs, bounds=cfg["bbox"])
    for s in srcs:
        s.close()
    dem = arr[0].astype("float32")
    dem[dem < -1000] = np.nan
    print(f"    Copernicus (surface, incl. buildings) {dem.shape[1]}x{dem.shape[0]} px")
    return dem, transform


def terrain_stack(dem, transform, lat_mid: float):
    from scipy.ndimage import distance_transform_edt, uniform_filter

    px_m = abs(transform.a) * 111_320 * math.cos(math.radians(lat_mid))
    py_m = abs(transform.e) * 110_540
    cell_area = px_m * py_m

    gy, gx = np.gradient(np.nan_to_num(dem, nan=np.nanmedian(dem)), py_m, px_m)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))

    filled = fill_sinks(dem)
    sink_depth = np.clip(filled - np.nan_to_num(dem, nan=0), 0, None)

    acc = d8_flow_accumulation(filled)
    sca = acc * cell_area / px_m
    twi = np.log(np.maximum(sca, 1.0) / np.maximum(np.tan(np.radians(slope)), 0.001))

    # Height above nearest drainage.
    #
    # Previously a windowed mean of channel elevations, which silently returned
    # `elevation - 0` wherever no channel fell inside the 25 px window: the
    # denominator collapsed to 1e-6 and filled_chan went to zero. At New York
    # elevations that looked plausible and went unnoticed while carrying 8.7%
    # of model gain; at Al Madinah's ~600 m it saturates the 200 m clip and the
    # error is obvious. Now referenced to the nearest drainage cell by
    # Euclidean distance transform — defined everywhere, no empty-window case.
    channel = acc > np.percentile(acc, 99.5)
    z = np.nan_to_num(dem, nan=float(np.nanmedian(dem)))
    if channel.any():
        _, (iy, ix) = distance_transform_edt(~channel, return_indices=True)
        hand = np.clip(z - z[iy, ix], -50, 200)
    else:
        hand = np.zeros_like(z)

    rel_elev = np.nan_to_num(dem, nan=0) - uniform_filter(np.nan_to_num(dem, nan=0), size=17)

    print(f"    slope {np.nanmedian(slope):.2f} deg | TWI {np.nanmedian(twi):.2f} "
          f"| sink max {np.nanmax(sink_depth):.2f} m")
    return dict(slope=slope, twi=twi, sink=sink_depth, hand=hand,
                relelev=rel_elev, logacc=np.log1p(acc))


def load_roads(city: str, bbox):
    q = f"""
    [out:json][timeout:900];
    way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$"]
       ({bbox[1]},{bbox[0]},{bbox[3]},{bbox[2]});
    out geom;
    """
    p = fetch(OVERPASS, cache_dir(city) / "roads.json", data=q.encode())
    data = json.loads(p.read_text(encoding="utf-8"))
    n = sum(1 for e in data.get("elements", []) if e.get("type") == "way" and e.get("geometry"))
    print(f"    roads: {n:,} ways")
    return n


def build(city: str) -> None:
    cfg = CITIES[city]
    print(f"\n=== {cfg['name']} ===")
    cd = cache_dir(city)

    print("  [1] terrain")
    dem, transform = load_dem(city, cfg)
    lat_mid = (cfg["bbox"][1] + cfg["bbox"][3]) / 2
    T = terrain_stack(dem, transform, lat_mid)

    print("  [2] labels")
    if cfg["labels_url"]:
        p = fetch(cfg["labels_url"].replace(" ", "%20"), cd / "labels.json")
        reports = json.loads(p.read_text(encoding="utf-8"))
        pts = np.array([xy for xy in (coords(r) for r in reports) if xy])
        print(f"    {len(pts):,} geocoded complaints "
              f"(expected ~{cfg['expected_labels']:,})")
    else:
        # A city with no ground truth is the whole point of the exercise, not
        # an error: it supplies features and borrows the evidence.
        pts = np.empty((0, 2), dtype="float64")
        print("    none — this city supplies features only")

    print("  [3] roads")
    n_ways = load_roads(city, cfg["bbox"])

    np.save(cd / "terrain.npy", np.stack([T[k] for k in sorted(T)]))
    np.save(cd / "points.npy", pts)
    (cd / "meta.json").write_text(json.dumps({
        "city": city, "name": cfg["name"], "keys": sorted(T), "bbox": list(cfg["bbox"]),
        "transform": [transform.a, transform.b, transform.c,
                      transform.d, transform.e, transform.f],
        "shape": list(dem.shape), "n_reports": len(pts), "n_ways": n_ways,
    }, indent=1), encoding="utf-8")
    print(f"  cached -> research/cache/{city}/")


if __name__ == "__main__":
    targets = sys.argv[1:] or list(CITIES)
    for c in targets:
        if c not in CITIES:
            sys.exit(f"unknown city {c!r}; known: {', '.join(CITIES)}")
        build(c)
