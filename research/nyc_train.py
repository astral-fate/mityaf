"""
Train and honestly validate the Mityaf feature set on NYC street-flooding labels.

Run research/nyc_model.py first to build the cache.

The two things that make or break this are not the model:

  NEGATIVES must come from cells that carry road. Complaints are presence-only;
  if negatives are drawn from anywhere, the classifier learns "a road exists
  here" — parks, water and rail yards have neither roads nor complaints and
  separate trivially, producing a flattering and useless score.

  FOLDS must be whole spatial blocks. Terrain predictors are strongly spatially
  autocorrelated, so ordinary k-fold puts neighbouring cells in train and test
  at once. That is the single most common fatal error in published flood-
  susceptibility work, and it is why we also report the random-CV number: the
  gap between the two IS the finding.

    docker run --rm -v "D:\\barmajan\\masareb:/app" -w /app python:3.11 \
      sh -c "pip install -q numpy scipy scikit-learn xgboost && \
             python research/nyc_train.py"
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
CACHE = HERE / "cache"
OUT = HERE / "results.json"

CELL_DEG = 200.0 / 111_320.0     # ~200 m analysis grid
BLOCK_DEG = 0.05                 # ~5.5 km spatial CV blocks
RNG = np.random.default_rng(42)


def load():
    meta = json.loads((CACHE / "meta.json").read_text())
    terrain = np.load(CACHE / "terrain.npy")
    points = np.load(CACHE / "points.npy")
    roads = json.loads((CACHE / "nyc_roads.json").read_text(encoding="utf-8"))
    return meta, terrain, points, roads


def grid_index(lon, lat, bbox):
    gx = ((lon - bbox[0]) / CELL_DEG).astype(int)
    gy = ((lat - bbox[1]) / CELL_DEG).astype(int)
    return gx, gy


def densify(coords, step_deg=CELL_DEG / 3):
    """Walk a polyline so road length lands in every cell it crosses."""
    out = []
    for (x0, y0), (x1, y1) in zip(coords[:-1], coords[1:]):
        d = math.hypot(x1 - x0, y1 - y0)
        n = max(1, int(d / step_deg))
        for i in range(n):
            t = i / n
            out.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, d / n))
    return out


def main() -> None:
    from sklearn.metrics import average_precision_score, roc_auc_score
    from sklearn.model_selection import GroupKFold, KFold
    import xgboost as xgb

    meta, terrain, points, roads = load()
    bbox = meta["bbox"]
    keys = meta["keys"]
    a, b, c, d, e, f = meta["transform"]
    ny, nx = meta["shape"]

    nxg = int((bbox[2] - bbox[0]) / CELL_DEG) + 1
    nyg = int((bbox[3] - bbox[1]) / CELL_DEG) + 1
    print(f"grid: {nxg} x {nyg} cells @ ~200 m")

    # ── road density per cell ──
    road_len = np.zeros((nyg, nxg), dtype="float32")
    major_len = np.zeros((nyg, nxg), dtype="float32")
    MAJOR = {"motorway", "trunk", "primary", "secondary"}
    for el in roads.get("elements", []):
        if el.get("type") != "way" or not el.get("geometry"):
            continue
        coords = [(g["lon"], g["lat"]) for g in el["geometry"]]
        if len(coords) < 2:
            continue
        is_major = el.get("tags", {}).get("highway") in MAJOR
        for lon, lat, seg_deg in densify(coords):
            gx = int((lon - bbox[0]) / CELL_DEG)
            gy = int((lat - bbox[1]) / CELL_DEG)
            if 0 <= gx < nxg and 0 <= gy < nyg:
                m = seg_deg * 111_320 * math.cos(math.radians(lat))
                road_len[gy, gx] += m
                if is_major:
                    major_len[gy, gx] += m

    has_road = road_len > 50.0
    print(f"cells with road: {has_road.sum():,} of {nxg*nyg:,}")

    # ── labels ──
    counts = np.zeros((nyg, nxg), dtype="int32")
    gx, gy = grid_index(points[:, 0], points[:, 1], bbox)
    ok = (gx >= 0) & (gx < nxg) & (gy >= 0) & (gy < nyg)
    np.add.at(counts, (gy[ok], gx[ok]), 1)
    print(f"complaints placed: {ok.sum():,}  cells with >=1: {(counts>0).sum():,}")

    # ── terrain resampled onto the analysis grid ──
    cell_lon = bbox[0] + (np.arange(nxg) + 0.5) * CELL_DEG
    cell_lat = bbox[1] + (np.arange(nyg) + 0.5) * CELL_DEG
    LON, LAT = np.meshgrid(cell_lon, cell_lat)
    col = ((LON - c) / a).astype(int)
    row = ((LAT - f) / e).astype(int)
    valid = (col >= 0) & (col < nx) & (row >= 0) & (row < ny)
    col = np.clip(col, 0, nx - 1)
    row = np.clip(row, 0, ny - 1)

    feats = {k: terrain[i][row, col] for i, k in enumerate(keys)}

    # ── the engineered urban-form features ──
    cell_area_km2 = (200.0 * 200.0) / 1e6
    feats["road_density"] = (road_len / 1000.0) / cell_area_km2      # km/km2
    feats["major_frac"] = np.divide(major_len, np.maximum(road_len, 1e-6))

    # The question "does low road density mean more water?" is really a question
    # about LOAD PER DRAIN. Road length is our only proxy for drainage capacity
    # (inlets sit along streets), and upslope accumulation is the load. Their
    # ratio is the physically meaningful quantity, not density on its own.
    feats["load_per_road"] = np.log1p(np.expm1(feats["logacc"]) /
                                      np.maximum(road_len, 25.0))

    X_keys = sorted(feats)
    mask = has_road & valid
    ys, xs = np.where(mask)

    X = np.stack([feats[k][ys, xs] for k in X_keys], axis=1).astype("float32")
    X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)
    y = (counts[ys, xs] > 0).astype("int8")

    # spatial blocks for grouped CV
    block = ((cell_lat[ys] // BLOCK_DEG).astype(int) * 10_000 +
             (cell_lon[xs] // BLOCK_DEG).astype(int))

    pos = int(y.sum())
    print(f"\nsamples: {len(y):,}   positives: {pos:,} ({100*pos/len(y):.1f}%)")
    print(f"spatial blocks: {len(np.unique(block))}")
    print(f"features: {', '.join(X_keys)}")

    def run_cv(splitter, groups=None, label=""):
        aps, aucs = [], []
        it = splitter.split(X, y, groups) if groups is not None else splitter.split(X)
        for tr, te in it:
            if y[te].sum() < 5:
                continue
            m = xgb.XGBClassifier(
                n_estimators=350, max_depth=5, learning_rate=0.06,
                subsample=0.85, colsample_bytree=0.85,
                scale_pos_weight=float((y[tr] == 0).sum() / max(y[tr].sum(), 1)),
                eval_metric="aucpr", tree_method="hist", random_state=42, n_jobs=4)
            m.fit(X[tr], y[tr])
            p = m.predict_proba(X[te])[:, 1]
            aps.append(average_precision_score(y[te], p))
            aucs.append(roc_auc_score(y[te], p))
        print(f"  {label:22} PR-AUC {np.mean(aps):.3f} ± {np.std(aps):.3f}   "
              f"ROC-AUC {np.mean(aucs):.3f}")
        return float(np.mean(aps)), float(np.mean(aucs))

    base = y.mean()
    print(f"\nbaseline PR-AUC (prevalence): {base:.3f}\n")

    ap_rand, auc_rand = run_cv(KFold(5, shuffle=True, random_state=42),
                               label="random 5-fold")
    ap_spat, auc_spat = run_cv(GroupKFold(n_splits=5), groups=block,
                               label="SPATIAL block 5-fold")

    inflation = (ap_rand - ap_spat) / max(ap_spat, 1e-6) * 100
    print(f"\n  random CV overstates PR-AUC by {inflation:.0f}% — this is the"
          f"\n  spatial-autocorrelation trap, and why only the blocked number counts.")

    # ── final model + importance ──
    final = xgb.XGBClassifier(
        n_estimators=400, max_depth=5, learning_rate=0.06,
        subsample=0.85, colsample_bytree=0.85,
        scale_pos_weight=float((y == 0).sum() / max(y.sum(), 1)),
        eval_metric="aucpr", tree_method="hist", random_state=42, n_jobs=4)
    final.fit(X, y)

    gain = final.get_booster().get_score(importance_type="gain")
    imp = sorted(((X_keys[int(k[1:])], v) for k, v in gain.items()),
                 key=lambda t: -t[1])
    total = sum(v for _, v in imp) or 1.0
    print("\nfeature importance (gain):")
    for k, v in imp:
        print(f"  {k:16} {100*v/total:5.1f}%")

    # directional check on the user's road-density intuition
    q = np.quantile(X[:, X_keys.index("road_density")], [0.2, 0.4, 0.6, 0.8])
    print("\nflood rate by road-density quintile (km/km2):")
    edges = [-np.inf, *q, np.inf]
    for i in range(5):
        sel = ((X[:, X_keys.index("road_density")] > edges[i]) &
               (X[:, X_keys.index("road_density")] <= edges[i + 1]))
        if sel.sum():
            print(f"  Q{i+1}  density<= {edges[i+1]:7.1f}   "
                  f"flood rate {100*y[sel].mean():5.1f}%   n={sel.sum():,}")

    OUT.write_text(json.dumps({
        "n_samples": int(len(y)), "n_positive": pos, "prevalence": float(base),
        "pr_auc_random_cv": ap_rand, "pr_auc_spatial_cv": ap_spat,
        "roc_auc_spatial_cv": auc_spat,
        "random_cv_inflation_pct": float(inflation),
        "importance": {k: float(100 * v / total) for k, v in imp},
    }, indent=1), encoding="utf-8")
    print(f"\nwrote {OUT.name}")


if __name__ == "__main__":
    main()
