"""Read GPS coordinates and timestamps out of photos and videos, locally.

Every flooding photo taken on a phone with location services on carries the
coordinates and the exact time inside the file. That is the ground truth this
whole project has been short of, and it does not require uploading anything to
a third-party site -- which matters, because those coordinates are somebody's
home address.

Point this at a folder. It reads the location and time, matches each file
against the rainfall archive for that date, finds the nearest scored street
segment, and writes a register row ready to append to the incident file.

    .venv/Scripts/python.exe photo_locations.py "C:/path/to/photos"

A caveat worth knowing before you go hunting: WhatsApp, Telegram and most
social apps STRIP location metadata when an image is sent. A photo forwarded
to you will almost certainly have nothing. The original on the camera roll of
the phone that took it will.
"""
from __future__ import annotations

import json
import struct
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).parent
IMG_EXT = {".jpg", ".jpeg", ".heic", ".heif", ".png", ".tif", ".tiff"}
VID_EXT = {".mp4", ".mov", ".m4v", ".3gp"}


def dms(v, ref):
    """EXIF stores degrees/minutes/seconds as three rationals."""
    d = float(v[0]) + float(v[1]) / 60 + float(v[2]) / 3600
    return -d if str(ref).upper() in ("S", "W") else d


def from_image(p: Path):
    try:
        from PIL import Image, ExifTags
        img = Image.open(p)
        ex = img.getexif()
        if not ex:
            return None
        gps = ex.get_ifd(0x8825)
        when = ex.get(306) or ex.get(36867)
        if not gps or 2 not in gps or 4 not in gps:
            return (None, None, when)
        return (dms(gps[2], gps.get(1, "N")), dms(gps[4], gps.get(3, "E")), when)
    except Exception:                                          # noqa: BLE001
        return None


def from_video(p: Path):
    """Apple and Android write an ISO-6709 string into the moov/udta atom."""
    try:
        raw = p.read_bytes()[:6_000_000]
        for key in (b"\xa9xyz", b"loci"):
            i = raw.find(key)
            if i < 0:
                continue
            chunk = raw[i:i + 80]
            import re
            m = re.search(rb"([+-]\d+\.\d+)([+-]\d+\.\d+)", chunk)
            if m:
                return (float(m.group(1)), float(m.group(2)), None)
        return None
    except Exception:                                          # noqa: BLE001
        return None


def rain_on(date: str, lat: float, lon: float):
    try:
        q = ("https://archive-api.open-meteo.com/v1/archive?" + urllib.parse.urlencode({
            "latitude": lat, "longitude": lon, "start_date": date, "end_date": date,
            "daily": "precipitation_sum", "timezone": "auto"}))
        d = json.load(urllib.request.urlopen(q, timeout=60))["daily"]
        return float(d["precipitation_sum"][0] or 0.0)
    except Exception:                                          # noqa: BLE001
        return float("nan")


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        return
    folder = Path(sys.argv[1])
    files = [p for p in folder.rglob("*")
             if p.suffix.lower() in IMG_EXT | VID_EXT]
    print(f"scanning {len(files)} files under {folder}\n")

    seg = None
    csv = HERE / "out" / "madinah_native_risk.csv"
    if csv.exists():
        seg = pd.read_csv(csv)

    rows = []
    for p in sorted(files):
        got = (from_video(p) if p.suffix.lower() in VID_EXT else from_image(p))
        if not got:
            print(f"  {p.name[:42]:44} no metadata")
            continue
        lat, lon, when = got
        if lat is None:
            print(f"  {p.name[:42]:44} time {when}, but NO GPS "
                  f"(stripped, or location was off)")
            continue
        date = str(when)[:10].replace(":", "-") if when else ""
        row = {"file": p.name, "lat": lat, "lon": lon, "taken": when}
        line = f"  {p.name[:42]:44} {lat:.6f}, {lon:.6f}"
        if date:
            mm = rain_on(date, lat, lon)
            row["date"] = date
            row["mm"] = mm
            line += f"   {date}  rain {mm:.1f} mm"
        if seg is not None:
            dy = (seg.lat - lat) * 111320
            dx = (seg.lon - lon) * 111320 * np.cos(np.radians(lat))
            s = seg.assign(d=np.hypot(dx, dy)).nsmallest(1, "d").iloc[0]
            row.update({"segment": s.unit_id, "district": s.district_ar,
                        "dist_m": round(float(s.d), 1),
                        "rank_hydrology": float(s.rank_hydrology),
                        "rank_model": float(s.rank_model)})
            line += f"\n{'':46}-> {s.district_ar}, hydrology rank {s.rank_hydrology:.3f}"
        print(line)
        rows.append(row)

    if rows:
        out = HERE / "out" / "incidents" / "photo_register.csv"
        out.parent.mkdir(parents=True, exist_ok=True)
        pd.DataFrame(rows).to_csv(out, index=False, encoding="utf-8")
        print(f"\n{len(rows)} located -> {out}")
    else:
        print("\nnothing carried GPS. If these came through WhatsApp, the "
              "coordinates were stripped in transit -- ask for the originals.")


if __name__ == "__main__":
    main()
