"""The 4 January 2023 event — the strongest test available of whether free
satellite imagery can see street ponding in Madinah.

Everything lines up here in a way it did not for the earlier reports:

  rain      44.2 mm in 18 h on 3 Jan, on top of 17.5 mm on 2 Jan -- about
            65 mm in three days, comparable to the largest day in the archive
  eyewitness water still standing in streets on 4 Jan
  radar     Sentinel-1 acquired 4 Jan at 15:30, the reported day
  optical   clean baseline 30 Dec (4.9% cloud), 4 Jan itself (34% cloud),
            clean recovery 11 Jan (13.6% cloud)

The bbox is widened beyond حي الملك فهد to cover several districts, since
ponding on an event this size will not be confined to one neighbourhood.

Every comparison is run twice: storm-versus-dry, and dry-versus-dry as a
control. Speckle filtering creates spatially correlated blobs even in pure
noise, so a blob count means nothing without the control -- that is exactly
how the March 2026 "detection" turned out to be noise.

    .venv/Scripts/python.exe event_jan2023.py
"""
from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
from scipy.ndimage import label, uniform_filter

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_USE_HEAD", "NO")
os.environ.setdefault("AWS_NO_SIGN_REQUEST", "YES")

HERE = Path(__file__).parent
OUT = HERE / "out" / "observations" / "madinah_wide" / "2023-01_event"
BBOX = [39.55, 24.40, 39.75, 24.56]          # several districts
EARTH = "https://earth-search.aws.element84.com/v1/search"
PC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
SIGN = "https://planetarycomputer.microsoft.com/api/sas/v1/sign?href="

OPTICAL = {"2022-12-30": "baseline, dry, 4 days before the rain",
           "2023-01-04": "EVENT - water reported standing this day",
           "2023-01-11": "recovery, 8 days after"}


def stac(url, coll, a, b, limit=20):
    body = json.dumps({"collections": [coll], "bbox": BBOX,
                       "datetime": f"{a}T00:00:00Z/{b}T23:59:59Z",
                       "limit": limit}).encode()
    r = urllib.request.Request(url, data=body, headers={
        "Content-Type": "application/json", "User-Agent": "mityaf/1.0"})
    return json.load(urllib.request.urlopen(r, timeout=150))["features"]


def sign(h):
    u = SIGN + urllib.parse.quote(h, safe="")
    return json.load(urllib.request.urlopen(
        urllib.request.Request(u, headers={"User-Agent": "mityaf/1.0"}),
        timeout=90))["href"]


def read(url, shape=None):
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.warp import transform_bounds
    from rasterio.windows import from_bounds
    with rasterio.open(url) as s:
        b = transform_bounds("EPSG:4326", s.crs, *BBOX)
        w = from_bounds(*b, transform=s.transform)
        kw = {} if shape is None else {"out_shape": shape,
                                       "resampling": Resampling.bilinear}
        return s.read(1, window=w, out_dtype="float32", boundless=True,
                      fill_value=0, **kw)


def stretch(a, lo=2, hi=98):
    v = a[np.isfinite(a) & (a != 0)]
    if v.size == 0:
        return np.zeros(a.shape, "uint8")
    p1, p2 = np.percentile(v, [lo, hi])
    return np.clip((a - p1) / max(p2 - p1, 1e-6) * 255, 0, 255).astype("uint8")


def blobstats(diff, thr=-3.0, k=5, minpx=25):
    s = uniform_filter(diff, size=k)
    hit = s < thr
    lab, _ = label(hit)
    sz = np.bincount(lab.ravel())[1:]
    return float(hit.mean()), int((sz >= minpx).sum()), int(sz.max() if sz.size else 0)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    from PIL import Image

    # ── optical ────────────────────────────────────────────────────────────
    print("\nSentinel-2 optical")
    scenes = {}
    for f in stac(EARTH, "sentinel-2-l2a", "2022-12-28", "2023-01-12"):
        d = f["properties"]["datetime"][:10]
        cc = f["properties"].get("eo:cloud_cover", 100)
        if d in OPTICAL and (d not in scenes or cc < scenes[d][1]):
            scenes[d] = (f, cc)

    mndwi, ref = {}, None
    for date, note in OPTICAL.items():
        if date not in scenes:
            print(f"  {date}  no scene"); continue
        f, cc = scenes[date]
        d = OUT / "optical" / date
        d.mkdir(parents=True, exist_ok=True)
        g = read(f["assets"]["green"]["href"], ref)
        ref = ref or g.shape
        sw = read(f["assets"]["swir16"]["href"], ref)
        rgb = np.dstack([stretch(read(f["assets"][b]["href"], ref))
                         for b in ("red", "green", "blue")])
        Image.fromarray(rgb).save(d / "rgb.png")
        m = (g - sw) / (g + sw + 1e-6)
        mndwi[date] = m
        np.save(d / "mndwi.npy", m)
        (d / "README.txt").write_text(
            f"{date} - {note}\nscene: {f['id']}\ncloud: {cc:.1f}%\n",
            encoding="utf-8")
        print(f"  {date}  {m.shape[1]}x{m.shape[0]} px  cloud {cc:4.1f}%  {note}")

    if "2022-12-30" in mndwi and "2023-01-04" in mndwi:
        base = mndwi["2022-12-30"]
        for later in ("2023-01-04", "2023-01-11"):
            if later not in mndwi:
                continue
            d = mndwi[later] - base
            frac = float((d > 0.10).mean())
            rgb = np.array(Image.open(OUT / "optical" / later / "rgb.png")).astype("float32")
            grey = rgb.mean(axis=2)
            img = np.stack([grey, grey, grey], -1)
            img[d > 0.10] = [40, 130, 255]
            Image.fromarray(img.astype("uint8")).save(
                OUT / "optical" / f"CHANGE_to_{later}.png")
            print(f"    wetter than 30 Dec on {later}: {frac:.2%} of pixels")

    # ── radar, with a dry-versus-dry control ───────────────────────────────
    print("\nSentinel-1 radar (RTC)")
    rt = {f["properties"]["datetime"][:10]: f
          for f in stac(PC, "sentinel-1-rtc", "2022-12-20", "2023-03-01")}
    print(f"  scenes available: {', '.join(sorted(rt))}")

    def db(date, shape=None):
        return 10 * np.log10(np.clip(read(sign(rt[date]["assets"]["vv"]["href"]),
                                          shape), 1e-6, None))

    if "2023-01-04" in rt:
        dates = sorted(rt)
        i = dates.index("2023-01-04")
        dry = [d for d in dates if d != "2023-01-04"]
        after = next((d for d in dates if d > "2023-01-20"), dry[-1])
        ev = db("2023-01-04")
        shape = ev.shape
        aft = db(after, shape)
        rd = OUT / "radar"
        rd.mkdir(parents=True, exist_ok=True)
        for nm, arr in (("2023-01-04_event", ev), (f"{after}_dry", aft)):
            Image.fromarray(np.clip((arr + 25) / 25 * 255, 0, 255).astype("uint8")
                            ).save(rd / f"{nm}.png")
        storm = blobstats(ev - aft)
        print(f"  STORM   04 Jan vs {after}: {storm[0]:.2%} below -3 dB, "
              f"{storm[1]} blobs>=25px, largest {storm[2]}")
        if len(dry) >= 2:
            c = blobstats(db(dry[-1], shape) - db(dry[0], shape))
            print(f"  CONTROL {dry[0]} vs {dry[-1]} (both dry): "
                  f"{c[0]:.2%} below -3 dB, {c[1]} blobs>=25px, largest {c[2]}")
            verdict = ("DETECTION: storm exceeds control"
                       if storm[1] > c[1] * 1.5 else
                       "NO DETECTION: indistinguishable from two dry days")
            print(f"\n  -> {verdict}")
            json.dump({"storm": storm, "control": c, "verdict": verdict},
                      open(OUT / "radar_verdict.json", "w"), indent=1)

    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()
