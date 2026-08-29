"""Radar time series of the King Fahd basin, 2018-2026, against its surroundings.

Earlier attempts compared a whole district on a storm day against the same
district on a dry day, and every one drowned in scene-level variation --
calibration, incidence angle, soil moisture -- which moves the entire image at
once. A dry-versus-dry control produced the same "detections" as the storm.

This is the paired design that removes exactly that problem. Within a single
scene we take two populations of pixels:

  BASIN  the 57 segments inside the closed depression (sink > 0.05 m, HAND < 0)
  RING   segments in the same neighbourhood that are NOT in the depression

Because both are read from the same image, on the same pass, any effect common
to the scene cancels in the difference. The question becomes narrow and
testable: on wet days, does the basin get darker *relative to its own
surroundings* than it does on dry days? Standing water is smooth, reflects the
pulse away from the sensor, and should lower basin backscatter specifically.

If the wet-day and dry-day distributions of (basin - ring) overlap, the answer
is no, and no amount of processing will change it.

    .venv/Scripts/python.exe basin_timeseries.py
"""
from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_USE_HEAD", "NO")

HERE = Path(__file__).parent
OUT = HERE / "out" / "incidents"
PC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
SIGN = "https://planetarycomputer.microsoft.com/api/sas/v1/sign?href="
BOX = [39.690, 24.496, 39.711, 24.513]        # basin plus a margin of ring
WET_MM = 5.0


def sign(h):
    u = SIGN + urllib.parse.quote(h, safe="")
    return json.load(urllib.request.urlopen(
        urllib.request.Request(u, headers={"User-Agent": "mityaf/1.0"}),
        timeout=90))["href"]


def scenes(a, b):
    out, seen = [], set()
    for yr in range(int(a[:4]), int(b[:4]) + 1):
        body = json.dumps({"collections": ["sentinel-1-rtc"], "bbox": BOX,
                           "datetime": f"{yr}-01-01T00:00:00Z/{yr}-12-31T23:59:59Z",
                           "limit": 100}).encode()
        r = urllib.request.Request(PC, data=body, headers={
            "Content-Type": "application/json", "User-Agent": "mityaf/1.0"})
        for f in json.load(urllib.request.urlopen(r, timeout=180))["features"]:
            d = f["properties"]["datetime"][:10]
            if d not in seen:
                seen.add(d)
                out.append(f)
    return sorted(out, key=lambda f: f["properties"]["datetime"])


def sample(url, pts):
    """Backscatter in dB at each (lon, lat)."""
    import rasterio
    with rasterio.open(url) as s:
        from rasterio.warp import transform
        xs, ys = transform("EPSG:4326", s.crs, [p[0] for p in pts],
                           [p[1] for p in pts])
        v = np.array([x[0] for x in s.sample(zip(xs, ys))], dtype="float32")
    return 10 * np.log10(np.clip(v, 1e-6, None))


def main() -> None:
    seg = pd.read_csv(HERE / "out" / "madinah_segments_features.csv")
    seg.columns = [c.lstrip("﻿") for c in seg.columns]
    near = seg[(seg.lon.between(BOX[0], BOX[2])) & (seg.lat.between(BOX[1], BOX[3]))]
    basin = near[(near.sink > 0.05) & (near.hand < 0)]
    ring = near[(near.sink <= 0.01) & (near.hand >= 0)]
    print(f"basin segments {len(basin)}   ring segments {len(ring)}")
    if len(basin) < 10 or len(ring) < 10:
        raise SystemExit("not enough points for a paired test")
    bp = list(zip(basin.lon, basin.lat))
    rp = list(zip(ring.lon, ring.lat))

    rain = pd.read_csv(OUT / "predicted_ponding_days.csv") if (
        OUT / "predicted_ponding_days.csv").exists() else None
    q = ("https://archive-api.open-meteo.com/v1/archive?" + urllib.parse.urlencode({
        "latitude": 24.5037, "longitude": 39.7022,
        "start_date": "2017-12-01", "end_date": "2026-08-28",
        "daily": "precipitation_sum", "timezone": "auto"}))
    d = json.load(urllib.request.urlopen(q, timeout=180))["daily"]
    pr = pd.Series([x or 0.0 for x in d["precipitation_sum"]],
                   index=pd.to_datetime(d["time"]))
    pr3 = pr.rolling(3, min_periods=1).sum()

    rows = []
    sc = scenes("2018-01-01", "2026-08-28")
    print(f"scenes to sample: {len(sc)}\n")
    for i, f in enumerate(sc):
        date = f["properties"]["datetime"][:10]
        try:
            u = sign(f["assets"]["vv"]["href"])
            b_db, r_db = sample(u, bp), sample(u, rp)
        except Exception as e:                                 # noqa: BLE001
            print(f"  {date}  skip ({str(e)[:40]})"); continue
        t = pd.Timestamp(date)
        rows.append({"date": date,
                     "basin_db": float(np.nanmedian(b_db)),
                     "ring_db": float(np.nanmedian(r_db)),
                     "delta_db": float(np.nanmedian(b_db) - np.nanmedian(r_db)),
                     "mm": float(pr.get(t, 0.0)),
                     "mm_3day": float(pr3.get(t, 0.0))})
        if i % 20 == 0:
            print(f"  ... {i}/{len(sc)}  {date}")

    df = pd.DataFrame(rows).sort_values("date")
    df["wet"] = df["mm_3day"] >= WET_MM
    df.to_csv(OUT / "basin_radar_timeseries.csv", index=False)

    wet, dry = df[df.wet], df[~df.wet]
    print(f"\n{'':4}{'n':>5}{'basin-ring dB':>16}{'sd':>8}")
    print(f"  wet {len(wet):5d}{wet.delta_db.mean():16.3f}{wet.delta_db.std():8.3f}")
    print(f"  dry {len(dry):5d}{dry.delta_db.mean():16.3f}{dry.delta_db.std():8.3f}")
    if len(wet) >= 3 and len(dry) >= 3:
        from scipy.stats import mannwhitneyu
        u, p = mannwhitneyu(wet.delta_db, dry.delta_db, alternative="less")
        eff = wet.delta_db.mean() - dry.delta_db.mean()
        print(f"\n  difference {eff:+.3f} dB   Mann-Whitney p = {p:.4f}")
        print("  -> " + ("DETECTION: basin darkens on wet days" if p < 0.05
                         else "no detection: wet and dry are indistinguishable"))
    print(f"\n  wettest days observed by radar:")
    for _, r in df.nlargest(6, "mm_3day").iterrows():
        print(f"    {r.date}  {r.mm_3day:5.1f} mm/3d   basin-ring {r.delta_db:+.2f} dB")
    print(f"\nwrote {OUT / 'basin_radar_timeseries.csv'}")


if __name__ == "__main__":
    main()
