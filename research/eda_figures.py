"""EDA figures — what the flood model is actually trained on.

Written to answer a fair question: "are they images? what exactly is the data?"

They are not images. The flood susceptibility model never sees a photograph or
a satellite scene. It sees a TABLE: one row per 200 m cell, nine numeric
columns describing the shape of the ground and the shape of the street
network, and one 0/1 label saying whether a resident ever reported standing
water there.

These figures show each of those pieces as it really is.

    python research/eda_figures.py
"""
from __future__ import annotations

import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

HERE = Path(__file__).parent
CACHE = HERE / "cache"
OUT = HERE / "figures"
OUT.mkdir(exist_ok=True)

INK = "#04081a"
FG = "#eef2ff"
DIM = "#a3b0d2"
WATER = "#2fd8ef"
CORAL = "#f08a5a"
RED = "#e8596b"

plt.rcParams.update({
    "figure.facecolor": INK, "axes.facecolor": INK,
    "text.color": FG, "axes.labelcolor": DIM, "axes.edgecolor": "#2a3454",
    "xtick.color": DIM, "ytick.color": DIM, "font.size": 9,
    "axes.titlecolor": FG, "figure.dpi": 130,
})

CELL_DEG = 200.0 / 111_320.0

LABELS = {
    "slope": "الانحدار (درجة)\nslope",
    "twi": "مؤشر الرطوبة الطبوغرافي\nTWI",
    "sink": "عمق المنخفض المغلق (م)\nsink depth",
    "hand": "الارتفاع فوق المصرف (م)\nHAND",
    "logacc": "تراكم الجريان (لوغاريتمي)\nlog flow accumulation",
    "relelev": "الارتفاع النسبي (م)\nrelative elevation",
}


def load():
    meta = json.loads((CACHE / "meta.json").read_text())
    return meta, np.load(CACHE / "terrain.npy"), np.load(CACHE / "points.npy")


def fig_labels(meta, pts):
    """The ground truth, exactly as it arrives: 21,287 dots on a map."""
    bbox = meta["bbox"]
    fig, ax = plt.subplots(figsize=(7.2, 7.4))
    ax.scatter(pts[:, 0], pts[:, 1], s=1.1, c=WATER, alpha=0.32, linewidths=0)
    ax.set_xlim(bbox[0], bbox[2]); ax.set_ylim(bbox[1], bbox[3])
    ax.set_aspect(1 / np.cos(np.radians((bbox[1] + bbox[3]) / 2)))
    ax.set_title(f"الحقيقة الأرضية — {len(pts):,} بلاغ «تجمّع مياه في شارع»\n"
                 "NYC 311 ground truth: one dot per citizen report, 2020-2026",
                 pad=12, fontsize=10)
    ax.set_xlabel("longitude"); ax.set_ylabel("latitude")
    fig.tight_layout(); fig.savefig(OUT / "01_labels.png"); plt.close(fig)
    print("  01_labels.png")


def fig_grid(meta, pts):
    """What one ROW of the training table is: a 200 m cell, positive or not."""
    bbox = meta["bbox"]
    nxg = int((bbox[2] - bbox[0]) / CELL_DEG) + 1
    nyg = int((bbox[3] - bbox[1]) / CELL_DEG) + 1
    counts = np.zeros((nyg, nxg), dtype=int)
    gx = ((pts[:, 0] - bbox[0]) / CELL_DEG).astype(int)
    gy = ((pts[:, 1] - bbox[1]) / CELL_DEG).astype(int)
    ok = (gx >= 0) & (gx < nxg) & (gy >= 0) & (gy < nyg)
    np.add.at(counts, (gy[ok], gx[ok]), 1)

    fig, ax = plt.subplots(figsize=(7.2, 7.4))
    im = ax.imshow(np.where(counts > 0, counts, np.nan), origin="lower",
                   extent=[bbox[0], bbox[2], bbox[1], bbox[3]],
                   cmap="magma", vmax=np.percentile(counts[counts > 0], 97))
    ax.set_aspect(1 / np.cos(np.radians((bbox[1] + bbox[3]) / 2)))
    ax.set_title(f"التسمية على شبكة ٢٠٠ م — {int((counts > 0).sum()):,} خلية موجبة\n"
                 "the label, gridded: each square is one row of the training table",
                 pad=12, fontsize=10)
    cb = fig.colorbar(im, ax=ax, fraction=0.036, pad=0.02)
    cb.set_label("reports per cell", color=DIM)
    fig.tight_layout(); fig.savefig(OUT / "02_grid_labels.png"); plt.close(fig)
    print("  02_grid_labels.png")


def fig_feature_rasters(meta, terrain):
    keys = meta["keys"]
    fig, axes = plt.subplots(2, 3, figsize=(11.5, 7.8))
    for ax, k, band in zip(axes.ravel(), keys, terrain):
        finite = band[np.isfinite(band)]
        lo, hi = np.percentile(finite, [2, 98])
        ax.imshow(band, cmap="viridis", vmin=lo, vmax=hi)
        ax.set_title(LABELS.get(k, k), fontsize=8.5, pad=6)
        ax.set_xticks([]); ax.set_yticks([])
    fig.suptitle("الخصائص الست المشتقّة من نموذج الارتفاع — هذه هي «الصور» الوحيدة في النموذج\n"
                 "the six DEM-derived features: rasters, sampled to one number per cell",
                 fontsize=10.5, y=0.985)
    fig.tight_layout(rect=[0, 0, 1, 0.94])
    fig.savefig(OUT / "03_feature_rasters.png"); plt.close(fig)
    print("  03_feature_rasters.png")


def road_length_grid(meta):
    """Metres of road per 200 m cell — the mask that defines a valid negative."""
    import json as _json
    bbox = meta["bbox"]
    roads = _json.loads((CACHE / "nyc_roads.json").read_text(encoding="utf-8"))
    nxg = int((bbox[2] - bbox[0]) / CELL_DEG) + 1
    nyg = int((bbox[3] - bbox[1]) / CELL_DEG) + 1
    road_len = np.zeros((nyg, nxg), dtype="float32")
    step = CELL_DEG / 3
    for el in roads.get("elements", []):
        if el.get("type") != "way" or not el.get("geometry"):
            continue
        cs = [(g["lon"], g["lat"]) for g in el["geometry"]]
        for (x0, y0), (x1, y1) in zip(cs[:-1], cs[1:]):
            d = np.hypot(x1 - x0, y1 - y0)
            n = max(1, int(d / step))
            for i in range(n):
                tt = i / n
                lon = x0 + (x1 - x0) * tt
                lat = y0 + (y1 - y0) * tt
                gx = int((lon - bbox[0]) / CELL_DEG)
                gy = int((lat - bbox[1]) / CELL_DEG)
                if 0 <= gx < nxg and 0 <= gy < nyg:
                    road_len[gy, gx] += (d / n) * 111_320 * np.cos(np.radians(lat))
    return road_len


def _sampled(meta, terrain, pts):
    """Grid the labels and sample every terrain band onto the analysis grid."""
    bbox = meta["bbox"]
    a, b, c, d, e, f = meta["transform"]
    ny, nx = meta["shape"]
    nxg = int((bbox[2] - bbox[0]) / CELL_DEG) + 1
    nyg = int((bbox[3] - bbox[1]) / CELL_DEG) + 1

    counts = np.zeros((nyg, nxg), dtype=int)
    gx = ((pts[:, 0] - bbox[0]) / CELL_DEG).astype(int)
    gy = ((pts[:, 1] - bbox[1]) / CELL_DEG).astype(int)
    ok = (gx >= 0) & (gx < nxg) & (gy >= 0) & (gy < nyg)
    np.add.at(counts, (gy[ok], gx[ok]), 1)

    cell_lon = bbox[0] + (np.arange(nxg) + 0.5) * CELL_DEG
    cell_lat = bbox[1] + (np.arange(nyg) + 0.5) * CELL_DEG
    LON, LAT = np.meshgrid(cell_lon, cell_lat)
    col = np.clip(((LON - c) / a).astype(int), 0, nx - 1)
    row = np.clip(((LAT - f) / e).astype(int), 0, ny - 1)
    return counts, row, col


def fig_separation(meta, terrain, pts):
    """
    The negative-sampling decision, drawn.

    Left of each pair: negatives drawn from ANY cell. The grey spike is water,
    parks and empty land, where the terrain rasters return a constant — the
    model would separate those from streets trivially and score beautifully
    while having learned only "is there a road here".

    Right: negatives restricted to cells carrying >50 m of road, which is what
    the model actually trains on. The spike is gone, the overlap is heavy, and
    that overlap is the honest reason PR-AUC is 0.39 rather than 0.9.
    """
    keys = meta["keys"]
    counts, row, col = _sampled(meta, terrain, pts)
    road_len = road_length_grid(meta)
    has_road = road_len > 50.0
    pos = counts > 0

    fig, axes = plt.subplots(2, 6, figsize=(16.5, 6.4))
    for j, (k, band) in enumerate(zip(keys, terrain)):
        vals = band[row, col]
        for i, (mask, tag) in enumerate([
            (np.ones_like(pos, dtype=bool), "كل الخلايا  ·  any cell"),
            (has_road, "خلايا تحمل طريقاً  ·  road-bearing only"),
        ]):
            ax = axes[i][j]
            p = vals[pos & mask]
            n = vals[(~pos) & mask]
            if not len(p) or not len(n):
                ax.axis("off")
                continue
            lo, hi = np.percentile(np.concatenate([p, n]), [1, 99])
            bins = np.linspace(lo, hi, 40)
            ax.hist(n, bins=bins, density=True, color=DIM, alpha=0.55, label="dry")
            ax.hist(p, bins=bins, density=True, color=CORAL, alpha=0.7, label="flooded")
            ax.set_yticks([])
            ax.tick_params(labelsize=6.5)
            if i == 0:
                ax.set_title(LABELS.get(k, k), fontsize=7.5, pad=5)
            if j == 0:
                ax.set_ylabel(tag, fontsize=7.5, color=FG)
    axes[0][0].legend(fontsize=6.5, framealpha=0.15, labelcolor=FG)
    fig.suptitle(
        "قرار اختيار العيّنات السالبة، مرسوماً — الصف العلوي يفصل بسهولة لأنه يفصل «هل هنا طريق؟»\n"
        "why negatives must carry road: the top row separates trivially, on the wrong question",
        fontsize=10.5, y=0.985)
    fig.tight_layout(rect=[0, 0, 1, 0.9])
    fig.savefig(OUT / "04_negative_sampling.png")
    plt.close(fig)
    print("  04_negative_sampling.png")

    n_any = int((~pos).sum())
    n_road = int(((~pos) & has_road).sum())
    print(f"      negatives available: {n_any:,} any cell  ->  {n_road:,} road-bearing "
          f"({100 * n_road / n_any:.0f}% kept)")


def main() -> None:
    meta, terrain, pts = load()
    print(f"loaded {len(pts):,} labels, terrain {terrain.shape}")
    fig_labels(meta, pts)
    fig_grid(meta, pts)
    fig_feature_rasters(meta, terrain)
    fig_separation(meta, terrain, pts)
    print(f"\nfigures -> {OUT}")


if __name__ == "__main__":
    main()
