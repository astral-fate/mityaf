"""Composite a real Sentinel-2 view of Madinah and bake it into the web app.

The landing page needs actual satellite imagery, not an illustration of one.
EOX s2cloudless is a cloud-free Sentinel-2 mosaic at 10 m, published CC-BY 4.0,
which is genuinely reusable — unlike most basemaps.

We fetch once and commit the result rather than pointing the page at their
tile server: a demo that goes blank because someone else's CDN is down is not
a demo. Attribution stays on the page either way.
"""
from __future__ import annotations

import io
import math
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image, ImageEnhance

OUT = Path("apps/web/public/img")
OUT.mkdir(parents=True, exist_ok=True)

Z = 14                       # ~8.7 m/px at this latitude — Sentinel-2 native
AOI = (39.50, 24.36, 39.72, 24.58)     # W, S, E, N — the pipeline's AOI
TILE = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg"
UA = {"User-Agent": "Mityaf/1.0 (urban water platform; one-time mosaic build)"}


def deg2tile(lon: float, lat: float, z: int) -> tuple[float, float]:
    n = 2 ** z
    r = math.radians(lat)
    return ((lon + 180.0) / 360.0 * n,
            (1.0 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2.0 * n)


def grab(args):
    z, x, y = args
    for attempt in range(4):
        try:
            req = urllib.request.Request(TILE.format(z=z, x=x, y=y), headers=UA)
            with urllib.request.urlopen(req, timeout=45) as r:
                return x, y, Image.open(io.BytesIO(r.read())).convert("RGB")
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    print(f"    missing {z}/{x}/{y}")
    return x, y, None


def main() -> None:
    x0f, y1f = deg2tile(AOI[0], AOI[3], Z)      # NW corner
    x1f, y0f = deg2tile(AOI[2], AOI[1], Z)      # SE corner
    x0, x1 = int(math.floor(x0f)), int(math.floor(x1f))
    y0, y1 = int(math.floor(y1f)), int(math.floor(y0f))
    cols, rows = x1 - x0 + 1, y1 - y0 + 1
    print(f"mosaic z{Z}: {cols} x {rows} = {cols*rows} tiles -> {cols*256} x {rows*256} px")

    canvas = Image.new("RGB", (cols * 256, rows * 256), (8, 12, 30))
    jobs = [(Z, x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
    done = 0
    with ThreadPoolExecutor(max_workers=6) as pool:
        for x, y, img in pool.map(grab, jobs):
            if img is not None:
                canvas.paste(img, ((x - x0) * 256, (y - y0) * 256))
            done += 1
            if done % 24 == 0:
                print(f"    {done}/{len(jobs)}")

    # Desert reflectance is bright and low-contrast; the page ground is midnight
    # navy. Pull it down and cool it slightly so the neon overlay stays legible
    # on top — this is presentation grading, not a change to the measurement.
    graded = ImageEnhance.Color(canvas).enhance(0.82)
    graded = ImageEnhance.Contrast(graded).enhance(1.16)
    graded = ImageEnhance.Brightness(graded).enhance(0.86)

    canvas.save(OUT / "madinah-s2-raw.jpg", quality=88, optimize=True)
    graded.save(OUT / "madinah-s2.jpg", quality=86, optimize=True)

    # A tight crop on the city core for the section that explains the spill ring.
    cx, cy = deg2tile(39.6111, 24.4672, Z)       # the Prophet's Mosque
    px, py = (cx - x0) * 256, (cy - y0) * 256
    half = 560
    core = graded.crop((int(px - half), int(py - half), int(px + half), int(py + half)))
    core.save(OUT / "madinah-core.jpg", quality=88, optimize=True)

    for p in sorted(OUT.glob("*.jpg")):
        print(f"  {p.name:22} {p.stat().st_size // 1024:5d} KB  {Image.open(p).size}")


if __name__ == "__main__":
    main()
