"""Download Sentinel-2 imagery for dated, eyewitness-reported ponding in Madinah.

Two events were reported in حي الملك فهد: water on the street on 28 April 2022,
and water on 15 August 2022 that stood until tankers pumped it. The rainfall
archive corroborates both: 3.8 mm on 27 April, 0.5 mm on 13 August.

Rather than pull ~1 GB Copernicus products, this reads only the district's
pixels straight from the public Sentinel-2 COGs on AWS -- a few hundred KB per
band -- and renders three views per date:

  rgb    what the eye would see
  ndwi   (green - nir) / (green + nir), the standard water index
  mndwi  (green - swir) / (green + swir), which is the one that matters here:
         it separates water from *built-up surface*, where plain NDWI confuses
         water with asphalt and shadow

Each event gets a dry baseline before and after, because a single date shows
almost nothing. The difference between event and baseline is the signal.

Caveat that no processing can remove: pixels are 10 m and the street is 10-20 m
wide, so a puddle spans one to four pixels. Absence of a signal here is not
evidence the water was absent.

    .venv/Scripts/python.exe fetch_observations.py
"""
from __future__ import annotations

import json
import os
import urllib.request
from pathlib import Path

import numpy as np

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_USE_HEAD", "NO")
os.environ.setdefault("AWS_NO_SIGN_REQUEST", "YES")

HERE = Path(__file__).parent
OUT = HERE / "out" / "observations" / "king_fahd"
STAC = "https://earth-search.aws.element84.com/v1/search"

# حي الملك فهد, from the district extent in our own segment data
BBOX = [39.6859, 24.4715, 39.7204, 24.5228]

EVENTS = {
    "2022-04_event": {
        "reported": "28 April 2022 — water on street",
        "rain": "3.8 mm on 27 Apr, 1.0 mm on 28 Apr",
        "dates": {"2022-04-26": "baseline (dry, 1 day before rain)",
                  "2022-05-01": "after (3 days post-rain)"},
    },
    "2022-11_event": {
        "reported": "11 November 2022 — water in حي الملك فهد",
        "rain": "8.2 mm in 3 h on 11 Nov, 0.6 mm the day before",
        "dates": {"2022-11-07": "baseline (dry, 4 days before rain)",
                  "2022-11-12": "EVENT — 1 day after the rain, 5.2% cloud"},
    },
    "2026-03_event": {
        "reported": "26 March 2026 — حديقة الجبل, الملك فهد",
        "rain": "26.5 mm in 11 h on 26 Mar — one of the largest days on record",
        "dates": {"2026-03-21": "baseline (dry, before the storm)",
                  "2026-03-26": "EVENT — same day, but 68% cloud",
                  "2026-03-31": "after (5 days later)"},
    },
    "2022-08_event": {
        "reported": "15 August 2022 — water stood until tankers pumped it",
        "rain": "0.5 mm on 13 Aug (ERA5 ~9 km grid may miss a local cell)",
        "dates": {"2022-08-09": "baseline (dry, 4 days before rain)",
                  "2022-08-14": "EVENT — morning before the sighting",
                  "2022-08-19": "after (4 days later)"},
    },
}
BANDS = ["red", "green", "blue", "nir", "swir16"]


def find_scene(date: str) -> dict | None:
    body = json.dumps({"collections": ["sentinel-2-l2a"], "bbox": BBOX,
                       "datetime": f"{date}T00:00:00Z/{date}T23:59:59Z",
                       "limit": 1}).encode()
    req = urllib.request.Request(STAC, data=body, headers={
        "Content-Type": "application/json", "User-Agent": "mityaf/1.0"})
    feats = json.load(urllib.request.urlopen(req, timeout=120))["features"]
    return feats[0] if feats else None


def read_band(url: str, out_shape=None):
    """Windowed read of one band over the district.

    SWIR is published at 20 m while the visible and NIR bands are 10 m, so the
    arrays differ by a factor of two. `out_shape` resamples on read to a common
    grid, which is required before any band ratio.
    """
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


def stretch(a, lo=2, hi=98):
    """Percentile stretch to 0-255, ignoring nodata."""
    v = a[np.isfinite(a) & (a != 0)]
    if v.size == 0:
        return np.zeros(a.shape, "uint8")
    p1, p2 = np.percentile(v, [lo, hi])
    if p2 <= p1:
        p2 = p1 + 1
    return np.clip((a - p1) / (p2 - p1) * 255, 0, 255).astype("uint8")


def save_png(arr, path: Path, cmap=False):
    from PIL import Image
    if cmap:
        # index high = water: blue where high, grey elsewhere
        g = arr.astype("float32")
        rgb = np.stack([255 - g, 255 - g // 2, np.full_like(g, 255)], -1)
        rgb = np.where(g[..., None] > 40, rgb, np.stack([g, g, g], -1))
        Image.fromarray(rgb.astype("uint8")).save(path)
    else:
        Image.fromarray(arr).save(path)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    index = {}

    for ev, cfg in EVENTS.items():
        print(f"\n=== {ev} — {cfg['reported']} ===")
        print(f"    rain: {cfg['rain']}")
        index[ev] = {"reported": cfg["reported"], "rain": cfg["rain"], "dates": {}}

        for date, note in cfg["dates"].items():
            d = OUT / ev / date
            d.mkdir(parents=True, exist_ok=True)
            scene = find_scene(date)
            if scene is None:
                print(f"  {date}  no scene"); continue

            try:
                px = {"green": read_band(scene["assets"]["green"]["href"])}
                ref = px["green"].shape          # 10 m grid is the reference
                for b in BANDS:
                    if b != "green":
                        px[b] = read_band(scene["assets"][b]["href"], out_shape=ref)
            except Exception as e:                             # noqa: BLE001
                print(f"  {date}  read failed: {str(e)[:60]}"); continue

            rgb = np.dstack([stretch(px["red"]), stretch(px["green"]),
                             stretch(px["blue"])])
            eps = 1e-6
            ndwi = (px["green"] - px["nir"]) / (px["green"] + px["nir"] + eps)
            mndwi = (px["green"] - px["swir16"]) / (px["green"] + px["swir16"] + eps)

            from PIL import Image
            Image.fromarray(rgb).save(d / "rgb.png")
            save_png(stretch(ndwi), d / "ndwi.png", cmap=True)
            save_png(stretch(mndwi), d / "mndwi.png", cmap=True)
            np.save(d / "mndwi.npy", mndwi)

            cc = scene["properties"].get("eo:cloud_cover", 0)
            (d / "README.txt").write_text(
                f"{date} — {note}\nscene: {scene['id']}\ncloud: {cc:.1f}%\n"
                f"bbox: {BBOX}\n\nrgb.png    true colour\n"
                f"ndwi.png   water index (blue = wetter)\n"
                f"mndwi.png  built-up water index — use this one\n",
                encoding="utf-8")
            index[ev]["dates"][date] = {"note": note, "scene": scene["id"],
                                        "cloud": cc, "shape": list(mndwi.shape)}
            print(f"  {date}  {mndwi.shape[1]}x{mndwi.shape[0]} px  "
                  f"cloud {cc:.1f}%  {note}")

        # Change maps. A percentile stretch of the raw difference is
        # useless here -- it spreads sensor noise across the full range and
        # paints the whole city blue. Instead: keep the true-colour image as
        # the base, and overlay ONLY pixels whose MNDWI rose by more than
        # `THR`, which is a real water signal rather than scene drift.
        from PIL import Image
        THR = 0.10
        ds = sorted(index[ev]["dates"])
        if len(ds) >= 2:
            base = np.load(OUT / ev / ds[0] / "mndwi.npy")
            for later in ds[1:]:
                cur = np.load(OUT / ev / later / "mndwi.npy")
                if cur.shape != base.shape:
                    continue
                d = cur - base
                rgb = np.array(Image.open(OUT / ev / later / "rgb.png")).astype("float32")
                grey = rgb.mean(axis=2)
                out_img = np.stack([grey, grey, grey], -1)
                hit = d > THR
                out_img[hit] = [40, 130, 255]
                frac = float(hit.mean())
                Image.fromarray(out_img.astype("uint8")).save(
                    OUT / ev / f"CHANGE_{ds[0]}_to_{later}.png")
                index[ev]["dates"][later]["wetter_fraction"] = frac
                index[ev]["dates"][later]["mndwi_delta_mean"] = float(d.mean())
                flag = ("  <-- scene-wide, likely artefact not water"
                        if frac > 0.10 else "")
                print(f"  change {ds[0]} -> {later}: {frac:.2%} of pixels "
                      f"wetter by >{THR}{flag}")

    (OUT / "index.json").write_text(json.dumps(index, indent=1), encoding="utf-8")
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()
