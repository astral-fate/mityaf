# -*- coding: utf-8 -*-
"""Render the six plates for the end-to-end explainer document.

Every plate is drawn from the project's own data -- the Copernicus DEM tile,
the OSM way dump, and the scored segment tables -- so what the reader inspects
is the real thing and not an illustration of it.

Plates are drawn on a fixed light ground on purpose. The explainer page shows
them as atlas plates in both themes rather than trying to make a colormapped
raster survive a dark background.

    .venv/Scripts/python.exe render_explainer_figs.py
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
from matplotlib.colors import LightSource, LinearSegmentedColormap, Normalize
from PIL import Image

HERE = Path(__file__).parent
OUT = HERE.parent / "docs" / "figs"

GROUND = "#FBFAF8"
INK = "#1A1815"
INK2 = "#5C564C"
INK3 = "#8A8378"
RULE = "#D8D2C8"
FLOW = "#1B5E8C"
DEP = "#2E7DA8"
CONV = "#C77A2B"
TUN = "#A63D3D"

BASIN = (24.5040022, 39.7000415)          # the verified King Fahd site
PINS = [(24.5040022, 39.7000415, "pin 1"),
        (24.504608,  39.700796,  "pin 2"),
        (24.503704,  39.702222,  "pin 3")]

# terrain.npy layer order is meta["keys"], alphabetical
LAYERS = ["hand", "logacc", "relelev", "sink", "slope", "twi"]

plt.rcParams.update({
    "font.family": "DejaVu Sans",
    "font.size": 9,
    "axes.edgecolor": RULE,
    "axes.labelcolor": INK2,
    "text.color": INK,
    "xtick.color": INK3,
    "ytick.color": INK3,
    "figure.facecolor": GROUND,
    "axes.facecolor": GROUND,
    "savefig.facecolor": GROUND,
})


def fig(w, h):
    f, ax = plt.subplots(figsize=(w, h))
    for s in ax.spines.values():
        s.set_linewidth(0.8)
    ax.tick_params(labelsize=7.5, width=0.7, length=3)
    return f, ax


def save(f, name):
    OUT.mkdir(parents=True, exist_ok=True)
    p = OUT / name
    f.savefig(p, dpi=125, bbox_inches="tight", pad_inches=0.12)
    plt.close(f)
    # These plates get inlined as data URIs in the explainer page, so trim the
    # palette. 224 colours is lossless to the eye on flat map fills and roughly
    # halves the bytes the reader has to download.
    raw = p.stat().st_size
    Image.open(p).convert("RGB").quantize(
        colors=224, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG
    ).save(p, optimize=True)
    print(f"  {name:26} {raw/1024:6.0f} -> {p.stat().st_size/1024:5.0f} KB")
    return p


def eyebrow(ax, label):
    ax.set_title(label, loc="left", fontsize=8.5, color=FLOW,
                 fontweight="bold", pad=8)


# ── shared inputs ────────────────────────────────────────────────────────────
meta = json.loads((HERE / "cache" / "madinah" / "meta.json").read_text())
BBOX = meta["bbox"]                                   # W S E N
tr = meta["transform"]
px, x0, y0 = tr[0], tr[2], tr[5]
H, W = meta["shape"]
EXTENT = [x0, x0 + W * px, y0 - H * px, y0]           # left right bottom top

terrain = np.load(HERE / "cache" / "madinah" / "terrain.npy")
LYR = {k: terrain[i] for i, k in enumerate(LAYERS)}

segs = pd.read_csv(HERE / "out" / "madinah_segments_features.csv")
risk = pd.read_csv(HERE / "out" / "madinah_native_risk.csv")
short = pd.read_csv(HERE / "out" / "shortlist" / "inspection_shortlist.csv")
tuns = pd.read_csv(HERE / "out" / "shortlist" / "type3_tunnels.csv")


# ── plate 1 — what a DEM is ─────────────────────────────────────────────────
def plate_dem():
    src = rasterio.open(HERE / "cache" / "madinah"
                        / "Copernicus_DSM_COG_10_N24_00_E039_00_DEM.tif")
    win = rasterio.windows.from_bounds(BBOX[0], BBOX[1], BBOX[2], BBOX[3],
                                       src.transform)
    z = src.read(1, window=win).astype("float32")
    z[z < -1000] = np.nan
    ext = list(rasterio.windows.bounds(win, src.transform))
    ext = [ext[0], ext[2], ext[1], ext[3]]

    f, ax = fig(7.4, 6.6)
    # A desert city has no ocean, so matplotlib's default "terrain" ramp -- which
    # paints everything near its low end blue -- reads as a flooded valley. Use a
    # warm ground ramp lit from the north-west so the harrat and the wadis read
    # as landforms.
    ramp = LinearSegmentedColormap.from_list(
        "harrat", ["#4A6B5C", "#7E9463", "#BCAF77", "#D9C193",
                   "#C89A73", "#9C6B52", "#7A5344", "#F2EAE0"])
    lo, hi = np.nanpercentile(z, [1, 99.5])
    ls = LightSource(azdeg=315, altdeg=42)
    rgb = ls.shade(np.nan_to_num(z, nan=float(lo)), cmap=ramp,
                   blend_mode="soft", vert_exag=8, vmin=lo, vmax=hi)
    ax.imshow(rgb, extent=ext, origin="upper", interpolation="bilinear")
    # The shaded RGB carries no scalar mapping, so the colourbar needs its own.
    im = plt.cm.ScalarMappable(cmap=ramp, norm=Normalize(vmin=lo, vmax=hi))
    ax.plot(BASIN[1], BASIN[0], "o", ms=10, mfc="none", mec=TUN, mew=2.2)
    ax.annotate("King Fahd district" + chr(10) + "the verified basin",
                (BASIN[1], BASIN[0]),
                xytext=(-108, 34), textcoords="offset points",
                fontsize=8.5, color=TUN, fontweight="bold",
                bbox=dict(boxstyle="round,pad=0.3", fc="#FFFFFFE0",
                          ec=TUN, lw=0.8),
                arrowprops=dict(arrowstyle="-", color=TUN, lw=1.0))
    cb = f.colorbar(im, ax=ax, fraction=0.042, pad=0.02)
    cb.set_label("ground height above sea level (metres)", fontsize=8.5)
    cb.outline.set_edgecolor(RULE)
    cb.ax.tick_params(labelsize=7.5, color=RULE)
    ax.set_xlabel("longitude °E"); ax.set_ylabel("latitude °N")
    eyebrow(ax, f"PLATE 1 · the DEM — {z.shape[1]}×{z.shape[0]} cells, "
                f"30 m each, covering all of Al Madinah")
    save(f, "01-dem.png")
    src.close()


# ── plate 2 — a DEM is literally a grid of numbers ──────────────────────────
def plate_dem_grid():
    src = rasterio.open(HERE / "cache" / "madinah"
                        / "Copernicus_DSM_COG_10_N24_00_E039_00_DEM.tif")
    r, c = src.index(BASIN[1], BASIN[0])
    k = 7                                             # 15x15 cells ~ 450 m
    win = rasterio.windows.Window(c - k, r - k, 2 * k + 1, 2 * k + 1)
    z = src.read(1, window=win).astype("float32")
    b = rasterio.windows.bounds(win, src.transform)
    ext = [b[0], b[2], b[1], b[3]]

    f, ax = fig(7.4, 6.9)
    ax.imshow(z, extent=ext, cmap="Blues_r", origin="upper",
              interpolation="nearest")
    dx = (ext[1] - ext[0]) / z.shape[1]
    dy = (ext[3] - ext[2]) / z.shape[0]
    lo, hi = np.nanmin(z), np.nanmax(z)
    for i in range(z.shape[0]):
        for j in range(z.shape[1]):
            v = z[i, j]
            ax.text(ext[0] + (j + .5) * dx, ext[3] - (i + .5) * dy,
                    f"{v:.0f}", ha="center", va="center", fontsize=6.4,
                    color="#111" if (v - lo) / (hi - lo + 1e-9) > .40 else "#fff",
                    fontweight="bold")
    for j in range(z.shape[1] + 1):
        ax.axvline(ext[0] + j * dx, color="#00000030", lw=.5)
    for i in range(z.shape[0] + 1):
        ax.axhline(ext[2] + i * dy, color="#00000030", lw=.5)
    ax.plot(BASIN[1], BASIN[0], "o", ms=11, mfc="none", mec=TUN, mew=2.4)
    ax.set_xlabel("longitude °E"); ax.set_ylabel("latitude °N")
    ax.ticklabel_format(useOffset=False, style="plain")
    eyebrow(ax, "PLATE 2 · the same DEM zoomed to 450 m — every cell is one "
                "number: metres above sea level")
    f.text(0.5, -0.015,
           f"Darker = lower. Across this whole 450 m window the ground falls "
           f"just {hi-lo:.0f} m, from {hi:.0f} to {lo:.0f}. That is the entire "
           f"signal —" + chr(10) + "which is why a hollow this shallow is invisible on foot "
           f"and has to be found by arithmetic. The red ring is the resident's pin.",
           ha="center", fontsize=8.4, color=INK2, linespacing=1.6)
    save(f, "02-dem-grid.png")
    src.close()


# ── plate 3 — what OSM gives us ─────────────────────────────────────────────
def plate_osm():
    ways = json.loads((HERE / "cache" / "madinah" / "roads.json")
                      .read_text(encoding="utf-8"))["elements"]
    BIG = {"motorway", "trunk", "primary", "motorway_link", "trunk_link",
           "primary_link"}
    MID = {"secondary", "tertiary", "secondary_link", "tertiary_link"}
    buckets = {"big": [], "mid": [], "small": []}
    tunnel_pts = []
    for w in ways:
        g = w.get("geometry")
        if not g:
            continue
        t = w.get("tags", {})
        hw = t.get("highway", "")
        line = [(p["lon"], p["lat"]) for p in g]
        buckets["big" if hw in BIG else "mid" if hw in MID else "small"].append(line)
        if t.get("tunnel") == "yes" or str(t.get("layer", "0")).lstrip("-").isdigit() \
                and int(t.get("layer", 0) or 0) < 0:
            m = line[len(line) // 2]
            tunnel_pts.append(m)

    f, ax = fig(7.4, 6.6)
    for key, col, lw, a in (("small", "#B9B2A6", .35, .85),
                            ("mid", INK2, .70, .95),
                            ("big", FLOW, 1.35, 1.0)):
        ax.add_collection(LineCollection(buckets[key], colors=col,
                                         linewidths=lw, alpha=a))
    if tunnel_pts:
        tp = np.array(tunnel_pts)
        ax.plot(tp[:, 0], tp[:, 1], "o", ms=5.5, mfc="none", mec=TUN, mew=1.4,
                label=f"tunnel tag ({len(tunnel_pts)} ways)")
    ax.set_xlim(BBOX[0], BBOX[2]); ax.set_ylim(BBOX[1], BBOX[3])
    ax.set_xlabel("longitude °E"); ax.set_ylabel("latitude °N")
    ax.plot([], [], color=FLOW, lw=1.5,
            label=f"motorway / trunk / primary ({len(buckets['big']):,})")
    ax.plot([], [], color=INK2, lw=.9,
            label=f"secondary / tertiary ({len(buckets['mid']):,})")
    ax.plot([], [], color="#B9B2A6", lw=.7,
            label=f"residential and smaller ({len(buckets['small']):,})")
    lg = ax.legend(loc="lower left", fontsize=7.6, frameon=True,
                   facecolor="#FFFFFFDD", edgecolor=RULE)
    lg.get_frame().set_linewidth(0.8)
    eyebrow(ax, f"PLATE 3 · OpenStreetMap — {len(ways):,} road ways, drawn by "
                "volunteers. No flood information anywhere in it.")
    save(f, "03-osm.png")


# ── plate 4 — the 30,337 segments, ranked ───────────────────────────────────
def plate_segments():
    d = risk.sort_values("rank_hydrology")
    cmap = LinearSegmentedColormap.from_list(
        "rk", ["#DCD6CB", "#B9CBD8", "#6E9EBF", "#2E7DA8", "#A63D3D"])
    f, ax = fig(7.4, 6.6)
    sc = ax.scatter(d.lon, d.lat, c=d.rank_hydrology, cmap=cmap, s=1.6,
                    linewidths=0, vmin=0, vmax=1)
    top = d[d.rank_hydrology >= .99]
    ax.scatter(top.lon, top.lat, s=9, facecolors="none", edgecolors=TUN,
               linewidths=.45, alpha=.85)
    cb = f.colorbar(sc, ax=ax, fraction=0.042, pad=0.02)
    cb.set_label("hydrology rank  (1.00 = worse than every other street)",
                 fontsize=8.5)
    cb.outline.set_edgecolor(RULE); cb.ax.tick_params(labelsize=7.5)
    ax.set_xlim(BBOX[0], BBOX[2]); ax.set_ylim(BBOX[1], BBOX[3])
    ax.set_xlabel("longitude °E"); ax.set_ylabel("latitude °N")
    eyebrow(ax, f"PLATE 4 · the output — all {len(d):,} segments scored, "
                f"none skipped. Ringed: the top 1% ({len(top):,}).")
    save(f, "04-segments-ranked.png")


# ── plate 5 — the three mechanisms on the map ───────────────────────────────
def plate_mechanisms():
    f, ax = fig(7.4, 6.6)
    ax.scatter(risk.lon, risk.lat, s=1.9, c="#C6BFB1", linewidths=0)
    for mech, col, lab in (("convergence", CONV, "convergence"),
                           ("depression", DEP, "depression")):
        m = short[short.mechanism == mech]
        ax.scatter(m.lon, m.lat, s=7, c=col, linewidths=0, alpha=.85,
                   label=f"{lab} — {len(m):,} segments")
    ax.scatter(tuns.lon, tuns.lat, s=52, facecolors="none", edgecolors=TUN,
               linewidths=1.5, label=f"tunnel — {len(tuns)} OSM ways")
    ax.plot([], [], "o", ms=3.4, color="#C6BFB1",
            label=f"no mechanism — {len(risk)-len(short):,} segments")
    ax.set_xlim(BBOX[0], BBOX[2]); ax.set_ylim(BBOX[1], BBOX[3])
    ax.set_xlabel("longitude °E"); ax.set_ylabel("latitude °N")
    lg = ax.legend(loc="lower left", fontsize=7.6, frameon=True,
                   facecolor="#FFFFFFDD", edgecolor=RULE, markerscale=1.3)
    lg.get_frame().set_linewidth(0.8)
    eyebrow(ax, f"PLATE 5 · classification — only {len(short):,} of "
                f"{len(risk):,} segments match a rule. The rest stay unlabelled.")
    save(f, "05-mechanisms.png")


# ── plate 6 — the basin, and why the pins landed in it ──────────────────────
def plate_basin():
    lat, lon = BASIN
    pad = 0.0075                                       # ~800 m
    sink = LYR["sink"].copy()
    sink[sink <= 0.001] = np.nan
    f, ax = fig(7.4, 6.4)
    im = ax.imshow(sink, extent=EXTENT, origin="upper", cmap="Blues",
                   interpolation="nearest", vmin=0, vmax=0.9)
    ways = json.loads((HERE / "cache" / "madinah" / "roads.json")
                      .read_text(encoding="utf-8"))["elements"]
    lines = [[(p["lon"], p["lat"]) for p in w["geometry"]]
             for w in ways if w.get("geometry")]
    ax.add_collection(LineCollection(lines, colors="#5C564C", linewidths=.75,
                                     alpha=.55))
    d = short[(short.mechanism == "depression")
              & short.lat.between(lat - pad, lat + pad)
              & short.lon.between(lon - pad, lon + pad)]
    ax.scatter(d.lon, d.lat, s=42, c=DEP, linewidths=.6, edgecolors="#fff",
               zorder=4, label=f"depression segments here ({len(d)})")
    for i, (py, pxx, lab) in enumerate(PINS):
        ax.plot(pxx, py, "*", ms=17, color=TUN, mec="#fff", mew=.8, zorder=6,
                label="resident's pins (3)" if i == 0 else None)
    cb = f.colorbar(im, ax=ax, fraction=0.042, pad=0.02)
    cb.set_label("sink depth — how deep the hollow is (metres)", fontsize=8.5)
    cb.outline.set_edgecolor(RULE); cb.ax.tick_params(labelsize=7.5)
    ax.set_xlim(lon - pad, lon + pad); ax.set_ylim(lat - pad, lat + pad)
    ax.set_xlabel("longitude °E"); ax.set_ylabel("latitude °N")
    ax.ticklabel_format(useOffset=False, style="plain")
    lg = ax.legend(loc="upper left", fontsize=7.8, frameon=True,
                   facecolor="#FFFFFFDD", edgecolor=RULE)
    lg.get_frame().set_linewidth(0.8)
    eyebrow(ax, "PLATE 6 · King Fahd district — the DEM found this hollow "
                "before the resident's pins existed")
    save(f, "06-basin.png")


if __name__ == "__main__":
    print("rendering plates ->", OUT)
    plate_dem()
    plate_dem_grid()
    plate_osm()
    plate_segments()
    plate_mechanisms()
    plate_basin()
    print("done")
