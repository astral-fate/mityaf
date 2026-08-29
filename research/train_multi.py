"""Multi-city training, with leave-one-city-out as the headline result.

Run build_city.py for each city first.

Spatial blocking answers "does this generalise across neighbourhoods". It
cannot answer "does this generalise across cities", because within one city
the drainage design, the climate and the reporting culture are all held
constant — and those are exactly the things that differ in Al Madinah.

So the number reported first here is trained on one city and tested on another
it has never seen. If that holds up, the claim that the model FORM transfers
is evidence rather than hope. If it collapses, we say so, because the whole
Madinah design rests on it.

    python research/train_multi.py
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from cities import CITIES

HERE = Path(__file__).parent
CELL_DEG = 200.0 / 111_320.0
BLOCK_DEG = 0.05
OUT = HERE / "results_multi.json"


def densify(coords, step_deg=CELL_DEG / 3):
    out = []
    for (x0, y0), (x1, y1) in zip(coords[:-1], coords[1:]):
        d = math.hypot(x1 - x0, y1 - y0)
        n = max(1, int(d / step_deg))
        for i in range(n):
            t = i / n
            out.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, d / n))
    return out


def build_matrix(city: str, points_override=None):
    """Grid one city into the same 9-feature matrix used everywhere.

    `points_override` swaps in a different set of complaint coordinates while
    keeping the identical grid, terrain and road features. That is what lets
    Phase 5 score the same cells against a second phenomenon -- drainage
    failure rather than terrain ponding -- with everything else held constant,
    so any difference is the label and not the geometry.
    """
    cd = HERE / "cache" / city
    meta = json.loads((cd / "meta.json").read_text())
    terrain = np.load(cd / "terrain.npy")
    points = np.load(cd / "points.npy") if points_override is None else points_override
    roads = json.loads((cd / "roads.json").read_text(encoding="utf-8"))

    bbox = meta["bbox"]
    keys = meta["keys"]
    a, b, c, d, e, f = meta["transform"]
    ny, nx = meta["shape"]

    nxg = int((bbox[2] - bbox[0]) / CELL_DEG) + 1
    nyg = int((bbox[3] - bbox[1]) / CELL_DEG) + 1

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
        for lon, lat, seg in densify(coords):
            gx = int((lon - bbox[0]) / CELL_DEG)
            gy = int((lat - bbox[1]) / CELL_DEG)
            if 0 <= gx < nxg and 0 <= gy < nyg:
                m = seg * 111_320 * math.cos(math.radians(lat))
                road_len[gy, gx] += m
                if is_major:
                    major_len[gy, gx] += m

    counts = np.zeros((nyg, nxg), dtype="int32")
    gx = ((points[:, 0] - bbox[0]) / CELL_DEG).astype(int)
    gy = ((points[:, 1] - bbox[1]) / CELL_DEG).astype(int)
    ok = (gx >= 0) & (gx < nxg) & (gy >= 0) & (gy < nyg)
    np.add.at(counts, (gy[ok], gx[ok]), 1)

    cell_lon = bbox[0] + (np.arange(nxg) + 0.5) * CELL_DEG
    cell_lat = bbox[1] + (np.arange(nyg) + 0.5) * CELL_DEG
    LON, LAT = np.meshgrid(cell_lon, cell_lat)
    col = np.clip(((LON - c) / a).astype(int), 0, nx - 1)
    row = np.clip(((LAT - f) / e).astype(int), 0, ny - 1)

    feats = {k: terrain[i][row, col] for i, k in enumerate(keys)}
    cell_area_km2 = (200.0 * 200.0) / 1e6
    feats["road_density"] = (road_len / 1000.0) / cell_area_km2
    feats["major_frac"] = np.divide(major_len, np.maximum(road_len, 1e-6))
    feats["load_per_road"] = np.log1p(
        np.expm1(feats["logacc"]) / np.maximum(road_len, 25.0))

    X_keys = sorted(feats)
    mask = road_len > 50.0
    ys, xs = np.where(mask)

    X = np.nan_to_num(
        np.stack([feats[k][ys, xs] for k in X_keys], axis=1).astype("float32"),
        nan=0.0, posinf=0.0, neginf=0.0)
    y = (counts[ys, xs] > 0).astype("int8")
    block = ((cell_lat[ys] // BLOCK_DEG).astype(int) * 10_000
             + (cell_lon[xs] // BLOCK_DEG).astype(int))

    print(f"  {meta['name']:14} {len(y):>7,} cells  {int(y.sum()):>6,} positive "
          f"({100 * y.mean():.1f}%)  {meta['n_reports']:,} reports")
    return X, y, block, X_keys, meta


def model(y_train):
    """The incumbent classifier, built through the shared registry.

    The hyperparameters moved to models.py so the bake-off and this script
    cannot drift apart — one definition, two callers. Behaviour here is
    unchanged, and bakeoff.py asserts that by reproducing results_multi.json.
    """
    from models import build
    return build("xgboost", y_train, seed=42)


def main() -> None:
    from sklearn.metrics import average_precision_score, roc_auc_score
    from sklearn.model_selection import GroupKFold

    print("building matrices")
    data = {}
    for city in CITIES:
        # A city with no ground truth supplies features only. Including it
        # here would add 30k unlabelled rows as negatives and quietly
        # destroy both the prevalence baseline and the LOCO evaluation.
        if not CITIES[city].get("labels_url"):
            print(f"  {city}: no labels — features only, excluded from training")
            continue
        if not (HERE / "cache" / city / "meta.json").exists():
            print(f"  {city}: no cache — run build_city.py {city}")
            continue
        data[city] = build_matrix(city)

    if len(data) < 2:
        print("\nneed at least two cities for leave-one-city-out")
        return

    keys = next(iter(data.values()))[3]
    results = {"cities": {}, "loco": {}, "pooled": {}}

    # ── within-city, spatially blocked ──────────────────────────────────────
    print("\nwithin city, spatial block CV")
    for city, (X, y, block, _, meta) in data.items():
        aps = []
        for tr, te in GroupKFold(n_splits=5).split(X, y, block):
            if y[te].sum() < 5:
                continue
            m = model(y[tr]).fit(X[tr], y[tr])
            aps.append(average_precision_score(y[te], m.predict_proba(X[te])[:, 1]))
        base = float(y.mean())
        print(f"  {meta['name']:14} PR-AUC {np.mean(aps):.3f}   baseline {base:.3f}"
              f"   lift {np.mean(aps) / base:.2f}x")
        results["cities"][city] = {
            "name": meta["name"], "n": int(len(y)), "prevalence": base,
            "pr_auc_spatial": float(np.mean(aps)),
            "lift": float(np.mean(aps) / base),
        }

    # ── the one that matters ───────────────────────────────────────────────
    print("\nleave one city out — trained on a city it has never seen")
    for held in data:
        tr_cities = [c for c in data if c != held]
        Xtr = np.vstack([data[c][0] for c in tr_cities])
        ytr = np.concatenate([data[c][1] for c in tr_cities])
        Xte, yte, _, _, meta = data[held]

        m = model(ytr).fit(Xtr, ytr)
        p = m.predict_proba(Xte)[:, 1]
        ap = average_precision_score(yte, p)
        roc = roc_auc_score(yte, p)
        base = float(yte.mean())
        print(f"  train {'+'.join(tr_cities):<12} -> test {meta['name']:<14} "
              f"PR-AUC {ap:.3f}  baseline {base:.3f}  lift {ap / base:.2f}x  ROC {roc:.3f}")
        results["loco"][held] = {
            "name": meta["name"], "trained_on": tr_cities,
            "pr_auc": float(ap), "roc_auc": float(roc),
            "prevalence": base, "lift": float(ap / base),
        }

    # ── pooled model, for the feature story ────────────────────────────────
    Xall = np.vstack([d[0] for d in data.values()])
    yall = np.concatenate([d[1] for d in data.values()])
    final = model(yall).fit(Xall, yall)
    gain = final.get_booster().get_score(importance_type="gain")
    imp = sorted(((keys[int(k[1:])], v) for k, v in gain.items()), key=lambda t: -t[1])
    total = sum(v for _, v in imp) or 1.0
    print(f"\npooled model — {len(yall):,} cells across {len(data)} cities")
    for k, v in imp:
        print(f"  {k:16} {100 * v / total:5.1f}%")
    results["pooled"] = {
        "n": int(len(yall)), "n_cities": len(data),
        "importance": {k: float(100 * v / total) for k, v in imp},
    }

    # Road density direction, now on pooled data.
    di = keys.index("road_density")
    q = np.quantile(Xall[:, di], [0.2, 0.4, 0.6, 0.8])
    edges = [-np.inf, *q, np.inf]
    print("\nflood rate by road-density quintile (pooled)")
    quints = []
    for i in range(5):
        sel = (Xall[:, di] > edges[i]) & (Xall[:, di] <= edges[i + 1])
        if sel.sum():
            rate = float(100 * yall[sel].mean())
            print(f"  Q{i + 1}  <= {edges[i + 1]:7.1f}  {rate:5.1f}%   n={sel.sum():,}")
            quints.append({"q": i + 1, "max_density": None if math.isinf(edges[i + 1])
                           else float(edges[i + 1]), "rate": rate, "n": int(sel.sum())})
    results["pooled"]["road_density_quintiles"] = quints

    # Persist the pooled model. Earlier work deliberately did not save NYC-only
    # weights, because one city's weights carry that city's drainage design and
    # climate. A model fitted across cities is a different proposition — and
    # whether it may be applied to a city it never saw is exactly what the
    # leave-one-city-out numbers decide. They are saved beside the weights so
    # nobody can pick up one without the other.
    try:
        import joblib
        joblib.dump(
            {"model": final, "features": keys, "cities": list(data),
             "loco": results["loco"], "n_train": int(len(yall))},
            HERE / "model_pooled.joblib",
        )
        print(f"saved model_pooled.joblib ({len(keys)} features, "
              f"{len(yall):,} rows, {len(data)} cities)")
    except ImportError:
        print("joblib not installed — model not persisted")

    OUT.write_text(json.dumps(results, indent=1), encoding="utf-8")
    print(f"\nwrote {OUT.name}")


if __name__ == "__main__":
    main()
