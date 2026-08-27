"""Cut the hero frame from the mosaic and project our network into it.

The hero draws our real street segments over the real Sentinel-2 image, so the
two must share one coordinate frame exactly. Rather than ship projection maths
to the browser we bake normalised [0,1] coordinates here, in the frame of the
cropped hero image itself — the canvas then only multiplies by its own width.

The full network is 30,337 segments / 6.3 MB. That is a dashboard payload, not
a landing-page payload, so we decimate and round to what a screen can resolve.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image

WEB = Path("apps/web")
IMG = WEB / "public/img"
Z, TILE_PX = 14, 256
AOI = (39.50, 24.36, 39.72, 24.58)
MOSQUE = (39.6111, 24.4672)          # المسجد النبوي — the city's optical centre
HERO_ASPECT = 16 / 9
TARGET_SEGMENTS = 7000


def merc(lon: float, lat: float, z: int = Z) -> tuple[float, float]:
    n = 2 ** z
    r = math.radians(lat)
    return ((lon + 180.0) / 360.0 * n,
            (1.0 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2.0 * n)


def main() -> None:
    # The mosaic starts at whole tile boundaries, not at the AOI corners, so
    # anything projected against the AOI alone lands a few hundred metres off.
    x0f, y1f = merc(*[AOI[0], AOI[3]])
    x1f, y0f = merc(*[AOI[2], AOI[1]])
    tx0, ty0 = math.floor(x0f), math.floor(y1f)
    tx1, ty1 = math.floor(x1f), math.floor(y0f)
    MW, MH = (tx1 - tx0 + 1) * TILE_PX, (ty1 - ty0 + 1) * TILE_PX

    def mosaic_px(lon, lat):
        mx, my = merc(lon, lat)
        return ((mx - tx0) * TILE_PX, (my - ty0) * TILE_PX)

    mqx, mqy = mosaic_px(*MOSQUE)
    cw = MW
    ch = int(round(cw / HERO_ASPECT))
    cy0 = int(round(min(max(mqy - ch / 2, 0), MH - ch)))
    box = (0, cy0, cw, cy0 + ch)
    print(f"mosaic {MW}x{MH}  mosque at ({mqx:.0f},{mqy:.0f})  hero crop {box}")

    src = Image.open(IMG / "madinah-s2.jpg")
    src.crop(box).save(IMG / "madinah-hero.jpg", quality=86, optimize=True)

    def to_unit(lon, lat):
        px, py = mosaic_px(lon, lat)
        return ((px - box[0]) / cw, (py - box[1]) / ch)

    segs = json.loads((WEB / "public/data/segments.geojson").read_text(encoding="utf-8"))
    feats = segs["features"]
    step = max(1, len(feats) // TARGET_SEGMENTS)
    lines = []
    for feat in feats[::step]:
        pts = []
        for lon, lat in feat["geometry"]["coordinates"]:
            ux, uy = to_unit(lon, lat)
            if -0.02 <= ux <= 1.02 and -0.02 <= uy <= 1.02:
                pts.extend((round(ux, 4), round(uy, 4)))
        if len(pts) >= 4:
            lines.append(pts)

    green = json.loads((WEB / "public/data/green.geojson").read_text(encoding="utf-8"))
    blobs = []
    for feat in green["features"]:
        if feat["properties"].get("t") != "green":
            continue
        geom = feat["geometry"]
        rings = geom["coordinates"] if geom["type"] == "Polygon" else \
            [r for poly in geom["coordinates"] for r in poly]
        if not rings:
            continue
        xs = [p[0] for p in rings[0]]
        ys = [p[1] for p in rings[0]]
        ux, uy = to_unit(sum(xs) / len(xs), sum(ys) / len(ys))
        if 0 <= ux <= 1 and 0 <= uy <= 1:
            r = math.sqrt(max(feat["properties"].get("area") or 400, 400) / math.pi)
            blobs.append([round(ux, 4), round(uy, 4), round(r / 9.0, 1)])

    dest = WEB / "public/data/hero-layer.json"
    dest.write_text(json.dumps(
        {"frame": {"w": cw, "h": ch}, "lines": lines, "green": blobs},
        separators=(",", ":")), encoding="utf-8")

    print(f"  segments {len(lines):,} of {len(feats):,} (every {step})   green {len(blobs)}")
    print(f"  hero-layer.json {dest.stat().st_size // 1024} KB")

    # Alignment proof: burn the vectors onto the raster and eyeball it once.
    from PIL import ImageDraw
    chk = Image.open(IMG / "madinah-hero.jpg").convert("RGB")
    d = ImageDraw.Draw(chk)
    for pts in lines:
        d.line([(pts[i] * cw, pts[i + 1] * ch) for i in range(0, len(pts), 2)],
               fill=(0, 220, 255), width=2)
    for ux, uy, r in blobs:
        d.ellipse([ux * cw - r, uy * ch - r, ux * cw + r, uy * ch + r],
                  outline=(80, 255, 74), width=3)
    chk.resize((1408, int(1408 / HERO_ASPECT))).save("/tmp/align_check.jpg", quality=82)
    print("  wrote /tmp/align_check.jpg")


if __name__ == "__main__":
    main()
