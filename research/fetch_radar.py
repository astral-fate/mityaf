"""Sentinel-1 radar over حي الملك فهد for the 26 March 2026 storm.

Optical was 68% clouded that day, which is the normal state of affairs during
the rain you actually care about. Radar does not care about cloud, and
Sentinel-1C acquired at 15:21 on the day itself, during an 11-hour,
26.5 mm event -- the largest confirmed against any of the reported sightings.

The product is sentinel-1-rtc, not raw GRD: GRD ships in radar geometry with
ground control points and no CRS, so it cannot be windowed by map coordinates.
RTC is radiometrically terrain-corrected and projected to UTM, which is what
makes a direct before/after comparison of the same ground pixel possible.

Why radar sees standing water: a smooth water surface reflects the pulse away
from the satellite instead of scattering it back, so open water appears very
DARK. Anything that got markedly darker on the storm day than on a dry day is
a candidate.

Why this is harder in a city than in a field, stated plainly: buildings produce
bright double-bounce returns and cast radar shadows that are also dark, so
shadow and water look alike. Treat any detection here as a candidate to check
against the optical image and the street map, never as proof on its own.

    .venv/Scripts/python.exe fetch_radar.py
"""
from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_USE_HEAD", "NO")

HERE = Path(__file__).parent
OUT = HERE / "out" / "observations" / "king_fahd" / "2026-03_event" / "radar"
STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
SIGN = "https://planetarycomputer.microsoft.com/api/sas/v1/sign?href="
BBOX = [39.6859, 24.4715, 39.7204, 24.5228]

DATES = {"2026-03-19": "before the storm (8.9 mm fell this day)",
         "2026-03-26": "THE STORM - 26.5 mm, acquired 15:21",
         "2026-03-31": "dry baseline, 5 days after"}


def search():
    body = json.dumps({"collections": ["sentinel-1-rtc"], "bbox": BBOX,
                       "datetime": "2026-03-18T00:00:00Z/2026-04-02T00:00:00Z",
                       "limit": 10}).encode()
    r = urllib.request.Request(STAC, data=body, headers={
        "Content-Type": "application/json", "User-Agent": "mityaf/1.0"})
    return json.load(urllib.request.urlopen(r, timeout=120))["features"]


def sign(href: str) -> str:
    u = SIGN + urllib.parse.quote(href, safe="")
    r = urllib.request.Request(u, headers={"User-Agent": "mityaf/1.0"})
    return json.load(urllib.request.urlopen(r, timeout=90))["href"]


def read(url: str, out_shape=None):
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.warp import transform_bounds
    from rasterio.windows import from_bounds
    with rasterio.open(url) as src:
        b = transform_bounds("EPSG:4326", src.crs, *BBOX)
        w = from_bounds(*b, transform=src.transform)
        kw = {} if out_shape is None else {
            "out_shape": out_shape, "resampling": Resampling.bilinear}
        return src.read(1, window=w, out_dtype="float32", boundless=True,
                        fill_value=0, **kw)


def to_db(a):
    """GRD pixels are linear power; decibels are how radar is read."""
    return 10.0 * np.log10(np.clip(a, 1e-6, None))


def png(a, path, lo=-25.0, hi=0.0):
    from PIL import Image
    g = np.clip((a - lo) / (hi - lo) * 255, 0, 255).astype("uint8")
    Image.fromarray(g).save(path)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    scenes = {f["properties"]["datetime"][:10]: f for f in search()}
    db, ref = {}, None

    for date, note in DATES.items():
        if date not in scenes:
            print(f"  {date}  no scene"); continue
        d = OUT / date
        d.mkdir(exist_ok=True)
        try:
            vv = read(sign(scenes[date]["assets"]["vv"]["href"]), out_shape=ref)
        except Exception as e:                                 # noqa: BLE001
            print(f"  {date}  failed: {str(e)[:70]}"); continue
        if ref is None:
            ref = vv.shape
        x = to_db(vv)
        db[date] = x
        png(x, d / "vv_db.png")
        (d / "README.txt").write_text(
            f"{date} - {note}\nscene: {scenes[date]['id']}\n"
            f"VV backscatter in dB. DARK = smooth surface = possible standing "
            f"water.\nBuildings also cast dark radar shadows - check against "
            f"the optical image.\n", encoding="utf-8")
        print(f"  {date}  {x.shape[1]}x{x.shape[0]} px  "
              f"median {np.median(x):.1f} dB  {note}")

    # Water candidates: markedly darker on the storm day than on the dry day.
    if "2026-03-26" in db and "2026-03-31" in db:
        from PIL import Image
        diff = db["2026-03-26"] - db["2026-03-31"]
        for thr in (-3.0, -5.0):
            hit = diff < thr
            base = np.clip((db["2026-03-31"] + 25) / 25 * 255, 0, 255)
            rgb = np.stack([base, base, base], -1)
            rgb[hit] = [40, 130, 255]
            Image.fromarray(rgb.astype("uint8")).save(
                OUT / f"WATER_CANDIDATES_{abs(thr):.0f}dB.png")
            print(f"  darker by >{abs(thr):.0f} dB on storm day: "
                  f"{hit.sum():,} px ({hit.mean():.2%})")
        np.save(OUT / "diff_db.npy", diff)
        print(f"  diff: mean {diff.mean():+.2f} dB, sd {diff.std():.2f}")

    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()
