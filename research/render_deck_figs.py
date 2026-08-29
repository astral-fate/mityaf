# -*- coding: utf-8 -*-
"""Dark-ground thumbnails of the raw inputs, sized for the deck's cards.

The explainer plates are drawn on paper because a printed atlas wants paper.
The deck is near-black, so a light plate dropped into it reads as a hole. These
are the same data re-rendered for a dark ground, small, with no axes or labels
-- at 3.4 inches wide on a slide, a legend is unreadable and only the shape
carries.

Four thumbnails:
  dem-relief    the elevation model as shaded relief -- "this is terrain"
  dem-cells     the same model zoomed until the per-cell numbers show
  osm-network   the road network -- "this is what we cut into segments"
  ranked        the 30,337 segments coloured by rank -- the output

    .venv/Scripts/python.exe render_deck_figs.py
"""
from __future__ import annotations

import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import rasterio
from matplotlib.collections import LineCollection
from matplotlib.colors import LightSource, LinearSegmentedColormap
from PIL import Image

HERE = Path(__file__).parent
OUT = Path(r"D:\barmajan\deck\assets\figures")
BG = "#0C1850"           # CARD in the deck palette
GREEN, CYAN, GOLD = "#4BE486", "#3DD9D6", "#C9AC6D"
DPI = 150

meta = json.loads((HERE / "cache" / "madinah" / "meta.json").read_text())
BBOX = meta["bbox"]


def fig(w=4.0, h=2.7):
    f, ax = plt.subplots(figsize=(w, h))
    f.patch.set_facecolor(BG)
    ax.set_facecolor(BG)
    ax.set_xticks([]); ax.set_yticks([])
    for s in ax.spines.values():
        s.set_visible(False)
    f.subplots_adjust(0, 0, 1, 1)
    return f, ax


def save(f, name):
    OUT.mkdir(parents=True, exist_ok=True)
    p = OUT / name
    f.savefig(p, dpi=DPI, facecolor=BG, bbox_inches="tight", pad_inches=0.02)
    plt.close(f)
    Image.open(p).convert("RGB").quantize(colors=200).save(p, optimize=True)
    print(f"  {name:22} {p.stat().st_size/1024:6.0f} KB")


def dem_relief():
    src = rasterio.open(HERE / "cache" / "madinah"
                        / "Copernicus_DSM_COG_10_N24_00_E039_00_DEM.tif")
    w = rasterio.windows.from_bounds(*BBOX, src.transform)
    z = src.read(1, window=w).astype("float32")
    z[z < -1000] = np.nan
    ramp = LinearSegmentedColormap.from_list(
        "h", ["#16305E", "#1E4E6B", "#3C7A6A", "#8FA36B", "#C9AC6D", "#E8DCC0"])
    lo, hi = np.nanpercentile(z, [2, 99])
    rgb = LightSource(315, 42).shade(np.nan_to_num(z, nan=float(lo)), cmap=ramp,
                                     blend_mode="soft", vert_exag=8,
                                     vmin=lo, vmax=hi)
    f, ax = fig()
    ax.imshow(rgb, interpolation="bilinear")
    save(f, "arch-dem-relief.png")
    src.close()


def dem_cells():
    src = rasterio.open(HERE / "cache" / "madinah"
                        / "Copernicus_DSM_COG_10_N24_00_E039_00_DEM.tif")
    r, c = src.index(39.7000415, 24.5040022)
    k = 5
    z = src.read(1, window=rasterio.windows.Window(c - k, r - k, 2*k+1, 2*k+1))
    f, ax = fig(3.4, 2.7)
    ax.imshow(z, cmap="Blues_r", interpolation="nearest")
    lo, hi = z.min(), z.max()
    for i in range(z.shape[0]):
        for j in range(z.shape[1]):
            v = z[i, j]
            ax.text(j, i, f"{v:.0f}", ha="center", va="center", fontsize=7.5,
                    fontweight="bold",
                    color="#0B1020" if (v-lo)/(hi-lo+1e-9) > .45 else "#EAF0FF")
    for j in range(z.shape[1] + 1):
        ax.axvline(j - .5, color="#00000055", lw=.6)
    for i in range(z.shape[0] + 1):
        ax.axhline(i - .5, color="#00000055", lw=.6)
    save(f, "arch-dem-cells.png")
    src.close()


def osm_network():
    ways = json.loads((HERE / "cache" / "madinah" / "roads.json")
                      .read_text(encoding="utf-8"))["elements"]
    BIG = {"motorway", "trunk", "primary", "motorway_link", "trunk_link"}
    big, small = [], []
    for w in ways:
        g = w.get("geometry")
        if not g:
            continue
        line = [(p["lon"], p["lat"]) for p in g]
        (big if w.get("tags", {}).get("highway") in BIG else small).append(line)
    f, ax = fig()
    ax.add_collection(LineCollection(small, colors="#3A4A80", linewidths=.28))
    ax.add_collection(LineCollection(big, colors=CYAN, linewidths=.95))
    ax.set_xlim(BBOX[0], BBOX[2]); ax.set_ylim(BBOX[1], BBOX[3])
    save(f, "arch-osm.png")


def ranked():
    d = pd.read_csv(HERE / "out" / "madinah_native_risk.csv")
    cmap = LinearSegmentedColormap.from_list(
        "r", ["#22305F", "#2E5E8C", "#3DD9D6", "#C9AC6D", "#FF7766"])
    f, ax = fig()
    ax.scatter(d.lon, d.lat, c=d.rank_hydrology, cmap=cmap, s=.7, linewidths=0)
    ax.set_xlim(BBOX[0], BBOX[2]); ax.set_ylim(BBOX[1], BBOX[3])
    save(f, "arch-ranked.png")


if __name__ == "__main__":
    print(f"rendering deck thumbnails -> {OUT}")
    dem_relief(); dem_cells(); osm_network(); ranked()
    print("done")
