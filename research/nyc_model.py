"""
Validate the Mityaf feature engineering on a city that HAS ground truth.

Madinah has no labelled flood inventory — nobody surveys ponding during a storm.
New York does: 311 carries a "Street Flooding (SJ)" descriptor, geocoded and
timestamped, and it is exactly our Module B phenomenon ("flooding or ponding on
a street"). 21,287 georeferenced reports, 2020-2026, continuous.

So we train and validate here, then carry the model FORM (not its weights) to
Madinah. The terrain-hydrology relationships are physical and transfer; the
climate and drainage-design terms do not, and we say so.

Two methodological choices matter more than the model:

1. NEGATIVE SAMPLING. Complaints are presence-only. If negatives are drawn from
   anywhere, the model learns "there is a road here" — parks, water and rail
   have neither roads nor complaints, and separate trivially. Negatives are
   therefore drawn ONLY from cells that carry road, so the model must explain
   why one street floods and another does not.

2. SPATIAL BLOCK CV. Terrain predictors are strongly autocorrelated: adjacent
   cells share slope, catchment and imperviousness. Ordinary k-fold puts
   neighbours in both train and test and reports a beautiful, meaningless
   score. Folds are whole spatial blocks.

    docker run --rm -v "D:\\barmajan\\masareb:/app" -w /app python:3.11 \
      sh -c "pip install -q rasterio numpy scipy scikit-learn xgboost requests && \
             python research/nyc_model.py"
"""
from __future__ import annotations

import io
import json
import math
import os
import urllib.request
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
CACHE = HERE / "cache"
CACHE.mkdir(exist_ok=True)

# NYC, clipped to the boroughs that carry most reports
BBOX = (-74.05, 40.54, -73.70, 40.92)   # W, S, E, N
CELL_M = 200.0                           # analysis grid ~ one street segment

DEM_TILES = [
    "Copernicus_DSM_COG_10_N40_00_W074_00_DEM",
    "Copernicus_DSM_COG_10_N40_00_W075_00_DEM",
]
DEM_URL = "https://copernicus-dem-30m.s3.amazonaws.com/{t}/{t}.tif"

NYC_311 = (
    "https://data.cityofnewyork.us/resource/erm2-nwe9.json"
    "?$select=created_date,descriptor,latitude,longitude,borough"
    "&$where=descriptor='Street Flooding (SJ)' AND latitude IS NOT NULL"
    "&$limit=50000"
)

OVERPASS = "https://overpass-api.de/api/interpreter"
UA = {"User-Agent": "Mityaf-research/1.0 (urban flood feature validation)"}


def fetch(url, dest: Path, data=None) -> Path:
    if dest.exists() and dest.stat().st_size > 0:
        print(f"  [cache] {dest.name}")
        return dest
    print(f"  [fetch] {dest.name} ...")
    req = urllib.request.Request(url, data=data, headers=UA)
    with urllib.request.urlopen(req, timeout=600) as r, open(dest, "wb") as f:
        f.write(r.read())
    print(f"          {dest.stat().st_size // 1024} KB")
    return dest


# ── terrain ────────────────────────────────────────────────────────────────
def load_dem():
    """Mosaic the Copernicus DEM tiles covering the bbox and clip."""
    import rasterio
    from rasterio.merge import merge
    from rasterio.windows import from_bounds

    srcs = []
    for t in DEM_TILES:
        p = fetch(DEM_URL.format(t=t), CACHE / f"{t}.tif")
        srcs.append(rasterio.open(p))

    arr, transform = merge(srcs, bounds=BBOX)
    for s in srcs:
        s.close()
    dem = arr[0].astype("float32")
    dem[dem < -1000] = np.nan
    print(f"  DEM  {dem.shape[1]}x{dem.shape[0]} px")
    return dem, transform


def fill_sinks(dem):
    """Priority-flood depression filling (Barnes et al.).

    The naive iterative version raised cells by only 0.06 m over 60 sweeps,
    which makes depression depth a dead feature — and depression depth is the
    most direct "puddle" predictor there is. This does it properly: push the
    boundary into a min-heap, pop the lowest cell, and raise each unvisited
    neighbour to at least that level. One pass, exact.
    """
    import heapq

    z = np.nan_to_num(dem, nan=float(np.nanmax(dem)))
    ny, nx = z.shape
    filled = z.copy()
    seen = np.zeros((ny, nx), dtype=bool)
    heap = []

    for y in range(ny):
        for x in (0, nx - 1):
            heapq.heappush(heap, (float(z[y, x]), y, x)); seen[y, x] = True
    for x in range(nx):
        for y in (0, ny - 1):
            if not seen[y, x]:
                heapq.heappush(heap, (float(z[y, x]), y, x)); seen[y, x] = True

    nbrs = ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1))
    while heap:
        zc, y, x = heapq.heappop(heap)
        for dy, dx in nbrs:
            ty, tx = y + dy, x + dx
            if 0 <= ty < ny and 0 <= tx < nx and not seen[ty, tx]:
                seen[ty, tx] = True
                lvl = max(float(z[ty, tx]), zc)
                filled[ty, tx] = lvl
                heapq.heappush(heap, (lvl, ty, tx))
    return filled


def d8_flow_accumulation(dem):
    """D8 direction + accumulation by descending-elevation sweep.

    Pure numpy: the whole NYC grid is ~1300x1400, which is nothing.
    """
    ny, nx = dem.shape
    z = np.nan_to_num(dem, nan=np.nanmax(dem))

    offs = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    dist = np.array([math.sqrt(2), 1, math.sqrt(2), 1, 1, math.sqrt(2), 1, math.sqrt(2)])

    best_drop = np.zeros((ny, nx), dtype="float32")
    best_dir = np.full((ny, nx), -1, dtype="int8")

    for k, (dy, dx) in enumerate(offs):
        shifted = np.roll(np.roll(z, -dy, axis=0), -dx, axis=1)
        drop = (z - shifted) / dist[k]
        # edges wrap under roll; suppress them
        if dy == -1: drop[-1, :] = -np.inf
        if dy == 1:  drop[0, :] = -np.inf
        if dx == -1: drop[:, -1] = -np.inf
        if dx == 1:  drop[:, 0] = -np.inf
        better = drop > best_drop
        best_drop[better] = drop[better]
        best_dir[better] = k

    acc = np.ones((ny, nx), dtype="float32")
    order = np.argsort(z.ravel())[::-1]           # high to low
    ys, xs = np.unravel_index(order, (ny, nx))
    for y, x in zip(ys, xs):
        k = best_dir[y, x]
        if k < 0:
            continue
        dy, dx = offs[k]
        ty, tx = y + dy, x + dx
        if 0 <= ty < ny and 0 <= tx < nx:
            acc[ty, tx] += acc[y, x]
    return acc


def terrain_stack(dem, transform):
    from scipy.ndimage import uniform_filter

    px_m = abs(transform.a) * 111_320 * math.cos(math.radians(40.7))
    py_m = abs(transform.e) * 110_540
    cell_area = px_m * py_m

    gy, gx = np.gradient(np.nan_to_num(dem, nan=np.nanmedian(dem)), py_m, px_m)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))

    filled = fill_sinks(dem)
    sink_depth = np.clip(filled - np.nan_to_num(dem, nan=0), 0, None)

    acc = d8_flow_accumulation(filled)
    sca = acc * cell_area / px_m                       # specific contributing area
    twi = np.log(np.maximum(sca, 1.0) / np.maximum(np.tan(np.radians(slope)), 0.001))

    # Height above the local drainage line: proxy HAND using the elevation of the
    # most-accumulating cells nearby, which in a city is where water concentrates.
    channel = acc > np.percentile(acc, 99.5)
    chan_z = np.where(channel, np.nan_to_num(dem, nan=0), np.nan)
    filled_chan = uniform_filter(np.nan_to_num(chan_z, nan=0), size=25) / np.maximum(
        uniform_filter(channel.astype("float32"), size=25), 1e-6)
    hand = np.nan_to_num(dem, nan=0) - filled_chan
    hand = np.clip(hand, -50, 200)

    rel_elev = np.nan_to_num(dem, nan=0) - uniform_filter(
        np.nan_to_num(dem, nan=0), size=17)

    print(f"  terrain: slope {np.nanmedian(slope):.2f} deg median, "
          f"TWI {np.nanmedian(twi):.2f}, sink {np.nanmax(sink_depth):.2f} m max")
    return dict(slope=slope, twi=twi, sink=sink_depth, hand=hand,
                relelev=rel_elev, logacc=np.log1p(acc))


# ── roads ──────────────────────────────────────────────────────────────────
def load_roads():
    q = f"""
    [out:json][timeout:600];
    way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$"]
       ({BBOX[1]},{BBOX[0]},{BBOX[3]},{BBOX[2]});
    out geom;
    """
    p = fetch(OVERPASS, CACHE / "nyc_roads.json", data=q.encode())
    data = json.loads(p.read_text(encoding="utf-8"))
    ways = []
    for el in data.get("elements", []):
        if el.get("type") == "way" and el.get("geometry"):
            ways.append(([(g["lon"], g["lat"]) for g in el["geometry"]],
                         el.get("tags", {}).get("highway")))
    print(f"  roads: {len(ways):,} ways")
    return ways


def main() -> None:
    print("=" * 68)
    print("Mityaf — feature validation on labelled NYC street-flooding data")
    print("=" * 68)

    print("\n[1] terrain")
    dem, transform = load_dem()
    T = terrain_stack(dem, transform)

    print("\n[2] labels (NYC 311 Street Flooding)")
    p = fetch(NYC_311.replace(" ", "%20"), CACHE / "nyc_311_sf.json")
    reports = json.loads(p.read_text(encoding="utf-8"))
    pts = np.array([[float(r["longitude"]), float(r["latitude"])] for r in reports
                    if r.get("latitude")])
    print(f"  {len(pts):,} geocoded complaints")

    print("\n[3] roads")
    ways = load_roads()

    np.save(CACHE / "terrain.npy", np.stack([T[k] for k in sorted(T)]))
    meta = {"keys": sorted(T), "bbox": BBOX,
            "transform": [transform.a, transform.b, transform.c,
                          transform.d, transform.e, transform.f],
            "shape": list(dem.shape), "n_reports": len(pts), "n_ways": len(ways)}
    (CACHE / "meta.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    np.save(CACHE / "points.npy", pts)
    print("\n  cached terrain stack, points and roads -> research/cache/")
    print("  next: research/nyc_train.py builds the grid and trains the model")


if __name__ == "__main__":
    main()
